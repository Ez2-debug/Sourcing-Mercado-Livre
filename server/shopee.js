'use strict';

/*
 * Produtos da Shopee Brasil, a partir do JoomPulse.
 *
 * A Shopee nao tem API aberta de ranking como a do Mercado Livre. Os dados
 * chegam pelo conector JoomPulse (ferramenta query_cubejs_shopee, cubo
 * ShbMartItem), que so o Claude alcanca; aqui a resposta e normalizada e
 * gravada em disco para a central e o aplicativo web lerem.
 *
 * Vendas e faturamento sao ESTIMATIVAS do JoomPulse, calculadas a partir do
 * contador publico arredondado da Shopee ("X mil vendidos"); nao sao vendas
 * reais. Preco, avaliacoes e nota sao os publicados no anuncio.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { ToolError, cleanEnv } = require('./meli');

const AVISO = 'Vendas e faturamento sao estimativas do JoomPulse, calculadas a partir do contador publico arredondado da Shopee; nao sao vendas reais.';

function pastaShopee() {
  const base = cleanEnv(process.env.CONECTA_HUB_SAIDA);
  return path.join(base ? path.dirname(base) : path.join(os.homedir(), 'ConectaHubSourcing'), 'shopee');
}

// A consulta que o Claude envia a query_cubejs_shopee: os 100 itens com maior
// venda estimada em 30 dias.
function consultaShopee() {
  const c = (n) => `ShbMartItem.${n}`;
  return JSON.stringify({
    dimensions: ['itemId', 'shopId', 'itemName', 'categoryL1Name', 'categoryName', 'shopName', 'shopLocation', 'itemCreationDate', 'hasBrand', 'brandName'].map(c),
    measures: ['price', 'itemImage', 'sold30Days', 'revenue30Days', 'salesTrend', 'reviewsCount', 'reviewsRating', 'sold1y'].map(c),
    order: [[c('sold30Days'), 'desc']],
    limit: 100,
  });
}

// "+10" ou mais e crescimento, "-10" ou menos e queda (regra do JoomPulse).
function tendencia(pct) {
  if (typeof pct !== 'number') return null;
  if (pct > 10) return 'subindo';
  if (pct < -10) return 'caindo';
  return 'estavel';
}

function itensDaResposta(resposta) {
  let r;
  try {
    r = typeof resposta === 'string' ? JSON.parse(resposta) : resposta;
  } catch (_) {
    throw new ToolError('A resposta do JoomPulse nao e um JSON valido. Passe o resultado de query_cubejs_shopee sem alterar.');
  }
  if (!r || !Array.isArray(r.columns) || !Array.isArray(r.data)) {
    throw new ToolError('A resposta do JoomPulse precisa ter "columns" e "data".');
  }
  const col = (nome) => r.columns.findIndex((c) => c === nome || c.endsWith(`.${nome}`));
  const i = {};
  for (const n of ['itemId', 'shopId', 'itemName', 'categoryL1Name', 'categoryName', 'shopName', 'shopLocation', 'itemCreationDate',
    'hasBrand', 'brandName', 'price', 'itemImage', 'sold30Days', 'revenue30Days', 'salesTrend', 'reviewsCount', 'reviewsRating', 'sold1y']) i[n] = col(n);
  if (i.itemId < 0 || i.itemName < 0) throw new ToolError('A resposta do JoomPulse nao traz itemId e itemName.');
  const v = (linha, n) => (i[n] >= 0 && linha[i[n]] !== null && linha[i[n]] !== undefined ? linha[i[n]] : undefined);
  const numero = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : undefined);
  return r.data.map((linha) => {
    const itemId = String(v(linha, 'itemId'));
    const shopId = v(linha, 'shopId') === undefined ? undefined : String(v(linha, 'shopId'));
    const imagem = v(linha, 'itemImage');
    const pct = numero(v(linha, 'salesTrend'));
    const item = {
      id: itemId,
      loja_id: shopId,
      nome: String(v(linha, 'itemName') || '').trim(),
      categoria: [v(linha, 'categoryL1Name'), v(linha, 'categoryName')].filter(Boolean).join(' > '),
      loja: v(linha, 'shopName'),
      local_da_loja: v(linha, 'shopLocation'),
      criado_em: v(linha, 'itemCreationDate'),
      tem_marca: v(linha, 'hasBrand') === true,
      marca: v(linha, 'brandName'),
      preco: numero(v(linha, 'price')),
      // Endereco montado pelo padrao do CDN de imagens da Shopee; pode nao abrir.
      foto: typeof imagem === 'string' && /^[\w-]+$/.test(imagem) ? `https://down-br.img.susercontent.com/file/${imagem}` : undefined,
      link: shopId ? `https://shopee.com.br/product/${shopId}/${itemId}` : undefined,
      vendas_30_dias: numero(v(linha, 'sold30Days')),
      faturamento_30_dias: numero(v(linha, 'revenue30Days')) === undefined ? undefined : Math.round(numero(v(linha, 'revenue30Days'))),
      tendencia: tendencia(pct),
      tendencia_percentual: pct,
      avaliacoes: numero(v(linha, 'reviewsCount')),
      nota: numero(v(linha, 'reviewsRating')),
      vendidos_no_total: numero(v(linha, 'sold1y')),
    };
    for (const k of Object.keys(item)) if (item[k] === undefined) delete item[k];
    return item;
  }).filter((x) => x.nome);
}

// Grava a leitura do dia. Rodar de novo no mesmo dia substitui o arquivo.
function gravarShopee(resposta, agora) {
  const itens = itensDaResposta(resposta);
  if (!itens.length) throw new ToolError('A resposta do JoomPulse veio sem itens.');
  const quando = agora || new Date();
  const dois = (n) => String(n).padStart(2, '0');
  const dia = `${quando.getFullYear()}-${dois(quando.getMonth() + 1)}-${dois(quando.getDate())}`;
  const dados = { fonte: 'JoomPulse', consultado_em: quando.toISOString(), aviso: AVISO, itens };
  fs.mkdirSync(pastaShopee(), { recursive: true });
  const arquivo = path.join(pastaShopee(), `shopee-${dia}.json`);
  fs.writeFileSync(arquivo, JSON.stringify(dados, null, 2), 'utf8');
  return { arquivo, itens: itens.length, sem_marca: itens.filter((x) => !x.tem_marca).length };
}

// A leitura mais recente, ou null quando ainda nao ha nenhuma.
function lerShopee() {
  let nomes;
  try {
    nomes = fs.readdirSync(pastaShopee()).filter((n) => /^shopee-\d{4}-\d{2}-\d{2}\.json$/.test(n)).sort();
  } catch (_) {
    return null;
  }
  if (!nomes.length) return null;
  try {
    return JSON.parse(fs.readFileSync(path.join(pastaShopee(), nomes[nomes.length - 1]), 'utf8'));
  } catch (_) {
    return null;
  }
}

module.exports = { AVISO, consultaShopee, gravarShopee, itensDaResposta, lerShopee, pastaShopee };
