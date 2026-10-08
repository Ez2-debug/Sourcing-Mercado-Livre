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
  id, name, status: 'active', permalink: '', domain_id: 'MLB-X', date_created: '2024-01-23T03:41:51Z', last_updated: '2026-05-20T14:26:55Z',
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

const SUPABASE = { pedidos: [], semTabela: false };

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
    if (req.url.startsWith('/rest/v1/')) {
      let corpo = '';
      req.on('data', (d) => { corpo += d; });
      req.on('end', () => {
        const tabela = req.url.split('/')[3].split('?')[0];
        SUPABASE.pedidos.push({ tabela, url: req.url, chave: req.headers.apikey, prefer: req.headers.prefer, linhas: JSON.parse(corpo) });
        if (SUPABASE.semTabela) return responder(404, { code: 'PGRST205', message: 'Could not find the table in the schema cache' });
        return responder(201, {});
      });
      return undefined;
    }
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
    estimativas: [{ produto_id: 'mlb100', vendas: 320, faturamento: 9568, crescimento_percentual: 18.5, tendencia: 'subindo' }, { produto_id: 'MLB999', vendas: 5 }],
  });
  assert.deepEqual([registro.registrados, registro.fora_da_mineracao], [1, ['MLB999']]);
  const { painel, indicadores } = saida.regravarMineracao(gravada);

  assert.deepEqual(indicadores.estimativas_externas.fontes, ['JoomPulse']);
  assert.equal(indicadores.estimativas_externas.ranking_por_vendas[0].valor, 320);
  assert.ok(indicadores.sugestoes[0].motivos.some((x) => /estimativa da JoomPulse: 320 un\. · R\$ 9\.568 por semana, tendência subindo \(\+18,5%\)/.test(x)));
  assert.match(fs.readFileSync(painel, 'utf8'), /Estimativas de JoomPulse, não transações reais/);
  assert.equal(saida.carregarMineracao(arq.id).categorias.flatMap((c) => c.produtos).find((p) => p.id === 'MLB100').estimativa_externa.vendas, 320);

  assert.throws(() => registrarEstimativas(gravada, { fonte: '', estimativas: [{ produto_id: 'MLB100', vendas: 1 }] }), /Informe a fonte/);
  assert.throws(() => registrarEstimativas(gravada, { fonte: 'X', estimativas: [{ produto_id: 'MLB100', vendas: -1 }] }), /vendas invalido/);
  assert.throws(() => registrarEstimativas(gravada, { fonte: 'X', estimativas: [{ produto_id: 'MLB999', vendas: 1 }] }), /Nenhum produto_id/);
});

test('grava a mineracao no Supabase e so envia a chave ao proprio Supabase', async () => {
  const supabase = require('../server/supabase');
  const m = await minerarCategoria('MLB1', {});
  m.consultado_em = '2026-03-01T10:00:00.000Z';
  saida.salvarMineracao(m);

  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_KEY;
  assert.equal(await supabase.salvarSeConfigurado(m), undefined, 'sem configuracao nada e enviado');
  await assert.rejects(() => supabase.salvarNoSupabase(m), /nao esta configurado/);

  process.env.SUPABASE_KEY = 'chave-de-teste';
  process.env.SUPABASE_URL = 'https://exemplo.com';
  await assert.rejects(() => supabase.salvarNoSupabase(m), /Endereco do Supabase invalido/);
  assert.equal(SUPABASE.pedidos.length, 0);

  process.env.SUPABASE_URL = process.env.MELI_API_BASE;
  const r = await supabase.salvarNoSupabase(m);
  assert.deepEqual([r.categorias, r.produtos], [3, 5]);
  assert.deepEqual(SUPABASE.pedidos.map((p) => p.tabela), ['chs_mineracoes', 'chs_categorias', 'chs_produtos']);
  assert.ok(SUPABASE.pedidos.every((p) => p.chave === 'chave-de-teste' && /merge-duplicates/.test(p.prefer)));
  assert.match(SUPABASE.pedidos[2].url, /on_conflict=mineracao_id,produto_id/);
  const gaveta = SUPABASE.pedidos[2].linhas.find((l) => l.produto_id === 'MLB100');
  assert.deepEqual([gaveta.situacao, gaveta.tipo_de_marca, gaveta.menor_preco, gaveta.mineracao_id], ['apto', 'sem_marca', 29.9, m.id]);
  assert.equal(SUPABASE.pedidos[2].linhas.find((l) => l.produto_id === 'MLBU900').situacao, 'sem_detalhe');

  SUPABASE.semTabela = true;
  assert.match((await supabase.salvarSeConfigurado(m)).erro, /Rode supabase\/schema\.sql/);
  SUPABASE.semTabela = false;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_KEY;
});

// Le as entradas de um ZIP pelo diretorio central, para conferir o .xlsx gerado.
function lerZip(buf) {
  const zlib = require('node:zlib');
  const fim = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  let pos = buf.readUInt32LE(fim + 16);
  const entradas = {};
  for (let i = 0; i < buf.readUInt16LE(fim + 10); i += 1) {
    const metodo = buf.readUInt16LE(pos + 10);
    const tamanho = buf.readUInt32LE(pos + 20);
    const nomeLen = buf.readUInt16LE(pos + 28);
    const local = buf.readUInt32LE(pos + 42);
    const nome = buf.toString('utf8', pos + 46, pos + 46 + nomeLen);
    const inicio = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const corpo = buf.subarray(inicio, inicio + tamanho);
    entradas[nome] = metodo === 8 ? zlib.inflateRawSync(corpo) : corpo;
    pos += 46 + nomeLen;
  }
  return entradas;
}

test('exporta a planilha Excel com foto, links e a aba de explicacao', async () => {
  const { montarPlanilha } = require('../server/planilha');
  const { crc32, medirImagem } = require('../server/xlsx');
  assert.equal(crc32(Buffer.from('123456789')), 0xCBF43926);

  // JPEG minimo: so o cabecalho com as dimensoes (120 x 60).
  const jpeg = Buffer.from([0xFF, 0xD8, 0xFF, 0xC0, 0x00, 0x11, 0x08, 0x00, 0x3C, 0x00, 0x78, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xFF, 0xD9]);
  assert.deepEqual(medirImagem(jpeg), { tipo: 'jpeg', altura: 60, largura: 120 });

  const m = await minerarCategoria('MLB1', {});
  m.id = '20260401-100000-MLB1';
  const pedidas = [];
  const r = await montarPlanilha([m], async (u) => { pedidas.push(u); return u.includes('MLB200') ? null : jpeg; });
  assert.deepEqual([r.produtos, r.com_foto, r.sem_detalhe], [4, 3, 1]);
  assert.equal(pedidas.length, 4);

  const zip = lerZip(r.buffer);
  assert.equal(Object.keys(zip)[0], '[Content_Types].xml');
  assert.equal(Object.keys(zip).filter((n) => n.startsWith('xl/media/')).length, 3);
  const folha = zip['xl/worksheets/sheet1.xml'].toString('utf8');
  assert.match(folha, /Organizador De Gaveta Colmeia 12 Nichos/);
  assert.match(folha, /Casa, Móveis e Decoração &gt; Organização para Casa/);
  assert.match(folha, /foto indisponível/);
  assert.match(folha, /<autoFilter ref="A1:AA5"\/>/);
  // 23/01/2024 como numero de serie do Excel, na coluna "No catalogo desde"
  assert.match(folha, /<c r="N2" s="13"><v>45314<\/v><\/c>/);
  assert.match(folha, /<pane xSplit="2" ySplit="1" topLeftCell="C2"/);
  assert.match(zip['xl/worksheets/_rels/sheet1.xml.rels'].toString('utf8'), /Target="https:\/\/www\.mercadolivre\.com\.br\/p\/MLB100" TargetMode="External"/);
  // a foto 120x60 cabe em 96 px mantendo a proporcao
  assert.match(zip['xl/drawings/drawing1.xml'].toString('utf8'), /<xdr:ext cx="914400" cy="457200"\/>/);
  assert.match(zip['xl/worksheets/sheet2.xml'].toString('utf8'), /Não é estimativa de vendas/);

  saida.salvarMineracao(Object.assign(m, { consultado_em: '2026-04-01T10:00:00.000Z' }));
  assert.deepEqual(saida.mineracoesDoDia(saida.dataLocal('2026-04-01T10:00:00.000Z')).map((x) => x.id), ['20260401-100000-MLB1']);
});

test('a fila confere as categorias e roda em rodizio pela mais antiga', async () => {
  const fila = require('../server/fila');
  assert.deepEqual(fila.lerFila().categorias, []);

  const r = await fila.definirFila({
    categorias: [{ categoria_id: 'mlb11', origem: 'CNAE 4759-8/99' }, { categoria_id: 'MLB13' }, { categoria_id: 'MLB11' }, { categoria_id: 'MLB77777' }],
    enviar_para_accio: true,
  });
  assert.equal(r.total, 2, 'repetida some e inexistente fica de fora');
  assert.deepEqual(r.categorias_inexistentes, ['MLB77777']);
  assert.deepEqual(r.categorias[0], { id: 'MLB11', nome: 'Organização para Casa', caminho: 'Casa, Móveis e Decoração > Organização para Casa', origem: 'CNAE 4759-8/99' });
  assert.equal(fila.lerFila().enviar_para_accio, true);

  const f = fila.lerFila();
  const ordem = (ids) => fila.ordenarFila(f, ids).map((c) => c.id);
  assert.deepEqual(ordem([]), ['MLB11', 'MLB13'], 'nunca mineradas seguem a ordem da fila');
  assert.deepEqual(ordem(['20260102-100000-MLB11']), ['MLB13', 'MLB11'], 'a nunca minerada vem primeiro');
  assert.deepEqual(ordem(['20260103-100000-MLB13', '20260102-100000-MLB11']), ['MLB11', 'MLB13'], 'depois, a mais antiga');
  assert.deepEqual(ordem(['20260104-100000-MLB11', '20260103-100000-MLB13', '20260102-100000-MLB11']), ['MLB13', 'MLB11']);

  await assert.rejects(() => fila.definirFila({ categorias: [] }), /ao menos uma categoria/);
  await assert.rejects(() => fila.definirFila({ categorias: [{ categoria_id: 'MLB77777' }] }), /Nenhuma das categorias existe/);
});

test('le o sourcing.md do Accio e cruza candidatos com produtos', () => {
  const { cruzar, lerSourcingMd } = require('../server/sourcing');
  const md = [
    '| # | Image | Product/Supplier | Supplier | Price / MOQ | Location | Match | Recommendation reason |',
    '|---|---|---|---|---|---|---|---|',
    '| 1 | ![](https://s.alicdn.com/a.jpg) | [Mattress Cover Waterproof Quilted](https://www.alibaba.com/product-detail/x_1.html) | Yiwu Qibei Co., Ltd. | $2.10-7.32 / 2 pieces | Zhejiang, CN | 88/100 | Equivalente ao protetor de colchão impermeável matelado. |',
    '| 2 | ![](https://s.alicdn.com/b.jpg) | [Rodízios Giratórios para Móveis](https://www.alibaba.com/product-detail/x_2.html) | Jiangmen Baolan Co., Ltd. | $3 / 8 Pieces | Guangdong, CN | 84/100 | Kit com 8 rodízios e freio. |',
    '| 3 | ![](https://s.alicdn.com/c.jpg) | [LED Fairy Light](https://www.alibaba.com/product-detail/x_3.html) | Shenzhen My Fashion Ltd. | $0.32 / 2000 Pieces | Guangdong, CN | 84/100 | Atende ao produto MLB53507162. |',
  ].join('\n');
  const candidatos = lerSourcingMd(md);
  assert.equal(candidatos.length, 3);
  assert.deepEqual([candidatos[0].preco, candidatos[0].moq, candidatos[0].fornecedor], ['$2.10-7.32', '2 pieces', 'Yiwu Qibei Co., Ltd.']);
  assert.equal(candidatos[1].link, 'https://www.alibaba.com/product-detail/x_2.html');

  const produtos = [
    { id: 'MLB53507162', nome: 'Kit 10 Fio Fada Cordão Luz' },
    { id: 'MLB47426343', nome: 'Capa Protetora Colchão Box Casal Matelado Impermeável' },
    { id: 'MLB67076748', nome: 'Kit 8 Rodinhas Para Moveis Rodízio Giratória' },
    { id: 'MLB999', nome: 'Cadeira Escritório Ergonômica' },
  ];
  const { par, sobraram } = cruzar(produtos, candidatos);
  assert.deepEqual([par.get('MLB53507162').candidato.numero, par.get('MLB53507162').exato], [3, true], 'pelo codigo');
  assert.deepEqual([par.get('MLB47426343').candidato.numero, par.get('MLB47426343').exato], [1, false], 'por semelhanca');
  assert.equal(par.get('MLB67076748').candidato.numero, 2);
  assert.equal(par.has('MLB999'), false);
  assert.deepEqual(sobraram, []);
});

test('a planilha mostra a tendencia no ranking em relacao a mineracao anterior', () => {
  const { tendenciaNoRanking, textoDaTendenciaExterna } = require('../server/indicadores');
  const anterior = { categorias: [{ produtos: [{ id: 'A', melhor_posicao: 5 }, { id: 'B', melhor_posicao: 2 }, { id: 'C', melhor_posicao: 3 }] }] };
  assert.equal(tendenciaNoRanking({ id: 'A', melhor_posicao: 2 }, anterior), 'Subiu 3 (5º → 2º)');
  assert.equal(tendenciaNoRanking({ id: 'B', melhor_posicao: 4 }, anterior), 'Desceu 2 (2º → 4º)');
  assert.equal(tendenciaNoRanking({ id: 'C', melhor_posicao: 3 }, anterior), 'Estável');
  assert.equal(tendenciaNoRanking({ id: 'D', melhor_posicao: 1 }, anterior), 'Entrou no ranking');
  assert.equal(tendenciaNoRanking({ id: 'A', melhor_posicao: 2 }, null), '', 'sem mineracao anterior nao ha tendencia');
  assert.equal(textoDaTendenciaExterna({ crescimento_percentual: -7 }), '-7%');
  assert.equal(textoDaTendenciaExterna({ tendencia: 'estável' }), 'estável');
  assert.equal(textoDaTendenciaExterna(undefined), '');
});

test('monta a consulta do JoomPulse e le a resposta em colunas', async () => {
  const { consultaJoomPulse, estimativasDoJoomPulse, registrarEstimativas } = require('../server/estimativas');
  const q = JSON.parse(consultaJoomPulse(['MLB100', 'MLB200']));
  assert.deepEqual(q.dimensions, ['MlbProductsSortedByProductId.productId']);
  assert.deepEqual(q.filters[0].values, ['MLB100', 'MLB200']);
  assert.equal(q.limit, 100);

  const resposta = JSON.stringify({
    columns: ['productId', 'catalogOrderCount1w', 'catalogOrderGmv1w', 'reviewsCountMax', 'reviewsRating', 'daysInAd'],
    data: [['MLB100', 843, 37927, 1433, 4.5, 83], ['MLB200', 60, 1372, null, 0, 1174], ['MLB999', 5, 10, 1, 5, 400], [null, 1, 1, 1, 1, 1]],
  });
  const est = estimativasDoJoomPulse(resposta);
  assert.equal(est.length, 3, 'linha sem produto e descartada');
  assert.deepEqual(est[0], { produto_id: 'MLB100', vendas: 843, faturamento: 37927, avaliacoes: 1433, avaliacao: 4.5, dias_de_anuncio: 83 });
  assert.deepEqual(est[1], { produto_id: 'MLB200', vendas: 60, faturamento: 1372, dias_de_anuncio: 1174 }, 'nota zero e nulos ficam de fora');
  assert.throws(() => estimativasDoJoomPulse('nao e json'), /nao e um JSON valido/);
  assert.throws(() => estimativasDoJoomPulse({ columns: ['productId'], data: [] }), /productId e catalogOrderCount1w/);

  const m = await minerarCategoria('MLB1', {});
  registrarEstimativas(m, { fonte: 'JoomPulse', estimativas: est });
  const por = (id) => m.categorias.flatMap((c) => c.produtos).find((p) => p.id === id).estimativa_externa;
  assert.equal(por('MLB100').tendencia, 'anúncio novo com tração (83 dias)');
  assert.equal(por('MLB200').tendencia, undefined, 'anuncio antigo fica sem tendencia');
});

test('em alta compara com a mineracao do periodo e so traz produtos aptos', () => {
  const { emAlta } = require('../server/emalta');
  const produto = (id, posicao, extra) => ({
    id, nome: `Produto ${id}`, categoria: 'Teste', melhor_posicao: posicao,
    sinais: { sem_marca: true, marca_conhecida: false, regulatorio: [] }, ...extra,
  });
  const gravar = (dia, produtos) => {
    const id = `202605${dia}-100000-MLB777`;
    const pasta = path.join(process.env.CONECTA_HUB_SAIDA, id);
    fs.mkdirSync(pasta, { recursive: true });
    fs.writeFileSync(path.join(pasta, 'mineracao.json'), JSON.stringify({
      id, consultado_em: `2026-05-${dia}T10:00:00.000Z`, categoria_raiz: { id: 'MLB777' }, categorias: [{ produtos }],
    }));
  };
  gravar('01', [produto('MLB901', 9), produto('MLB902', 1)]);
  gravar('10', [produto('MLB901', 6), produto('MLB902', 2)]);
  gravar('12', [
    produto('MLB901', 2),
    produto('MLB902', 3),
    produto('MLB903', 4),
    produto('MLB904', 1, { sinais: { sem_marca: false, marca_conhecida: true, regulatorio: [] } }),
  ]);

  const meus = (lista) => lista.filter((p) => /^MLB90\d$/.test(p.id));
  const semana = emAlta({ dias: 7, limite: 100 });
  // 12/05 menos 7 dias cai em 05/05: a base e a mineracao de 01/05, nao a de 10/05.
  assert.deepEqual(meus(semana.subindo).map((p) => [p.id, p.posicao_anterior, p.posicao, p.subiu]), [['MLB901', 9, 2, 7]]);
  assert.deepEqual(meus(semana.entraram).map((p) => p.id), ['MLB903'], 'marca conhecida fica de fora');
  assert.equal(meus(semana.subindo)[0].dias_comparados, 11);

  // Sem 30 dias de historico, usa a mineracao mais antiga e informa o periodo real.
  const mes = emAlta({ dias: 30, limite: 100 });
  assert.equal(meus(mes.subindo)[0].comparado_com, '2026-05-01T10:00:00.000Z');
  assert.ok(mes.menor_periodo_em_dias < 30);
});

test('o script da central e JavaScript valido', () => {
  const html = require('../server/central').centralHtml();
  const js = html.slice(html.indexOf('<script>') + 8, html.indexOf('</script>'));
  assert.doesNotThrow(() => new Function(js));
});

test('le a faixa de preco do anuncio do Alibaba em varios formatos', () => {
  const { faixaDePreco } = require('../server/cotacao');
  assert.deepEqual(faixaDePreco('US$ 1.20-1.80'), { min: 1.2, max: 1.8 });
  assert.deepEqual(faixaDePreco('US$ 2,99 – 6,45'), { min: 2.99, max: 6.45 });
  assert.deepEqual(faixaDePreco('$4.50'), { min: 4.5, max: 4.5 });
  assert.deepEqual(faixaDePreco('sob consulta'), {});
});

test('normaliza a resposta do JoomPulse para a Shopee', () => {
  const { itensDaResposta } = require('../server/shopee');
  const itens = itensDaResposta({
    columns: ['itemId', 'shopId', 'itemName', 'categoryL1Name', 'categoryName', 'hasBrand', 'brandName', 'price', 'itemImage', 'sold30Days', 'revenue30Days', 'salesTrend'],
    data: [
      [11, 22, 'Canudo De Silicone', 'Casa e Decoração', 'Canudos', null, null, 5.52, 'sg-111-abc', 40000, 220799.99, 13566.67],
      [33, 44, 'Sabao Liquido', 'Casa e Decoração', 'Detergentes', true, 'OMO', 94.9, 'http://x/y.jpg', 100, 9490, -50],
    ],
  });
  assert.equal(itens.length, 2);
  assert.equal(itens[0].link, 'https://shopee.com.br/product/22/11');
  assert.equal(itens[0].foto, 'https://down-br.img.susercontent.com/file/sg-111-abc');
  assert.equal(itens[0].tem_marca, false);
  assert.equal(itens[0].tendencia, 'subindo');
  assert.equal(itens[0].faturamento_30_dias, 220800);
  assert.equal(itens[1].foto, undefined, 'so aceita o identificador de imagem, nunca um endereco pronto');
  assert.equal(itens[1].tendencia, 'caindo');
});

test('a fila de pedidos valida o tipo, nao repete pendente e registra o resultado', () => {
  const pedidos = require('../server/pedidos');
  assert.throws(() => pedidos.criarPedido({ tipo: 'apagar-tudo' }), /tipo de pedido invalido/);
  assert.throws(() => pedidos.criarPedido({ tipo: 'cotacao', alvo: '../fora' }), /id do pacote/);
  const a = pedidos.criarPedido({ tipo: 'cotacao', alvo: '20260101-100000-MLB1' });
  const b = pedidos.criarPedido({ tipo: 'cotacao', alvo: '20260101-100000-MLB1' });
  assert.equal(a.id, b.id);
  assert.equal(pedidos.concluirPedido(a.id, 'concluido', 'planilhas geradas').situacao, 'concluido');
  assert.equal(pedidos.lerPedidos().filter((p) => p.situacao === 'pendente').length, 0);
});

test('separa os anuncios de Compra Internacional por origem do envio', () => {
  const { origemInternacional, summarizeListings } = require('../server/catalogo');
  const anuncio = (preco, tags, estado, cidade) => ({ item_id: `MLB${Math.round(preco * 100)}`, price: preco, tags, seller_address: { state: { name: estado }, city: { name: cidade } } });
  const eua = anuncio(80, ['cbt_item', 'cbt_fulfillment_us'], 'Texas', 'China Grove');
  const china = anuncio(60, ['cbt_item'], 'Guangdong', 'Shenzhen');
  const outro = anuncio(70, ['cbt_item'], '', '');
  const brasil = anuncio(99, ['kvs_primary'], 'São Paulo', 'São Paulo');
  // "China Grove, Texas" e o centro de distribuicao nos EUA, nao a China.
  assert.equal(origemInternacional(eua), 'estados_unidos');
  assert.equal(origemInternacional(china), 'china');
  assert.equal(origemInternacional(outro), 'outra');
  assert.equal(origemInternacional(brasil), null);
  const r = summarizeListings({ results: [eua, china, outro, brasil, anuncio(120, [], 'Paraná', 'Curitiba')] });
  assert.equal(r.internacional.anuncios, 3);
  assert.equal(r.internacional.china.menor_preco, 60);
  assert.equal(r.internacional.estados_unidos.anuncios, 1);
  assert.equal(r.menor_preco_nacional, 99);
  assert.equal(summarizeListings({ results: [brasil] }).internacional, undefined);
});

test('normaliza o catalogo JoomPro e so aceita enderecos dos dominios esperados', () => {
  const { consultaJoompro, itensDaResposta } = require('../server/joompro');
  const itens = itensDaResposta({
    columns: ['joomproProductId', 'title', 'imageUrl', 'l1CategoryName', 'categoryName', 'joomproPriceAmount', 'minAvailableMoq', 'smallBatchAvailable', 'joomproUrl', 'score', 'productId', 'meliTitle', 'meliPriceMin', 'meliCatalogOrders1m', 'marginality', 'meliUrl'],
    data: [
      ['a1', 'Car vent clip', 'https://cbu01.alicdn.com/x.jpg', 'Automobiles & Motorcycles', 'Interior Mouldings', 1.72, 677, true, 'https://joom.pro/pt-br/products/a1', 0.9007, 'MLB-37', 'Friso Ar Condicionado', 25.87, 34, 0.9335, 'https://produto.mercadolivre.com.br/MLB-37'],
      ['a2', 'Outro', 'https://evil.example/x.jpg', 'Home & Kitchen', 'X', 2, 10, false, 'https://evil.example/p', 0.95, null, null, null, null, null, null],
    ],
  });
  assert.equal(itens.length, 1, 'item com link fora do JoomPro fica de fora');
  assert.equal(itens[0].custo_no_brasil, 1.72);
  assert.equal(itens[0].pedido_minimo, 677);
  assert.equal(itens[0].semelhanca, 0.9007);
  assert.equal(itens[0].mercado_livre.pedidos_estimados_no_mes, 34);
  assert.equal(itens[0].foto, 'https://cbu01.alicdn.com/x.jpg');
  const consulta = JSON.parse(consultaJoompro());
  assert.deepEqual(consulta.order, [['JprProductsMeli.qualityScore', 'desc']], 'nunca ordena por margem');
});

test('a base do Suportify nao afirma vendas e encaminha a cotacao a equipe', () => {
  const { AGENTE, montarBase } = require('../server/suportify');
  const base = montarBase({
    sugestoes: [{ id: 'MLB1', nome: 'Porta   Joias 3 Camadas', categoria: 'Joias', menor_preco: 75.65, ncm: 'posição 42.02' }],
    emAlta: [{ nome: 'Mesa Dobravel', posicao_anterior: 6, posicao: 5 }],
    cotados: [{ nome: 'Relogio De Parede' }],
  });
  assert.match(base, /PERGUNTA: Fale sobre o produto Porta Joias 3 Camadas\nRESPOSTA: .*R\$ 75,65.*MLB1/);
  // Toda linha e uma pergunta, uma resposta ou o separador: nada de titulo solto.
  assert.ok(base.trim().split('\n').every((l) => /^(PERGUNTA: .+|RESPOSTA: .+|#)$/.test(l)));
  assert.match(base, /^PERGUNTA: /);
  assert.match(base, /foi do 6º para o 5º lugar/);
  assert.match(base, /não de quantidade vendida/);
  assert.match(AGENTE.comportamento, /Nunca informe quantidade vendida/);
  assert.match(AGENTE.comportamento, /não feche pedido/);
});

test('o cambio usa a cotacao guardada quando a rede falha e grava a nova quando chega', async () => {
  const { atualizarCambio, cambioGuardado } = require('../server/cambio');
  assert.equal(await atualizarCambio(async () => { throw new Error('sem rede'); }), null);
  const novo = await atualizarCambio(async () => ({ ok: true, json: async () => ({ value: [{ cotacaoCompra: 5.01, cotacaoVenda: 5.0119, dataHoraCotacao: '2026-10-08 13:08:16.814' }] }) }));
  assert.equal(novo.venda, 5.0119);
  assert.equal(novo.cotado_em, '2026-10-08 13:08');
  assert.equal(cambioGuardado().venda, 5.0119);
});
