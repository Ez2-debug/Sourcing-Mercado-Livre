'use strict';

/*
 * Mais vendidos por marketplace, divididos por categoria e com o genero do
 * produto, a partir das ferramentas de busca do JoomPulse:
 *
 * - ml                      meli_search_products, ordenado por sales1m
 * - ml-internacional        o mesmo com where.isInternational (Compra Internacional)
 * - ml-internacional-itens  group=item, so para saber a origem pelo vendedor
 * - shopee                  shopee_search_products, ordenado por itemSales1m
 * - shopee-internacional    o mesmo com where.isInternational
 * - joompro                 joompro_search_products por meliSales1m, semelhanca >= 0,90
 *
 * Os numeros sao ESTIMATIVAS do JoomPulse. No Mercado Livre, sales1m e a media
 * mensal ao longo da vida do produto; na Shopee vem do contador arredondado.
 * O genero sai de palavras do titulo e da categoria: e uma leitura automatica.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { ToolError, cleanEnv } = require('./meli');
const { norm, sinaisRegulatorios } = require('./mineracao');

const TIPOS = {
  ml: 'Mercado Livre · Brasil',
  'ml-internacional': 'Mercado Livre · Compra Internacional',
  shopee: 'Shopee · Brasil',
  'shopee-internacional': 'Shopee · lojas internacionais',
  joompro: 'China · fornecedores (JoomPro / Alibaba)',
};
const SUSPEITO_SHOPEE = 1000000; // vendas em 30 dias acima disso sao erro da fonte

function pasta() {
  const base = cleanEnv(process.env.CONECTA_HUB_SAIDA);
  return path.join(base ? path.dirname(base) : path.join(os.homedir(), 'ConectaHubSourcing'), 'mais-vendidos');
}

const GENEROS = [
  ['Infantil', /\b(infantil|infantis|bebe|bebes|crianca|criancas|kids?|baby|menino|meninos|menina|meninas|recem.nascido|toddler|juvenil)\b/],
  ['Feminino', /\b(feminino|feminina|femininos|femininas|mulher|mulheres|women|woman|womens|female|dama|lady|ladies|girls?|sutia|calcinha|lingerie|maquiagem|batom)\b/],
  ['Masculino', /\b(masculino|masculina|masculinos|homem|homens|men|mens|man|male|boys?|cueca|barba)\b/],
  ['Unissex', /\b(unissex|unisex|unissexo)\b/],
];

// Genero pelo titulo e pela categoria. Feminino e masculino juntos viram unissex.
function generoDe(...textos) {
  const t = norm(textos.filter(Boolean).join(' '));
  const achados = GENEROS.filter(([, re]) => re.test(t)).map(([g]) => g);
  if (achados.includes('Infantil')) return 'Infantil';
  if (achados.includes('Unissex') || (achados.includes('Feminino') && achados.includes('Masculino'))) return 'Unissex';
  return achados[0] || 'Sem gênero';
}

// Origem de um anuncio internacional pelo cadastro do vendedor: as lojas da
// China usam o prefixo CN; os distribuidores dos EUA terminam em BRF.
function origemPeloVendedor(nome) {
  const n = String(nome || '').toUpperCase();
  if (/^(CN|HK)/.test(n) || /BRR$/.test(n)) return 'China';
  if (/BRF$/.test(n) || /^US/.test(n)) return 'Estados Unidos';
  return undefined;
}

function lerResposta(resposta) {
  let r;
  try {
    r = typeof resposta === 'string' ? JSON.parse(resposta) : resposta;
  } catch (_) {
    throw new ToolError('A resposta do JoomPulse nao e um JSON valido.');
  }
  if (!r || !Array.isArray(r.columns) || !Array.isArray(r.data)) throw new ToolError('A resposta do JoomPulse precisa ter "columns" e "data".');
  return r.data.map((linha) => Object.fromEntries(r.columns.map((c, i) => [c, linha[i]])));
}

const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : undefined);
const limpo = (o) => { for (const k of Object.keys(o)) if (o[k] === undefined || o[k] === null || o[k] === '') delete o[k]; return o; };

function doMercadoLivre(l) {
  const titulo = String(l.title || '').trim();
  const regulatorio = sinaisRegulatorios(titulo, 'MLB');
  return limpo({
    id: l.productId || l.buyBoxItemId || l.itemId,
    item_id: l.buyBoxItemId || l.itemId,
    titulo,
    foto: l.imageUrl,
    link: l.meliUrl,
    preco: num(l.buyBoxPrice) ?? num(l.price) ?? num(l.priceMin),
    categoria: l.categoryL1Name || 'Outros',
    subcategoria: l.categoryL2Name,
    vendas_mes: num(l.sales1m),
    faturamento_mes: num(l.revenue1m) === undefined ? undefined : Math.round(l.revenue1m),
    vendidos_total: num(l.totalSold),
    vendedores: num(l.sellerCount),
    avaliacoes: num(l.reviewsCount),
    nota: num(l.rating),
    marca: l.brand && !/^(generic|generica|general|geral|nobrand|other)$/i.test(l.brand) ? l.brand : undefined,
    internacional: l.isInternational === true ? true : undefined,
    genero: generoDe(titulo, l.categoryL1Name, l.categoryL2Name, l.categoryL3Name),
    regulatorio: regulatorio.length ? regulatorio : undefined,
  });
}

function daShopee(l) {
  const titulo = String(l.title || '').trim();
  return limpo({
    id: String(l.itemId),
    titulo,
    foto: l.imageUrl,
    link: l.shopeeUrl,
    preco: num(l.price),
    categoria: l.categoryL1Name || 'Outros',
    subcategoria: l.categoryL2Name,
    vendas_mes: num(l.itemSales1m),
    faturamento_mes: num(l.itemRevenue1m) === undefined ? undefined : Math.round(l.itemRevenue1m),
    avaliacoes: num(l.reviewsCount),
    nota: num(l.rating),
    marca: l.brand && !/^(generic|generica|nobrand|no brand|outros)$/i.test(l.brand) ? l.brand : undefined,
    internacional: l.isInternational === true ? true : undefined,
    loja: l.sellerName,
    tendencia: num(l.salesTrend) === undefined ? undefined : (l.salesTrend > 10 ? 'subindo' : (l.salesTrend < -10 ? 'caindo' : 'estavel')),
    genero: generoDe(titulo, l.categoryL1Name, l.categoryL2Name, l.categoryL3Name),
  });
}

function doJoompro(l) {
  const titulo = String(l.meliTitle || l.title || '').trim();
  return limpo({
    id: l.joomproProductId,
    titulo,
    titulo_fornecedor: l.title,
    foto: l.imageUrl,
    link: l.joomproUrl,
    link_ml: l.meliUrl,
    preco: num(l.joomproPrice),
    categoria: l.meliCategoryL1Name || l.categoryL1Name || 'Outros',
    subcategoria: l.meliCategoryL2Name || l.categoryL2Name,
    vendas_mes: num(l.meliSales1m),
    preco_ml: num(l.meliPrice),
    pedido_minimo: num(l.minOrderQty),
    lote_pequeno: l.hasSmallBatch === true ? true : undefined,
    semelhanca: num(l.matchScore) === undefined ? undefined : Math.round(l.matchScore * 100) / 100,
    margem: num(l.margin) === undefined ? undefined : Math.round(l.margin * 1000) / 1000,
    genero: generoDe(titulo, l.title, l.meliCategoryL1Name, l.meliCategoryL2Name),
  });
}

const dois = (n) => String(n).padStart(2, '0');
const diaDe = (d) => `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}`;

function lerArquivo(nome) {
  try {
    return JSON.parse(fs.readFileSync(path.join(pasta(), nome), 'utf8'));
  } catch (_) {
    return null;
  }
}

// Grava uma resposta. Paginas do mesmo tipo no mesmo dia se somam.
function gravarMaisVendidos(tipo, resposta, agora) {
  const quando = agora || new Date();
  const linhas = lerResposta(resposta);
  if (tipo === 'ml-internacional-itens') {
    const atual = lerArquivo('origens.json') || {};
    let novas = 0;
    for (const l of linhas) {
      const origem = origemPeloVendedor(l.sellerName);
      if (!origem) continue;
      for (const id of [l.productId, l.itemId]) if (id && !atual[id]) { atual[id] = origem; novas += 1; }
    }
    fs.mkdirSync(pasta(), { recursive: true });
    fs.writeFileSync(path.join(pasta(), 'origens.json'), JSON.stringify(atual), 'utf8');
    return { tipo, origens: novas };
  }
  if (!TIPOS[tipo]) throw new ToolError(`Tipo deve ser um de: ${Object.keys(TIPOS).concat('ml-internacional-itens').join(', ')}.`);
  const montar = tipo.startsWith('ml') ? doMercadoLivre : (tipo === 'joompro' ? doJoompro : daShopee);
  let itens = linhas.map(montar).filter((x) => x.id && x.titulo);
  if (tipo.startsWith('shopee')) itens = itens.filter((x) => (x.vendas_mes || 0) < SUSPEITO_SHOPEE);
  const atual = lerArquivo(`${tipo}.json`);
  const mesmoDia = atual && atual.dia === diaDe(quando);
  const porId = new Map(((mesmoDia && atual.itens) || []).map((x) => [x.id, x]));
  for (const x of itens) if (!porId.has(x.id)) porId.set(x.id, x);
  const dados = { tipo, dia: diaDe(quando), consultado_em: quando.toISOString(), itens: [...porId.values()].sort((a, b) => (b.vendas_mes || 0) - (a.vendas_mes || 0)) };
  fs.mkdirSync(pasta(), { recursive: true });
  fs.writeFileSync(path.join(pasta(), `${tipo}.json`), JSON.stringify(dados), 'utf8');
  return { tipo, itens: dados.itens.length, novos: itens.length };
}

// Agrupa por categoria, da que mais vende para a que menos vende.
function porCategoria(itens) {
  const grupos = new Map();
  for (const x of itens) {
    const g = grupos.get(x.categoria) || { categoria: x.categoria, quantidade: 0, vendas_mes: 0 };
    g.quantidade += 1;
    g.vendas_mes += x.vendas_mes || 0;
    grupos.set(x.categoria, g);
  }
  return [...grupos.values()].sort((a, b) => b.vendas_mes - a.vendas_mes);
}

// Anuncios da ultima leitura de internacional.js, no formato desta lista.
function leituraPorPais() {
  const base = path.join(path.dirname(pasta()), 'internacional');
  let nomes;
  try {
    nomes = fs.readdirSync(base).filter((n) => /^ml-\d{4}-\d{2}-\d{2}\.json$/.test(n)).sort();
  } catch (_) {
    return [];
  }
  if (!nomes.length) return [];
  let d;
  try { d = JSON.parse(fs.readFileSync(path.join(base, nomes[nomes.length - 1]), 'utf8')); } catch (_) { return []; }
  return (d.itens || []).filter((x) => x.origem === 'China' || x.origem === 'Estados Unidos').map((x) => {
    const [categoria, subcategoria] = String(x.categoria || 'Outros').split(' > ');
    return limpo({
      id: x.id, titulo: x.nome, foto: x.foto, link: x.link, preco: x.preco, categoria: categoria || 'Outros', subcategoria,
      vendas_mes: x.pedidos_mes, faturamento_mes: x.faturamento_mes, avaliacoes: x.avaliacoes, nota: x.nota,
      marca: x.classe_marca === 'conhecida' ? 'marca conhecida' : undefined, internacional: true, origem: x.origem,
      genero: generoDe(x.nome, x.categoria), lido_em: d.consultado_em,
    });
  });
}

function lerMaisVendidos() {
  const origens = lerArquivo('origens.json') || {};
  const marketplaces = {};
  for (const [tipo, nome] of Object.entries(TIPOS)) {
    const d = lerArquivo(`${tipo}.json`);
    if (!d) continue;
    let itens = d.itens;
    if (tipo === 'ml-internacional') {
      itens = itens.map((x) => ({ ...x, origem: origens[x.id] || origens[x.item_id] || 'Não identificada' }));
      // A leitura da Compra Internacional por pais da loja (internacional.js)
      // traz a origem dada pela fonte; entra junto, sem repetir titulo.
      const vistos = new Set(itens.map((x) => norm(x.titulo)));
      for (const x of leituraPorPais()) if (!vistos.has(norm(x.titulo))) { vistos.add(norm(x.titulo)); itens.push(x); }
      itens.sort((a, b) => (b.vendas_mes || 0) - (a.vendas_mes || 0));
    }
    marketplaces[tipo] = { nome, consultado_em: d.consultado_em, itens, categorias: porCategoria(itens) };
  }
  if (!Object.keys(marketplaces).length) return null;
  return {
    fonte: 'JoomPulse',
    aviso: 'Vendas e faturamento são estimativas do JoomPulse. No Mercado Livre, média mensal ao longo da vida do produto; na Shopee, a partir do contador arredondado. Gênero lido automaticamente do título e da categoria.',
    generos: ['Feminino', 'Masculino', 'Unissex', 'Infantil', 'Sem gênero'],
    marketplaces,
  };
}

module.exports = { TIPOS, generoDe, gravarMaisVendidos, lerMaisVendidos, origemPeloVendedor };
