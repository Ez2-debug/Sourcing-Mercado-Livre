'use strict';

/*
 * Validacao de identificadores e leitura dos recursos de catalogo
 * (categoria, produto e anuncios) no formato usado pelas ferramentas.
 */

const { ToolError } = require('./meli');

function categoryId(value, required) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new ToolError('Informe categoria_id (exemplo: MLB1051). Use listar_categorias para ver os codigos.');
    return null;
  }
  const id = String(value).trim().toUpperCase();
  if (!/^MLB\d{1,12}$/.test(id)) {
    throw new ToolError(`categoria_id invalido: "${value}". O formato e MLB seguido de numeros, como MLB1051.`);
  }
  return id;
}

function productId(value) {
  const id = String(value === undefined || value === null ? '' : value).trim().toUpperCase();
  if (!/^MLB[A-Z]{0,2}\d{1,15}$/.test(id)) {
    throw new ToolError(`produto_id invalido: "${value}". Use o id devolvido por mais_vendidos, como MLB54982411.`);
  }
  return id;
}

function pathForProduct(id, type) {
  const t = String(type || '').toUpperCase();
  if (t === 'USER_PRODUCT' || (!t && /^MLBU/.test(id))) return `/user-products/${id}`;
  if (t === 'ITEM') return `/items/${id}`;
  return `/products/${id}`;
}

// Link da pagina publica. Usa o permalink quando a API manda; senao monta
// pelo padrao de enderecos do site (marcado como link_montado).
function publicLink(id, type, permalink) {
  if (permalink) return { link: permalink };
  const t = String(type || '').toUpperCase();
  const digits = String(id).replace(/^MLB[A-Z]*/, '');
  if (t === 'USER_PRODUCT' || (!t && /^MLBU/.test(id))) {
    return { link: `https://www.mercadolivre.com.br/up/${id}`, link_montado: true };
  }
  if (t === 'ITEM') {
    return { link: `https://produto.mercadolivre.com.br/MLB-${digits}-_JM`, link_montado: true };
  }
  return { link: `https://www.mercadolivre.com.br/p/${id}`, link_montado: true };
}

// Procura, na resposta crua, qualquer campo que fale de vendas. Serve para
// mostrar exatamente o que a API entrega, sem estimar nada.
function findSalesFields(obj) {
  const found = {};
  const walk = (value, path, depth) => {
    if (Object.keys(found).length >= 12 || depth > 5 || value === null || typeof value !== 'object') return;
    const entries = Array.isArray(value) ? value.slice(0, 5).map((v, i) => [String(i), v]) : Object.entries(value);
    for (const [k, v] of entries) {
      const p = path ? `${path}.${k}` : k;
      if (/sold|sales|sell_count|vendid|vendas/i.test(k) && (v === null || typeof v !== 'object')) {
        found[p] = v;
      } else {
        walk(v, p, depth + 1);
      }
      if (Object.keys(found).length >= 12) return;
    }
  };
  walk(obj, '', 0);
  return found;
}

const SEM_VENDAS = 'A API nao devolveu nenhum campo de vendas para este registro.';

function brandOf(attributes) {
  if (!Array.isArray(attributes)) return undefined;
  const a = attributes.find((x) => x && x.id === 'BRAND');
  return a ? (a.value_name || (a.values && a.values[0] && a.values[0].name)) : undefined;
}

// Fotos do produto, na ordem em que o site as mostra. Produtos de catalogo
// trazem `pictures`; anuncios avulsos trazem tambem `thumbnail`.
function photosOf(p, max) {
  const urls = [];
  const add = (u) => {
    if (typeof u !== 'string' || !/^https?:\/\//.test(u)) return;
    const https = u.replace(/^http:\/\//, 'https://');
    if (!urls.includes(https)) urls.push(https);
  };
  if (Array.isArray(p.pictures)) for (const pic of p.pictures) add(pic && (pic.secure_url || pic.url));
  add(p.secure_thumbnail || p.thumbnail);
  return urls.slice(0, max || 3);
}

function dropEmpty(obj) {
  for (const k of Object.keys(obj)) if (obj[k] === undefined || obj[k] === null) delete obj[k];
  return obj;
}

function summarizeProduct(p, full, id, type) {
  const bb = p.buy_box_winner || {};
  const fotos = photosOf(p, full ? 6 : 1);
  const out = {
    id: p.id || id,
    nome: p.name || p.title,
    marca: brandOf(p.attributes),
    preco: bb.price !== undefined ? bb.price : p.price,
    moeda: bb.currency_id || p.currency_id,
    categoria_id: p.category_id || bb.category_id,
    status: p.status,
    foto: fotos[0],
    ...publicLink(p.id || id, type, p.permalink),
  };
  const vendas = findSalesFields(p);
  if (Object.keys(vendas).length) out.campos_de_venda = vendas;
  else if (full) out.vendas = SEM_VENDAS;
  if (full) {
    out.familia = p.family_name;
    out.descricao_curta = p.short_description && (p.short_description.content || p.short_description);
    out.fotos = fotos.length > 1 ? fotos : undefined;
    out.destaques = Array.isArray(p.main_features)
      ? p.main_features.slice(0, 8).map((f) => f && (f.text || f)).filter(Boolean)
      : undefined;
    out.atributos = Array.isArray(p.attributes)
      ? p.attributes.slice(0, 20).map((a) => ({ nome: a.name || a.id, valor: a.value_name })).filter((a) => a.valor)
      : undefined;
  }
  // Se a resposta veio em formato inesperado, mostra quais campos existem
  // para que o formato real possa ser mapeado.
  if (!out.nome) out.campos_disponiveis = Object.keys(p).slice(0, 40);
  return dropEmpty(out);
}

function listingsOf(data) {
  if (Array.isArray(data)) return data;
  return data && Array.isArray(data.results) ? data.results : [];
}

// Resumo dos anuncios de um produto de catalogo. A API devolve ate 100 por
// pagina; `total` vem de paging e os demais numeros sao da pagina lida.
function summarizeListings(data) {
  const list = listingsOf(data);
  const total = data && data.paging && Number.isFinite(data.paging.total) ? data.paging.total : list.length;
  const priced = list.filter((it) => typeof it.price === 'number' && it.price > 0);
  const out = { quantidade_anuncios: total, anuncios_lidos: list.length };
  if (priced.length) {
    const barato = priced.reduce((a, b) => (b.price < a.price ? b : a));
    const caro = priced.reduce((a, b) => (b.price > a.price ? b : a));
    const itemId = barato.item_id || barato.id;
    out.menor_preco = dropEmpty({
      valor: barato.price,
      moeda: barato.currency_id,
      anuncio_id: itemId,
      ...(itemId ? publicLink(itemId, 'ITEM', barato.permalink) : {}),
    });
    out.maior_preco = caro.price;
  }
  out.vendedores = new Set(list.map((it) => it.seller_id).filter(Boolean)).size;
  out.lojas_oficiais = list.filter((it) => it.official_store_id).length;
  out.no_full = list.filter((it) => it.shipping && it.shipping.logistic_type === 'fulfillment').length;
  return out;
}

module.exports = {
  SEM_VENDAS,
  brandOf,
  categoryId,
  dropEmpty,
  findSalesFields,
  listingsOf,
  pathForProduct,
  photosOf,
  productId,
  publicLink,
  summarizeListings,
  summarizeProduct,
};
