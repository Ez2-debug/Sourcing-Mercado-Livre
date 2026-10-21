'use strict';

/*
 * O que o Brasil compra de fora: produtos vendidos ao Brasil por lojas da
 * China e dos Estados Unidos.
 *
 * - Mercado Livre, Compra Internacional: cubo MercadoProductsWeekly do
 *   JoomPulse (query_cubejs_meli), filtrado por isInternational, com o pais
 *   da loja (shopCountry).
 * - Shopee: cubo ShbMartItem (query_cubejs_shopee) filtrado por lojas com
 *   local "Internacional" (cross-border).
 * - Amazon e AliExpress entram quando as credenciais oficiais chegarem.
 *
 * Pedidos e vendas sao ESTIMATIVAS do JoomPulse e saem sempre rotulados assim.
 * As perspectivas sao uma ordem de analise, nao previsao de venda.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { ToolError, cleanEnv } = require('./meli');
const { publicLink } = require('./catalogo');
const { classificarMarca } = require('./marcas');
const { norm, sinaisRegulatorios } = require('./mineracao');
const { itensDaResposta } = require('./shopee');

const AVISO = 'Pedidos e vendas sao estimativas do JoomPulse, nao vendas reais. A lista e uma ordem de analise, nao previsao de venda.';
const ORIGENS = { CN: 'China', HK: 'China', US: 'Estados Unidos' };
const SUSPEITO_SHOPEE = 1000000; // vendas em 30 dias acima disso sao erro de leitura da fonte
const DIAS_DE_LANCAMENTO = 60;
// Categorias do Mercado Livre cujo produto passa pela Anvisa mesmo quando o nome nao diz.
const CATEGORIAS_ANVISA = /suplementos|perfumes|cuidados com a pele|cuidados com o cabelo|higiene e cuidados com o bebe|maquiagem|farmacia/;

function pasta() {
  const base = cleanEnv(process.env.CONECTA_HUB_SAIDA);
  return path.join(base ? path.dirname(base) : path.join(os.homedir(), 'ConectaHubSourcing'), 'internacional');
}

const dois = (n) => String(n).padStart(2, '0');
const diaDe = (d) => `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}`;

// Consultas que o Claude envia ao JoomPulse. "ml-us" garante a lista dos EUA,
// que some no meio da China quando a consulta e uma so.
function consultaInternacional(tipo) {
  if (tipo === 'shopee') {
    const c = (n) => `ShbMartItem.${n}`;
    return JSON.stringify({
      dimensions: ['itemId', 'shopId', 'itemName', 'categoryL1Name', 'categoryName', 'shopName', 'shopLocation', 'itemCreationDate', 'hasBrand', 'brandName'].map(c),
      measures: ['price', 'itemImage', 'sold30Days', 'revenue30Days', 'salesTrend', 'reviewsCount', 'reviewsRating', 'sold1y'].map(c),
      filters: [{ member: c('shopLocation'), operator: 'equals', values: ['Internacional'] }],
      order: [[c('sold30Days'), 'desc']],
      limit: 100,
    });
  }
  const c = (n) => `MercadoProductsWeekly.${n}`;
  const filtros = [
    { member: c('isInternational'), operator: 'equals', values: ['true'] },
    { member: c('listingStatus'), operator: 'equals', values: ['active'] },
  ];
  if (tipo === 'ml-us') filtros.push({ member: c('shopCountry'), operator: 'equals', values: ['US'] });
  return JSON.stringify({
    dimensions: ['id', 'productId', 'productName', 'productImage', 'merchantCategoryL1', 'merchantCategoryL2', 'brand', 'adPublishDate'].map(c),
    measures: ['shopCountry', 'priceAmount', 'orderCount1m', 'orderGmv1m', 'soldItem', 'reviewsCountMax', 'reviewsRating'].map(c),
    filters: filtros,
    order: [[c('orderCount1m'), 'desc']],
    limit: tipo === 'ml-us' ? 60 : 100,
  });
}

function lerJson(resposta) {
  let r;
  try {
    r = typeof resposta === 'string' ? JSON.parse(resposta) : resposta;
  } catch (_) {
    throw new ToolError('A resposta do JoomPulse nao e um JSON valido. Passe o resultado sem alterar.');
  }
  if (!r || !Array.isArray(r.columns) || !Array.isArray(r.data)) throw new ToolError('A resposta do JoomPulse precisa ter "columns" e "data".');
  return r;
}

// Marcas que tambem sao palavras comuns; no titulo nao indicam a marca.
const PALAVRAS_COMUNS = new Set(['estrela', 'brilhante', 'uniao', 'pilao', 'mondial', 'ideal']);

// Marca conhecida escrita no titulo quando a fonte nao preenche o campo ("Jbl Charge 6").
function marcaNoNome(nome) {
  return norm(nome).split(/[^a-z0-9]+/).find((w) => w.length > 2 && !PALAVRAS_COMUNS.has(w) && classificarMarca(w) === 'conhecida');
}

function itensDoMercadoLivre(resposta) {
  const r = lerJson(resposta);
  const col = (nome) => r.columns.findIndex((c) => c === nome || c.endsWith(`.${nome}`));
  const i = {};
  for (const n of ['id', 'productId', 'productName', 'productImage', 'merchantCategoryL1', 'merchantCategoryL2', 'brand', 'adPublishDate',
    'shopCountry', 'priceAmount', 'orderCount1m', 'orderGmv1m', 'soldItem', 'reviewsCountMax', 'reviewsRating']) i[n] = col(n);
  if (i.id < 0 || i.productName < 0) throw new ToolError('A resposta do JoomPulse nao traz id e productName.');
  const v = (linha, n) => (i[n] >= 0 && linha[i[n]] !== null && linha[i[n]] !== undefined ? linha[i[n]] : undefined);
  const numero = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : undefined);
  return r.data.map((linha) => {
    const id = String(v(linha, 'id'));
    const nome = String(v(linha, 'productName') || '').trim();
    const marca = v(linha, 'brand');
    const pais = String(v(linha, 'shopCountry') || '').toUpperCase();
    const item = {
      id,
      nome,
      foto: /^https:\/\//.test(v(linha, 'productImage') || '') ? v(linha, 'productImage') : undefined,
      categoria: [v(linha, 'merchantCategoryL1'), v(linha, 'merchantCategoryL2')].filter(Boolean).join(' > '),
      marca: marca && !/^generic$/i.test(marca) ? marca : marcaNoNome(nome),
      classe_marca: marca && !/^generic$/i.test(marca) ? classificarMarca(marca) : (marcaNoNome(nome) ? 'conhecida' : 'sem_marca'),
      publicado_em: v(linha, 'adPublishDate'),
      pais_da_loja: pais || undefined,
      origem: ORIGENS[pais] || pais || undefined,
      preco: numero(v(linha, 'priceAmount')),
      pedidos_mes: numero(v(linha, 'orderCount1m')),
      faturamento_mes: numero(v(linha, 'orderGmv1m')) === undefined ? undefined : Math.round(numero(v(linha, 'orderGmv1m'))),
      vendidos_faixa: numero(v(linha, 'soldItem')),
      avaliacoes: numero(v(linha, 'reviewsCountMax')),
      nota: numero(v(linha, 'reviewsRating')),
      ...(/^MLB\d+$/.test(id) ? publicLink(id, 'ITEM') : {}),
      regulatorio: sinaisRegulatorios(nome, 'MLB'),
    };
    if (CATEGORIAS_ANVISA.test(norm(item.categoria)) && !item.regulatorio.some((r) => r.orgao === 'Anvisa')) {
      item.regulatorio.push({ orgao: 'Anvisa', motivo: 'categoria de saude, cosmetico ou higiene' });
    }
    if (/^brinquedos/.test(norm(item.categoria)) && !item.regulatorio.some((r) => r.orgao === 'Inmetro')) {
      item.regulatorio.push({ orgao: 'Inmetro', motivo: 'brinquedo exige certificacao' });
    }
    if (!item.regulatorio.length) delete item.regulatorio;
    for (const k of Object.keys(item)) if (item[k] === undefined) delete item[k];
    return item;
  }).filter((x) => x.nome);
}

function lerArquivo(nome) {
  try {
    return JSON.parse(fs.readFileSync(path.join(pasta(), nome), 'utf8'));
  } catch (_) {
    return null;
  }
}

function maisRecente(prefixo) {
  let nomes;
  try {
    nomes = fs.readdirSync(pasta()).filter((n) => n.startsWith(`${prefixo}-`) && /\d{4}-\d{2}-\d{2}\.json$/.test(n)).sort();
  } catch (_) {
    return null;
  }
  return nomes.length ? lerArquivo(nomes[nomes.length - 1]) : null;
}

// tipo "ml" (ou "ml-us") ou "shopee". No mesmo dia, as leituras do Mercado
// Livre se somam (China e EUA vem em consultas separadas); a da Shopee substitui.
function gravarInternacional(tipo, resposta, agora) {
  const quando = agora || new Date();
  fs.mkdirSync(pasta(), { recursive: true });
  if (tipo === 'shopee') {
    const itens = itensDaResposta(resposta).filter((x) => x.local_da_loja === 'Internacional');
    if (!itens.length) throw new ToolError('A resposta do JoomPulse veio sem lojas internacionais da Shopee.');
    const arquivo = path.join(pasta(), `shopee-${diaDe(quando)}.json`);
    fs.writeFileSync(arquivo, JSON.stringify({ fonte: 'JoomPulse (Shopee)', consultado_em: quando.toISOString(), aviso: AVISO, itens }), 'utf8');
    return { arquivo, itens: itens.length };
  }
  if (tipo !== 'ml' && tipo !== 'ml-us') throw new ToolError('Tipo deve ser "ml", "ml-us" ou "shopee".');
  const novos = itensDoMercadoLivre(resposta);
  if (!novos.length) throw new ToolError('A resposta do JoomPulse veio sem anuncios.');
  const nome = `ml-${diaDe(quando)}.json`;
  const atual = lerArquivo(nome);
  const porId = new Map(((atual && atual.itens) || []).map((x) => [x.id, x]));
  for (const x of novos) porId.set(x.id, x);
  const itens = [...porId.values()].sort((a, b) => (b.pedidos_mes || 0) - (a.pedidos_mes || 0));
  const arquivo = path.join(pasta(), nome);
  fs.writeFileSync(arquivo, JSON.stringify({ fonte: 'JoomPulse (Mercado Livre, Compra Internacional)', consultado_em: quando.toISOString(), aviso: AVISO, itens }), 'utf8');
  return { arquivo, itens: itens.length, novos: novos.length };
}

const VAZIAS = new Set(['para', 'com', 'sem', 'por', 'kit', 'de', 'do', 'da', 'dos', 'das', 'e', 'o', 'a', 'em', 'um', 'uma', 'pecas', 'unidades', 'novo', 'nova', 'original', 'mulheres', 'homens', 'feminino', 'masculino', 'unissex', 'criancas', 'meninos', 'meninas', 'pares', 'pacote', 'conjunto', 'estilo', 'moda']);
const palavras = (s) => [...new Set(norm(s).split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !VAZIAS.has(w) && !/^\d+$/.test(w)))];

// O tipo de produto: as duas primeiras palavras que contam ("tenis corrida",
// "pijama kigurumi"). Serve para agrupar anuncios parecidos.
const tipoDoProduto = (nome) => palavras(nome).slice(0, 2).join(' ');

function lancamento(item, agora) {
  const t = Date.parse(item.publicado_em || '');
  return Number.isFinite(t) && (agora - t) / 86400000 <= DIAS_DE_LANCAMENTO;
}

// Perspectivas: o que vale analisar para importar. Sem marca de terceiros e
// sem produto regulado na lista principal; os de marca ficam como referencia
// de demanda, porque revender marca exige autorizacao do dono.
function perspectivas(ml, shopee, agora) {
  const quando = agora || new Date();
  const itensMl = (ml && ml.itens) || [];
  const itensSh = ((shopee && shopee.itens) || []).filter((x) => (x.vendas_30_dias || 0) < SUSPEITO_SHOPEE);
  const descartados = ((shopee && shopee.itens) || []).length - itensSh.length;
  // Livre: sem marca declarada e sem orgao regulador no caminho.
  // Livre: sem orgao regulador no caminho e sem marca declarada. Nas lojas da
  // China a "marca" costuma ser a do proprio vendedor; so a marca conhecida barra.
  const daChina = (x) => x.pais_da_loja === 'CN' || x.pais_da_loja === 'HK';
  const deMarca = (x) => Boolean(x.marca) && (!daChina(x) || x.classe_marca === 'conhecida');
  const livre = (x) => !deMarca(x) && !(x.regulatorio && x.regulatorio.length);

  const sinalMl = (x) => [
    typeof x.pedidos_mes === 'number' ? `${x.pedidos_mes.toLocaleString('pt-BR')} pedidos/mês (estimativa JoomPulse)` : '',
    lancamento(x, quando) ? `anúncio novo (${String(x.publicado_em).slice(0, 10)})` : '',
    typeof x.nota === 'number' && x.avaliacoes ? `nota ${x.nota} em ${x.avaliacoes.toLocaleString('pt-BR')} avaliações` : '',
  ].filter(Boolean).join(' · ');
  const doMl = (x) => ({ titulo: x.nome, detalhe: x.categoria, link: x.link, foto: x.foto, preco: x.preco, moeda: 'BRL', marca: x.marca, origem: x.origem,
    pedidos_mes: x.pedidos_mes, lancamento: lancamento(x, quando) || undefined, regulatorio: x.regulatorio, sinal: sinalMl(x) });

  const porOrigem = (pais) => {
    // Um anuncio por nome: o mesmo produto costuma vir repetido em cores ou lojas.
    const nomes = new Set();
    const daqui = itensMl.filter((x) => (pais === 'US' ? x.pais_da_loja === 'US' : x.pais_da_loja === 'CN' || x.pais_da_loja === 'HK'))
      .filter((x) => { const k = norm(x.nome); if (nomes.has(k)) return false; nomes.add(k); return true; });
    const categorias = new Map();
    for (const x of daqui) {
      const c = x.categoria.split(' > ').pop() || 'Outros';
      const e = categorias.get(c) || { categoria: c, pedidos_mes: 0, anuncios: 0 };
      e.pedidos_mes += x.pedidos_mes || 0;
      e.anuncios += 1;
      categorias.set(c, e);
    }
    return {
      total: daqui.length,
      oportunidades: daqui.filter(livre).slice(0, 15).map(doMl),
      lancamentos: daqui.filter((x) => livre(x) && lancamento(x, quando)).slice(0, 10).map(doMl),
      referencia_de_marca: daqui.filter((x) => deMarca(x) && !(x.regulatorio && x.regulatorio.length)).slice(0, 10).map(doMl),
      regulados: daqui.filter((x) => x.regulatorio && x.regulatorio.length).slice(0, 10).map(doMl),
      categorias: [...categorias.values()].sort((a, b) => b.pedidos_mes - a.pedidos_mes).slice(0, 10),
    };
  };

  const doSh = (x) => ({ titulo: x.nome, detalhe: x.categoria, link: x.link, foto: x.foto, preco: x.preco, moeda: 'BRL', marca: x.tem_marca ? x.marca : undefined,
    vendas_30_dias: x.vendas_30_dias, tendencia: x.tendencia,
    sinal: [`${(x.vendas_30_dias || 0).toLocaleString('pt-BR')} vendas em 30 dias (estimativa JoomPulse)`, x.tendencia === 'subindo' ? 'vendas subindo' : '',
      typeof x.nota === 'number' && x.avaliacoes ? `nota ${x.nota} em ${x.avaliacoes.toLocaleString('pt-BR')} avaliações` : ''].filter(Boolean).join(' · ') });
  const categoriasSh = new Map();
  for (const x of itensSh) {
    const c = String(x.categoria || '').split(' > ').pop() || 'Outros';
    const e = categoriasSh.get(c) || { categoria: c, vendas_30_dias: 0, anuncios: 0 };
    e.vendas_30_dias += x.vendas_30_dias || 0;
    e.anuncios += 1;
    categoriasSh.set(c, e);
  }

  // O mesmo tipo de produto vendido de fora no Mercado Livre e na Shopee:
  // demanda confirmada em dois canais.
  const nasDuas = [];
  const vistos = new Set();
  for (const m of itensMl.filter(livre)) {
    const pm = palavras(m.nome);
    if (pm.length < 2) continue;
    const s = itensSh.find((x) => !x.tem_marca && (() => { const ps = new Set(palavras(x.nome)); return pm.slice(0, 4).filter((w) => ps.has(w)).length >= 2; })());
    const tipo = tipoDoProduto(m.nome);
    if (!s || vistos.has(tipo)) continue;
    vistos.add(tipo);
    nasDuas.push({ titulo: m.nome, link: m.link, foto: m.foto, preco: m.preco, moeda: 'BRL', origem: m.origem,
      parecido: { titulo: s.nome, link: s.link, preco: s.preco },
      sinal: `Compra Internacional do Mercado Livre (${m.origem}, ${(m.pedidos_mes || 0).toLocaleString('pt-BR')} pedidos/mês) e loja internacional da Shopee (${(s.vendas_30_dias || 0).toLocaleString('pt-BR')} vendas em 30 dias); estimativas JoomPulse, nomes parecidos` });
    if (nasDuas.length >= 12) break;
  }

  return {
    gerado_em: quando.toISOString(),
    aviso: AVISO,
    mercado_livre_em: ml ? ml.consultado_em : null,
    shopee_em: shopee ? shopee.consultado_em : null,
    china: porOrigem('CN'),
    eua: porOrigem('US'),
    shopee: {
      total: itensSh.length,
      descartados_por_leitura_suspeita: descartados || undefined,
      oportunidades: itensSh.filter((x) => !x.tem_marca).slice(0, 15).map(doSh),
      subindo: itensSh.filter((x) => !x.tem_marca && x.tendencia === 'subindo').slice(0, 10).map(doSh),
      categorias: [...categoriasSh.values()].sort((a, b) => b.vendas_30_dias - a.vendas_30_dias).slice(0, 10),
    },
    nas_duas_lojas: nasDuas,
    pendentes: [
      { id: 'amazon', nome: 'Amazon', motivo: 'Creators API oficial: aguardando as credenciais do programa de associados.' },
      { id: 'aliexpress', nome: 'AliExpress', motivo: 'API oficial de afiliados: aguardando a aprovação da conta.' },
    ],
  };
}

function lerInternacional(agora) {
  const ml = maisRecente('ml');
  const shopee = maisRecente('shopee');
  if (!ml && !shopee) return null;
  return perspectivas(ml, shopee, agora);
}

module.exports = { AVISO, consultaInternacional, gravarInternacional, itensDoMercadoLivre, lerInternacional, perspectivas, tipoDoProduto };
