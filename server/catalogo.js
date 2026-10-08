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
/*
 * Compra Internacional (anuncios de vendedores de fora do Brasil).
 *
 * A API marca esses anuncios com a tag "cbt_item". O pais nao vem em um campo
 * proprio: "cbt_fulfillment_us" diz que o envio sai do centro de distribuicao
 * do Mercado Livre nos Estados Unidos, e o endereco do vendedor traz so nomes
 * de cidade e estado. A origem aqui e, portanto, de onde o produto e enviado,
 * e nao a nacionalidade do vendedor: ha vendedor chines que envia pelos EUA.
 */
const ESTADOS_DOS_EUA = new Set(['alabama', 'alaska', 'arizona', 'arkansas', 'california', 'colorado', 'connecticut', 'delaware', 'florida', 'georgia',
  'hawaii', 'idaho', 'illinois', 'indiana', 'iowa', 'kansas', 'kentucky', 'louisiana', 'maine', 'maryland', 'massachusetts', 'michigan', 'minnesota',
  'mississippi', 'missouri', 'montana', 'nebraska', 'nevada', 'new hampshire', 'new jersey', 'new mexico', 'new york', 'north carolina', 'north dakota',
  'ohio', 'oklahoma', 'oregon', 'pennsylvania', 'rhode island', 'south carolina', 'south dakota', 'tennessee', 'texas', 'utah', 'vermont', 'virginia',
  'washington', 'west virginia', 'wisconsin', 'wyoming']);
const LUGARES_DA_CHINA = /\b(china|guangdong|shenzhen|guangzhou|dongguan|foshan|zhejiang|hangzhou|yiwu|ningbo|wenzhou|jiangsu|suzhou|nanjing|shanghai|beijing|fujian|xiamen|quanzhou|shandong|qingdao|hebei|henan|hubei|wuhan|hunan|sichuan|chengdu|chongqing|anhui|jiangxi|tianjin|hong kong|hongkong)\b/;

// 'estados_unidos', 'china', 'outra' ou null quando o anuncio nao e internacional.
function origemInternacional(it) {
  const tags = Array.isArray(it.tags) ? it.tags : [];
  const modo = it.international_delivery_mode;
  if (!tags.includes('cbt_item') && !(modo && modo !== 'none')) return null;
  if (tags.includes('cbt_fulfillment_us')) return 'estados_unidos';
  const e = it.seller_address || {};
  const estado = String((e.state && e.state.name) || '').trim().toLowerCase();
  const lugar = `${estado} ${String((e.city && e.city.name) || '').toLowerCase()}`;
  if (ESTADOS_DOS_EUA.has(estado)) return 'estados_unidos';
  if (LUGARES_DA_CHINA.test(lugar)) return 'china';
  return 'outra';
}

function resumoInternacional(list) {
  const grupos = {};
  for (const it of list) {
    const origem = origemInternacional(it);
    if (!origem) continue;
    const g = grupos[origem] || (grupos[origem] = { anuncios: 0 });
    g.anuncios += 1;
    if (typeof it.price === 'number' && it.price > 0 && (g.menor_preco === undefined || it.price < g.menor_preco)) {
      const itemId = it.item_id || it.id;
      g.menor_preco = it.price;
      Object.assign(g, itemId ? publicLink(itemId, 'ITEM', it.permalink) : {});
    }
  }
  const total = Object.values(grupos).reduce((t, g) => t + g.anuncios, 0);
  return total ? { anuncios: total, ...grupos } : null;
}

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
  const internacional = resumoInternacional(list);
  if (internacional) {
    out.internacional = internacional;
    // O menor preco entre os anuncios do Brasil, para comparar com o internacional.
    const nacionais = priced.filter((it) => !origemInternacional(it));
    if (nacionais.length) out.menor_preco_nacional = Math.min(...nacionais.map((it) => it.price));
  }
  return out;
}

module.exports = {
  SEM_VENDAS,
  brandOf,
  categoryId,
  dropEmpty,
  findSalesFields,
  listingsOf,
  origemInternacional,
  pathForProduct,
  photosOf,
  productId,
  publicLink,
  summarizeListings,
  summarizeProduct,
};
