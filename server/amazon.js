'use strict';

/*
 * Amazon pela Creators API oficial (a que substituiu a PA-API 5 em 2026).
 *
 * Exige conta no programa de Associados da Amazon e credenciais da Creators
 * API (Credential ID, Credential Secret e a tag de associado). Elas chegam por
 * variaveis de ambiente e so sao enviadas aos enderecos da Amazon.
 *
 *   AMAZON_CREDENTIAL_ID       Credential ID
 *   AMAZON_CREDENTIAL_SECRET   Credential Secret
 *   AMAZON_PARTNER_TAG         tag de associado (ex.: conecta-20)
 *   AMAZON_CREDENTIAL_VERSION  3.1 (America, inclui Brasil), 3.2 (Europa) ou 3.3 (Extremo Oriente); padrao 3.1
 *   AMAZON_MARKETPLACE         padrao www.amazon.com.br
 *
 * Uso aqui: achar na Amazon o produto mais parecido com cada produto ja
 * cotado, para comparar preco. O par e por busca de texto: precisa ser conferido.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { ToolError, cleanEnv } = require('./meli');

const API = 'https://creatorsapi.amazon/catalog/v1';
const TOKEN_POR_VERSAO = {
  '3.1': 'https://api.amazon.com/auth/o2/token',
  '3.2': 'https://api.amazon.co.uk/auth/o2/token',
  '3.3': 'https://api.amazon.co.jp/auth/o2/token',
};
const MARKETPLACES = new Set(['www.amazon.com.br', 'www.amazon.com', 'www.amazon.ca', 'www.amazon.com.mx', 'www.amazon.co.uk', 'www.amazon.de',
  'www.amazon.fr', 'www.amazon.it', 'www.amazon.es', 'www.amazon.in', 'www.amazon.co.jp', 'www.amazon.com.au', 'www.amazon.sg']);
const RECURSOS = ['itemInfo.title', 'images.primary.medium', 'offersV2.listings.price', 'offersV2.listings.availability', 'browseNodeInfo.websiteSalesRank'];
const INTERVALO_MS = 1100; // uma chamada por segundo, folgado
const TIMEOUT_MS = 20000;

function config() {
  const id = cleanEnv(process.env.AMAZON_CREDENTIAL_ID);
  const segredo = cleanEnv(process.env.AMAZON_CREDENTIAL_SECRET);
  const tag = cleanEnv(process.env.AMAZON_PARTNER_TAG);
  if (!id || !segredo || !tag) return null;
  const versao = cleanEnv(process.env.AMAZON_CREDENTIAL_VERSION) || '3.1';
  const tokenUrl = TOKEN_POR_VERSAO[versao];
  if (!tokenUrl) throw new ToolError(`AMAZON_CREDENTIAL_VERSION invalida: "${versao}". Use 3.1, 3.2 ou 3.3.`);
  const marketplace = cleanEnv(process.env.AMAZON_MARKETPLACE) || 'www.amazon.com.br';
  if (!MARKETPLACES.has(marketplace)) throw new ToolError(`AMAZON_MARKETPLACE invalido: "${marketplace}".`);
  return { id, segredo, tag, tokenUrl, marketplace };
}

function configurada() {
  try { return Boolean(config()); } catch (_) { return false; }
}

function pastaAmazon() {
  const base = cleanEnv(process.env.CONECTA_HUB_SAIDA);
  return path.join(base ? path.dirname(base) : path.join(os.homedir(), 'ConectaHubSourcing'), 'amazon');
}

let token = null; // { valor, ate }

async function obterToken(cfg, buscar) {
  if (token && token.ate > Date.now() + 60000) return token.valor;
  let res;
  try {
    res = await buscar(cfg.tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ grant_type: 'client_credentials', client_id: cfg.id, client_secret: cfg.segredo, scope: 'creatorsapi::default' }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new ToolError(`Nao consegui falar com a Amazon para obter o token (${err.message}).`);
  }
  const corpo = await res.json().catch(() => ({}));
  if (!res.ok || !corpo.access_token) {
    throw new ToolError(`A Amazon recusou as credenciais (HTTP ${res.status}${corpo.error ? `, ${corpo.error}` : ''}). Confira o Credential ID, o Secret e a versao.`);
  }
  token = { valor: corpo.access_token, ate: Date.now() + (Number(corpo.expires_in) || 3600) * 1000 };
  return token.valor;
}

function itemDaAmazon(it) {
  const listagens = (it.offersV2 && it.offersV2.listings) || [];
  const preco = listagens.map((l) => l.price && l.price.money).find((m) => m && typeof m.amount === 'number');
  const ranking = it.browseNodeInfo && it.browseNodeInfo.websiteSalesRank;
  const item = {
    asin: it.asin,
    titulo: it.itemInfo && it.itemInfo.title ? it.itemInfo.title.displayValue : undefined,
    link: typeof it.detailPageURL === 'string' && /^https:\/\/www\.amazon\./.test(it.detailPageURL) ? it.detailPageURL : undefined,
    foto: it.images && it.images.primary && it.images.primary.medium ? it.images.primary.medium.url : undefined,
    preco: preco ? preco.amount : undefined,
    moeda: preco ? preco.currency : undefined,
    ranking_de_vendas: ranking && typeof ranking.salesRank === 'number' ? ranking.salesRank : undefined,
    categoria_do_ranking: ranking ? ranking.displayName : undefined,
  };
  for (const k of Object.keys(item)) if (item[k] === undefined) delete item[k];
  return item;
}

// Busca por texto na Amazon configurada. Devolve ate `quantos` itens.
async function buscarNaAmazon(termos, quantos, buscar) {
  const cfg = config();
  if (!cfg) throw new ToolError('A Amazon nao esta configurada: defina AMAZON_CREDENTIAL_ID, AMAZON_CREDENTIAL_SECRET e AMAZON_PARTNER_TAG.');
  const fazer = buscar || fetch;
  const valor = await obterToken(cfg, fazer);
  const res = await fazer(`${API}/searchItems`, {
    method: 'POST',
    headers: { authorization: `Bearer ${valor}`, 'content-type': 'application/json', 'x-marketplace': cfg.marketplace },
    body: JSON.stringify({
      keywords: String(termos).slice(0, 200),
      partnerTag: cfg.tag,
      marketplace: cfg.marketplace,
      itemCount: Math.min(10, Math.max(1, quantos || 3)),
      resources: RECURSOS,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const corpo = await res.json().catch(() => ({}));
  if (res.status === 401) token = null;
  if (!res.ok) {
    const motivo = (corpo.errors && corpo.errors[0] && (corpo.errors[0].message || corpo.errors[0].code)) || corpo.message || '';
    throw new ToolError(`A Amazon respondeu HTTP ${res.status} na busca${motivo ? ` (${motivo})` : ''}.`);
  }
  return ((corpo.searchResult && corpo.searchResult.items) || []).map(itemDaAmazon);
}

// Termos de busca a partir do nome do produto: as primeiras palavras, sem cor e tamanho.
function termosDoProduto(nome) {
  return String(nome || '').replace(/\b(cor|tamanho|kit)\b.*$/i, '').split(/\s+/).filter(Boolean).slice(0, 7).join(' ');
}

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

// Para cada produto ja cotado, o resultado mais relevante na Amazon.
async function compararNaAmazon(produtos, buscar, pausa = INTERVALO_MS) {
  const cfg = config();
  if (!cfg) throw new ToolError('A Amazon nao esta configurada: defina AMAZON_CREDENTIAL_ID, AMAZON_CREDENTIAL_SECRET e AMAZON_PARTNER_TAG.');
  const itens = [];
  for (const p of produtos) {
    const busca = termosDoProduto(p.nome);
    try {
      const [primeiro] = await buscarNaAmazon(busca, 3, buscar);
      itens.push({ produto_id: p.id, produto: p.nome, busca, amazon: primeiro || null });
    } catch (err) {
      if (!(err instanceof ToolError)) throw err;
      itens.push({ produto_id: p.id, produto: p.nome, busca, erro: err.message });
      if (/HTTP 4(01|03)|credenciais/.test(err.message)) break;
    }
    if (pausa) await espera(pausa);
  }
  const dados = {
    fonte: 'Amazon Creators API',
    marketplace: cfg.marketplace,
    consultado_em: new Date().toISOString(),
    aviso: 'O par com a Amazon e o primeiro resultado da busca pelo nome do produto; confira se e o mesmo item. Ranking de vendas e posicao na categoria da Amazon, nao quantidade vendida.',
    itens,
  };
  fs.mkdirSync(pastaAmazon(), { recursive: true });
  fs.writeFileSync(path.join(pastaAmazon(), 'comparacao.json'), JSON.stringify(dados, null, 2), 'utf8');
  return dados;
}

function lerComparacao() {
  try {
    return JSON.parse(fs.readFileSync(path.join(pastaAmazon(), 'comparacao.json'), 'utf8'));
  } catch (_) {
    return null;
  }
}

// So para os testes: zera o token guardado.
function esquecerToken() { token = null; }

module.exports = { buscarNaAmazon, compararNaAmazon, configurada, esquecerToken, lerComparacao, termosDoProduto };
