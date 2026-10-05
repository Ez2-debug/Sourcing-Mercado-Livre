'use strict';

// Testa a mineracao e o envio ao Accio contra uma API simulada em 127.0.0.1.
// Rodar com: npm test

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { after, before, test } = require('node:test');

const CATEGORIAS = {
  MLB1: {
    id: 'MLB1', name: 'Casa, Móveis e Decoração', picture: 'https://http2.mlstatic.com/cat1.png',
    permalink: 'https://www.mercadolivre.com.br/c/casa', total_items_in_this_category: 900,
    path_from_root: [{ id: 'MLB1', name: 'Casa, Móveis e Decoração' }],
    children_categories: [
      { id: 'MLB11', name: 'Organização para Casa', total_items_in_this_category: 500 },
      { id: 'MLB12', name: 'Outros', total_items_in_this_category: 400 },
      { id: 'MLB13', name: 'Iluminação Residencial', total_items_in_this_category: 100 },
    ],
  },
  MLB11: {
    id: 'MLB11', name: 'Organização para Casa', total_items_in_this_category: 500,
    path_from_root: [{ id: 'MLB1', name: 'Casa, Móveis e Decoração' }, { id: 'MLB11', name: 'Organização para Casa' }],
    children_categories: [],
  },
  MLB13: {
    id: 'MLB13', name: 'Iluminação Residencial', total_items_in_this_category: 100,
    path_from_root: [{ id: 'MLB1', name: 'Casa, Móveis e Decoração' }, { id: 'MLB13', name: 'Iluminação Residencial' }],
    children_categories: [],
  },
};

const RANKINGS = {
  MLB1: [{ id: 'MLB100', position: 1, type: 'PRODUCT' }, { id: 'MLB200', position: 2, type: 'PRODUCT' }, { id: 'MLBU900', position: 3, type: 'USER_PRODUCT' }],
  MLB11: [{ id: 'MLB100', position: 4, type: 'PRODUCT' }, { id: 'MLB300', position: 1, type: 'PRODUCT' }],
  MLB13: [{ id: 'MLB400', position: 1, type: 'PRODUCT' }],
};

const TENDENCIAS = { MLB11: [{ keyword: 'organizador de gaveta', url: 'https://lista.mercadolivre.com.br/x' }] };

const produto = (id, name, marca) => ({
  id, name, status: 'active', permalink: '', domain_id: 'MLB-X',
  pictures: [{ url: `http://http2.mlstatic.com/${id}-a.jpg` }, { url: `https://http2.mlstatic.com/${id}-b.jpg` }],
  attributes: marca ? [{ id: 'BRAND', name: 'Marca', value_name: marca }] : [],
  main_features: [{ text: 'Destaque' }],
});

const PRODUTOS = {
  MLB100: produto('MLB100', 'Organizador De Gaveta Colmeia 12 Nichos', 'Genérica'),
  MLB200: produto('MLB200', 'Aspirador Robô Inteligente', 'Xiaomi'),
  MLB300: produto('MLB300', 'Vape Descartável Organizador', ''),
  MLB400: produto('MLB400', 'Lâmpada Led Bulbo 9w', 'Genérica'),
};

const ANUNCIOS = {
  MLB100: { paging: { total: 2 }, results: [
    { item_id: 'MLB5001', price: 39.9, currency_id: 'BRL', seller_id: 1, shipping: { logistic_type: 'fulfillment' } },
    { item_id: 'MLB5002', price: 29.9, currency_id: 'BRL', seller_id: 2, official_store_id: 7, shipping: { logistic_type: 'xd_drop_off' } },
  ] },
  MLB200: { paging: { total: 150 }, results: [{ item_id: 'MLB5003', price: 899, currency_id: 'BRL', seller_id: 3 }] },
  MLB300: { paging: { total: 1 }, results: [{ item_id: 'MLB5004', price: 50, currency_id: 'BRL', seller_id: 4 }] },
  MLB400: { paging: { total: 5 }, results: [{ item_id: 'MLB5005', price: 9.9, currency_id: 'BRL', seller_id: 5 }] },
};

function rota(url) {
  let m;
  if ((m = url.match(/^\/categories\/(\w+)$/))) return CATEGORIAS[m[1]];
  if ((m = url.match(/^\/highlights\/MLB\/category\/(\w+)$/))) return RANKINGS[m[1]] && { content: RANKINGS[m[1]] };
  if ((m = url.match(/^\/trends\/MLB\/(\w+)$/))) return TENDENCIAS[m[1]];
  if ((m = url.match(/^\/products\/(\w+)\/items$/))) return ANUNCIOS[m[1]];
  if ((m = url.match(/^\/products\/(\w+)$/))) return PRODUTOS[m[1]];
  return undefined;
}

let servidor;
let tmp;
let minerarCategoria;
let saida;

before(async () => {
  servidor = http.createServer((req, res) => {
    const responder = (status, corpo) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(corpo));
    };
    if (req.method === 'POST' && req.url === '/oauth/token') return responder(200, { access_token: 't', expires_in: 21600 });
    if (req.url.startsWith('/user-products/')) return responder(403, { message: 'forbidden' });
    const corpo = rota(req.url);
    return corpo ? responder(200, corpo) : responder(404, { message: 'not found' });
  });
  await new Promise((ok) => servidor.listen(0, '127.0.0.1', ok));
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'conecta-hub-'));
  fs.mkdirSync(path.join(tmp, 'accio'));
  // meli.js le o ambiente ao ser carregado; por isso os require vem depois.
  process.env.MELI_API_BASE = `http://127.0.0.1:${servidor.address().port}`;
  process.env.MELI_CLIENT_SECRET = 'segredo-de-teste';
  process.env.CONECTA_HUB_SAIDA = path.join(tmp, 'mineracoes');
  process.env.ACCIO_WORK_DIR = path.join(tmp, 'accio');
  ({ minerarCategoria } = require('../server/mineracao'));
  saida = require('../server/saida');
});

after(() => {
  servidor.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('agrupa os produtos pela categoria mais especifica, com nome e foto', async () => {
  const m = await minerarCategoria('MLB1', {});
  assert.deepEqual(m.categorias.map((c) => c.id), ['MLB1', 'MLB11', 'MLB13'], 'a subcategoria "Outros" fica de fora');

  const org = m.categorias.find((c) => c.id === 'MLB11');
  assert.equal(org.caminho, 'Casa, Móveis e Decoração > Organização para Casa');
  assert.deepEqual(org.produtos.map((p) => p.id).sort(), ['MLB100', 'MLB300']);
  assert.equal(org.foto_e_de_produto, true, 'sem imagem propria, a capa vem de um produto');
  assert.equal(m.categorias[0].foto, 'https://http2.mlstatic.com/cat1.png');

  const gaveta = org.produtos.find((p) => p.id === 'MLB100');
  assert.equal(gaveta.melhor_posicao, 1);
  assert.equal(gaveta.aparicoes.length, 2);
  assert.equal(gaveta.foto, 'https://http2.mlstatic.com/MLB100-a.jpg', 'foto sempre em https');
  assert.equal(gaveta.anuncios.menor_preco.valor, 29.9);
  assert.equal(gaveta.anuncios.vendedores, 2);
  assert.equal(gaveta.anuncios.no_full, 1);
  assert.deepEqual(gaveta.tendencias_relacionadas, ['organizador de gaveta']);
  assert.equal(gaveta.sinais.sem_marca, true);
});

test('sinaliza marca, regulacao e produto proibido', async () => {
  const m = await minerarCategoria('MLB1', {});
  const todos = m.categorias.flatMap((c) => c.produtos);
  const por = (id) => todos.find((p) => p.id === id);

  assert.equal(por('MLB200').sinais.sem_marca, false);
  assert.deepEqual(por('MLB400').sinais.regulatorio.map((r) => r.orgao), ['Inmetro']);
  assert.equal(por('MLB300').prioridade.pontos, 0, 'proibido zera a prioridade');
  assert.equal(por('MLBU900').detalhe_indisponivel, 'HTTP 403');
  assert.equal(m.resumo.produtos_sem_detalhe, 1);
});

test('profundidade 0 minera so a categoria informada', async () => {
  const m = await minerarCategoria('MLB1', { profundidade: 0 });
  assert.deepEqual(m.categorias.map((c) => c.id), ['MLB1']);
  assert.equal(m.categorias[0].produtos.length, 3);
});

test('recusa parametros fora do limite', async () => {
  await assert.rejects(() => minerarCategoria('MLB1', { profundidade: 9 }), /profundidade invalido/);
});

test('grava o catalogo e envia ao Accio so o que passa nos filtros', async () => {
  const m = await minerarCategoria('MLB1', {});
  const arq = saida.salvarMineracao(m);
  const html = fs.readFileSync(arq.catalogo, 'utf8');
  assert.match(html, /Casa, Móveis e Decoração &gt; Organização para Casa/);
  assert.match(html, /<img[^>]+MLB100-a\.jpg/);

  const envio = saida.enviarParaAccio(saida.carregarMineracao(), {});
  assert.equal(envio.produtos_enviados, 1);
  assert.deepEqual(envio.descartados, { proibido: 1, regulado: 1, marca_registrada: 1, sem_detalhe: 1 });
  const pacote = JSON.parse(fs.readFileSync(path.join(envio.pasta, 'produtos.json'), 'utf8'));
  assert.deepEqual(pacote.produtos.map((p) => p.id), ['MLB100']);
  const briefing = fs.readFileSync(path.join(envio.pasta, 'briefing-sourcing.md'), 'utf8');
  assert.match(briefing, /!\[Organizador De Gaveta Colmeia 12 Nichos\]\(https:\/\/http2\.mlstatic\.com\/MLB100-a\.jpg\)/);

  const amplo = saida.enviarParaAccio(saida.carregarMineracao(arq.id), { incluir_marcas: true, incluir_regulados: true });
  assert.equal(amplo.produtos_enviados, 3, 'o proibido nunca segue');
  assert.throws(() => saida.carregarMineracao('../fora'), /nao encontrado/);
});
