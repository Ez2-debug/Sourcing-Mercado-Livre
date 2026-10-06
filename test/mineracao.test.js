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
  MLB200: produto('MLB200', 'Garrafa Térmica Inox 1 Litro', 'Xiaomi'),
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

test('termo em alta so bate com palavras inteiras, incluindo numeros', () => {
  const { termosRelacionados, sinaisRegulatorios } = require('../server/mineracao');
  const nome = 'Power Bank 20000mAh Para iPhone e Samsung';
  assert.deepEqual(termosRelacionados(nome, ['iphone 11', 'power bank', 'radio px']), ['power bank']);
  assert.deepEqual(sinaisRegulatorios('Kit Chave Precisão 115 Peças'), [], 'o nome da categoria nao entra no alerta');
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

test('painel traz indicadores, sugestoes e a variacao entre mineracoes', async () => {
  const primeira = await minerarCategoria('MLB1', {});
  primeira.consultado_em = '2026-01-01T10:00:00.000Z';
  saida.salvarMineracao(primeira);

  // Na segunda leitura o organizador cai de 1º para 2º no ranking da raiz.
  RANKINGS.MLB1[0].position = 2;
  RANKINGS.MLB1[1].position = 1;
  const segunda = await minerarCategoria('MLB1', {});
  segunda.consultado_em = '2026-01-08T10:00:00.000Z';
  const arq = saida.salvarMineracao(segunda);
  const ind = arq.indicadores;

  assert.deepEqual(ind.triagem, { apto: 1, marca_registrada: 1, regulado: 1, proibido: 1, sem_detalhe: 1 });
  assert.equal(ind.totais.aptos_para_cotacao, 1);
  assert.equal(ind.vendas.registros_com_campo_de_venda.length, 0);
  assert.match(ind.vendas.observacao, /nao devolveu nenhum campo de vendas/);

  assert.equal(ind.sugestoes[0].id, 'MLB100', 'o apto vem primeiro');
  assert.ok(ind.sugestoes[0].motivos.includes('sem marca registrada'));
  assert.ok(!ind.sugestoes.some((s) => s.id === 'MLB300'), 'proibido nunca e sugerido');
  assert.match(ind.sugestoes.find((s) => s.id === 'MLB200').ressalvas[0], /marca registrada \(Xiaomi\)/);

  assert.deepEqual(ind.variacao.subiram.map((x) => x.id), ['MLB200']);
  assert.deepEqual(ind.variacao.desceram.map((x) => [x.id, x.posicao_anterior, x.posicao]), [['MLB100', 1, 2]]);

  const html = fs.readFileSync(arq.painel, 'utf8');
  assert.match(html, /Triagem para cotação/);
  assert.match(html, /1º → 2º/);
  assert.equal(saida.gerarPainel(saida.carregarMineracao(arq.id)).indicadores.variacao.mineracao_anterior, '20260101-100000-MLB1');
});

test('so marca conhecida barra; marca de vendedor segue com aviso', () => {
  const { classificarMarca } = require('../server/marcas');
  const { situacao, sugerir } = require('../server/indicadores');
  const { sinaisRegulatorios } = require('../server/mineracao');
  assert.equal(classificarMarca('Tramontina'), 'conhecida');
  assert.equal(classificarMarca('Philips Walita'), 'conhecida');
  assert.equal(classificarMarca('Marqs Home'), 'de_vendedor');
  assert.equal(classificarMarca('Genérica'), 'sem_marca');

  const produto = (marca_conhecida) => ({
    id: 'MLB1', nome: 'Mangueira De Jardim 50m', marca: 'Marqs Home', categoria: 'Jardim', melhor_posicao: 1,
    aparicoes: [{}], tendencias_relacionadas: [], sinais: { sem_marca: false, marca_conhecida, regulatorio: [] },
    prioridade: { pontos: 50, componentes: {} },
  });
  assert.equal(situacao(produto(false)), 'apto');
  assert.equal(situacao(produto(true)), 'marca_registrada');
  const antiga = produto(false);
  delete antiga.sinais.marca_conhecida;
  assert.equal(situacao(antiga), 'marca_registrada', 'mineracao antiga continua barrando qualquer marca');
  const [s] = sugerir({ categorias: [{ produtos: [produto(false)] }] }, 1);
  assert.equal(s.apto, true);
  assert.match(s.ressalvas[0], /marca do vendedor \(Marqs Home\)/);

  const orgaos = (n) => sinaisRegulatorios(n).map((r) => r.orgao);
  assert.deepEqual(orgaos('Ducha Eletrônica 7500W'), ['Inmetro']);
  assert.deepEqual(orgaos('Percarbonato De Sódio 1kg'), ['Anvisa']);
  assert.deepEqual(orgaos('Kit 10 Potes De Vidro Hermético Marmita Forno Micro-ondas Airfryer'), [], 'uso citado no fim do nome nao conta');
  assert.deepEqual(orgaos('Capa Protetora Colchão Box Casal'), [], 'acessorio nao herda a exigencia');
  assert.deepEqual(orgaos('Suporte De Celular Veicular Bluetooth'), ['Anatel']);
});

test('sugere NCM pela tabela oficial e so da codigo quando ha palavra em comum', async () => {
  process.env.NCM_TABELA = path.join(__dirname, 'fixtures', 'ncm-recorte.json');
  const { anotarNcm, carregarTabela, sugerirNcm } = require('../server/ncm');
  const t = await carregarTabela();

  const rodizio = sugerirNcm(t, 'Kit 8 Rodinhas Para Moveis Rodízio Roda 50mm', '');
  assert.deepEqual(rodizio.posicao.map((p) => p.codigo), ['83.02', '83.01']);
  assert.ok(rodizio.sugestoes.some((s) => s.codigo === '8302.20.00'), 'rodizios');

  const cortina = sugerirNcm(t, 'Cortina Blackout 4,00x2,80 Metros', '');
  assert.equal(cortina.posicao[0].codigo, '63.03');
  assert.deepEqual(cortina.sugestoes, [], 'sem palavra em comum fica so a posicao');

  assert.deepEqual(sugerirNcm(t, 'Power Bank 20000mAh', '').sugestoes.map((s) => s.codigo), ['8507.60.00'], 'unico codigo na subposicao');
  assert.equal(sugerirNcm(t, 'Suporte De Celular Veicular', ''), null, 'tipo fora do dicionario');

  const produtos = [{ id: 'A', nome: 'Kit 10 Pote De Vidro Hermético', atributos: [{ nome: 'Material', valor: 'Vidro' }] }, { id: 'B' }];
  const resumo = await anotarNcm(produtos);
  assert.equal(resumo.disponivel, true);
  assert.equal(resumo.produtos_com_sugestao, 1);
  assert.equal(produtos[0].ncm.posicao[0].codigo, '70.13');
});

test('registra estimativas de terceiros e mostra no painel com a fonte', async () => {
  const { registrarEstimativas } = require('../server/estimativas');
  const m = await minerarCategoria('MLB1', {});
  m.consultado_em = '2026-02-01T10:00:00.000Z';
  const arq = saida.salvarMineracao(m);
  assert.equal(arq.indicadores.estimativas_externas, null);

  const gravada = saida.carregarMineracao(arq.id);
  const registro = registrarEstimativas(gravada, {
    fonte: 'JoomPulse',
    estimativas: [{ produto_id: 'mlb100', vendas: 320, faturamento: 9568 }, { produto_id: 'MLB999', vendas: 5 }],
  });
  assert.deepEqual([registro.registrados, registro.fora_da_mineracao], [1, ['MLB999']]);
  const { painel, indicadores } = saida.regravarMineracao(gravada);

  assert.deepEqual(indicadores.estimativas_externas.fontes, ['JoomPulse']);
  assert.equal(indicadores.estimativas_externas.ranking_por_vendas[0].valor, 320);
  assert.ok(indicadores.sugestoes[0].motivos.some((x) => /estimativa da JoomPulse: 320 un\. · R\$ 9\.568 por semana/.test(x)));
  assert.match(fs.readFileSync(painel, 'utf8'), /Estimativas de JoomPulse, não transações reais/);
  assert.equal(saida.carregarMineracao(arq.id).categorias.flatMap((c) => c.produtos).find((p) => p.id === 'MLB100').estimativa_externa.vendas, 320);

  assert.throws(() => registrarEstimativas(gravada, { fonte: '', estimativas: [{ produto_id: 'MLB100', vendas: 1 }] }), /Informe a fonte/);
  assert.throws(() => registrarEstimativas(gravada, { fonte: 'X', estimativas: [{ produto_id: 'MLB100', vendas: -1 }] }), /vendas invalido/);
  assert.throws(() => registrarEstimativas(gravada, { fonte: 'X', estimativas: [{ produto_id: 'MLB999', vendas: 1 }] }), /Nenhum produto_id/);
});
