'use strict';

/*
 * Catalogo JoomPro: produtos que um vendedor brasileiro pode importar da
 * China pelo JoomPro, com o produto do Mercado Livre que mais se parece.
 *
 * Os dados chegam pelo conector JoomPulse (ferramenta query_cubejs_joompro,
 * cubo JprProductsMeli), que so o Claude alcanca; aqui a resposta e
 * normalizada e gravada em disco.
 *
 * Tres ressalvas da propria fonte, que precisam sair junto com os numeros:
 * - o par com o Mercado Livre e automatico, por semelhanca de foto e titulo.
 *   Com semelhanca de 0,90 ou mais, so cerca de um par em tres e de fato o
 *   mesmo produto; a margem sem a semelhanca ao lado engana;
 * - o custo e o custo posto no Brasil no MENOR preco entre as faixas de
 *   quantidade, nao o preco no pedido minimo, que e maior;
 * - os pedidos do Mercado Livre sao estimativa do JoomPulse.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { ToolError, cleanEnv } = require('./meli');

const AVISO = 'O par com o Mercado Livre e automatico, por semelhanca; confira se e o mesmo produto antes de usar a margem. ' +
  'O custo e o custo posto no Brasil no menor preco entre as faixas de quantidade, nao o preco no pedido minimo.';
const SEMELHANCA_MINIMA = 0.9;

function pastaJoompro() {
  const base = cleanEnv(process.env.CONECTA_HUB_SAIDA);
  return path.join(base ? path.dirname(base) : path.join(os.homedir(), 'ConectaHubSourcing'), 'joompro');
}

// A consulta que o Claude envia a query_cubejs_joompro: as melhores escolhas
// do catalogo que tem par no Mercado Livre com semelhanca alta.
function consultaJoompro() {
  const c = (n) => `JprProductsMeli.${n}`;
  return JSON.stringify({
    dimensions: ['joomproProductId', 'title', 'imageUrl', 'l1CategoryName', 'categoryName', 'qualityScore', 'joomproPriceAmount', 'minAvailableMoq',
      'smallBatchAvailable', 'volumetricEfficient', 'joomproUrl', 'score', 'productId', 'meliTitle', 'meliL1CategoryName', 'meliPriceMin',
      'meliNumListings', 'meliCatalogOrders1m', 'profit', 'marginality', 'meliUrl', 'asOfDate'].map(c),
    filters: [
      { member: c('hasMeliMatch'), operator: 'equals', values: ['true'] },
      { member: c('score'), operator: 'gte', values: [String(SEMELHANCA_MINIMA)] },
    ],
    // Pela nota da vitrine, nao pela margem: ordenar por margem poe os piores pares no topo.
    order: [[c('qualityScore'), 'desc']],
    limit: 100,
  });
}

const httpsDe = (dominios) => (u) => {
  try {
    const x = new URL(String(u));
    return x.protocol === 'https:' && dominios.some((d) => x.hostname === d || x.hostname.endsWith(`.${d}`)) ? x.href : undefined;
  } catch (_) {
    return undefined;
  }
};
const fotoValida = httpsDe(['alicdn.com', 'joomprocdn.net']);
const linkJoompro = httpsDe(['joom.pro']);
const linkMeli = httpsDe(['mercadolivre.com.br']);

function itensDaResposta(resposta) {
  let r;
  try {
    r = typeof resposta === 'string' ? JSON.parse(resposta) : resposta;
  } catch (_) {
    throw new ToolError('A resposta do JoomPulse nao e um JSON valido. Passe o resultado de query_cubejs_joompro sem alterar.');
  }
  if (!r || !Array.isArray(r.columns) || !Array.isArray(r.data)) throw new ToolError('A resposta do JoomPulse precisa ter "columns" e "data".');
  const col = (nome) => r.columns.findIndex((c) => c === nome || c.endsWith(`.${nome}`));
  if (col('joomproProductId') < 0 || col('joomproUrl') < 0) throw new ToolError('A resposta do JoomPulse nao traz joomproProductId e joomproUrl.');
  const numero = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : undefined);
  return r.data.map((linha) => {
    const v = (n) => { const i = col(n); return i >= 0 && linha[i] !== null ? linha[i] : undefined; };
    const item = {
      id: String(v('joomproProductId')),
      // Titulo em ingles, traduzido por maquina na origem.
      titulo: String(v('title') || '').trim() || undefined,
      foto: fotoValida(v('imageUrl')),
      categoria: [v('l1CategoryName'), v('categoryName')].filter(Boolean).join(' > '),
      nota_da_vitrine: numero(v('qualityScore')),
      custo_no_brasil: numero(v('joomproPriceAmount')),
      pedido_minimo: numero(v('minAvailableMoq')),
      lote_pequeno: v('smallBatchAvailable') === true,
      frete_pelo_peso_real: v('volumetricEfficient') === true,
      link: linkJoompro(v('joomproUrl')),
      semelhanca: numero(v('score')),
      mercado_livre: {
        id: v('productId'),
        titulo: v('meliTitle'),
        categoria: v('meliL1CategoryName'),
        menor_preco: numero(v('meliPriceMin')),
        anuncios: numero(v('meliNumListings')),
        pedidos_estimados_no_mes: numero(v('meliCatalogOrders1m')),
        link: linkMeli(v('meliUrl')),
      },
      diferenca: numero(v('profit')),
      margem: numero(v('marginality')),
      catalogo_de: v('asOfDate'),
    };
    for (const alvo of [item, item.mercado_livre]) for (const k of Object.keys(alvo)) if (alvo[k] === undefined) delete alvo[k];
    return item;
  }).filter((x) => x.link);
}

function gravarJoompro(resposta, agora) {
  const itens = itensDaResposta(resposta);
  if (!itens.length) throw new ToolError('A resposta do JoomPulse veio sem itens.');
  const quando = agora || new Date();
  const dois = (n) => String(n).padStart(2, '0');
  const dia = `${quando.getFullYear()}-${dois(quando.getMonth() + 1)}-${dois(quando.getDate())}`;
  const dados = { fonte: 'JoomPulse (catalogo JoomPro)', consultado_em: quando.toISOString(), semelhanca_minima: SEMELHANCA_MINIMA, aviso: AVISO, itens };
  fs.mkdirSync(pastaJoompro(), { recursive: true });
  const arquivo = path.join(pastaJoompro(), `joompro-${dia}.json`);
  fs.writeFileSync(arquivo, JSON.stringify(dados, null, 2), 'utf8');
  return { arquivo, itens: itens.length, lote_pequeno: itens.filter((x) => x.lote_pequeno).length };
}

function lerJoompro() {
  let nomes;
  try {
    nomes = fs.readdirSync(pastaJoompro()).filter((n) => /^joompro-\d{4}-\d{2}-\d{2}\.json$/.test(n)).sort();
  } catch (_) {
    return null;
  }
  if (!nomes.length) return null;
  try {
    return JSON.parse(fs.readFileSync(path.join(pastaJoompro(), nomes[nomes.length - 1]), 'utf8'));
  } catch (_) {
    return null;
  }
}

module.exports = { AVISO, consultaJoompro, gravarJoompro, itensDaResposta, lerJoompro };
