#!/usr/bin/env node
'use strict';

/*
 * Minerador autonomo da Conecta Hub Sourcing.
 *
 * Roda sozinho, sem o Claude: a cada intervalo minera a proxima categoria da
 * fila (a mesma de definir_fila) e mostra o andamento em uma pagina local.
 *
 *   node minerador.js
 *
 * Variaveis de ambiente:
 *   MELI_CLIENT_SECRET         obrigatoria, a mesma da extensao
 *   CONECTA_HUB_INTERVALO_MIN  minutos entre mineracoes (padrao 60, minimo 5)
 *   CONECTA_HUB_PORTA          porta da central (padrao 4310)
 *   SUPABASE_URL, SUPABASE_KEY opcionais, para gravar tambem no Supabase
 *   CONECTA_HUB_COTACAO_URL    opcional, endereco https do botao de cotacao;
 *                              {pedido} vira o texto do pedido (ex.: link do WhatsApp)
 *
 * A central so atende em 127.0.0.1: nao fica visivel na rede.
 */

const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const { ToolError, cleanEnv, credentialsConfigured, log } = require('./server/meli');
const { filaOrdenada, minerarProximaDaFila } = require('./server/automacao');
const { calcularIndicadores } = require('./server/indicadores');
const { dataLocal, mineracaoAnterior, mineracoesDoDia, pastaMineracoes } = require('./server/saida');
const { centralHtml } = require('./server/central');
const { PERIODOS, emAlta } = require('./server/emalta');
const { detalharPacote, listarPacotes } = require('./server/accio');
const { planilhasDaCotacao } = require('./server/cotacao');
const { lerShopee } = require('./server/shopee');
const { lerJoompro } = require('./server/joompro');
const { sincronizarRetratos } = require('./server/supabase');
const { TIPOS, criarPedido, lerPedidos } = require('./server/pedidos');
const { todosOsProdutos } = require('./server/mineracao');
const { ncmCurto, situacao: situacaoDoProduto } = require('./server/indicadores');
const { carregarMineracao } = require('./server/saida');

const MAX_HISTORICO = 100;
const SEM_CREDENCIAL = 'Client Secret do Mercado Livre nao configurado. Defina a variavel de ambiente MELI_CLIENT_SECRET e reinicie o minerador.';

function inteiro(valor, padrao, min, max) {
  const n = Number.parseInt(cleanEnv(valor), 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : padrao;
}

const INTERVALO_MIN = inteiro(process.env.CONECTA_HUB_INTERVALO_MIN, 60, 5, 1440);
const PORTA = inteiro(process.env.CONECTA_HUB_PORTA, 4310, 1024, 65535);

// So https: o endereco vai para um link na pagina.
function enderecoDeCotacao() {
  const u = cleanEnv(process.env.CONECTA_HUB_COTACAO_URL);
  return /^https:\/\/[^\s"'<>]+$/i.test(u) ? u : null;
}

function arquivoDeEstado() {
  const base = cleanEnv(process.env.CONECTA_HUB_SAIDA);
  return path.join(base ? path.dirname(base) : path.join(os.homedir(), 'ConectaHubSourcing'), 'minerador.json');
}

/* ------------------------------------------------------------------ */
/* Estado                                                              */
/* ------------------------------------------------------------------ */

// O historico e a pausa sobrevivem a um reinicio; o resto e desta execucao.
function lerEstadoGravado() {
  try {
    const e = JSON.parse(fs.readFileSync(arquivoDeEstado(), 'utf8'));
    return { pausado: e.pausado === true, historico: Array.isArray(e.historico) ? e.historico.slice(0, MAX_HISTORICO) : [] };
  } catch (_) {
    return { pausado: false, historico: [] };
  }
}

const estado = {
  ...lerEstadoGravado(),
  atual: null,
  proxima_em: null,
  problema: null,
  ligado_em: new Date().toISOString(),
};
let relogio = null;
let resumoDeHoje = null;
// Comparar o historico le dezenas de arquivos: guarda por periodo ate a proxima mineracao.
const altaGuardada = new Map();

function emAltaGuardado(dias) {
  if (!altaGuardada.has(dias)) altaGuardada.set(dias, { ...emAlta({ dias }), cotacao_url: enderecoDeCotacao() });
  return altaGuardada.get(dias);
}

function gravarEstado() {
  try {
    fs.mkdirSync(path.dirname(arquivoDeEstado()), { recursive: true });
    fs.writeFileSync(arquivoDeEstado(), JSON.stringify({ pausado: estado.pausado, historico: estado.historico }, null, 2), 'utf8');
  } catch (err) {
    log(`nao consegui gravar o estado: ${err.message}`);
  }
}

// Totais e sugestoes do dia, a partir das mineracoes gravadas. Ler os arquivos
// custa caro para a pagina pedir a cada 5 segundos: fica guardado ate a
// proxima mineracao ou a virada do dia.
function hoje() {
  const data = dataLocal(new Date().toISOString());
  if (resumoDeHoje && resumoDeHoje.data === data) return resumoDeHoje;
  const mineracoes = mineracoesDoDia(data);
  const sugestoes = [];
  let produtos = 0;
  let aptos = 0;
  for (const m of mineracoes) {
    const ind = calcularIndicadores(m, mineracaoAnterior(m));
    produtos += ind.totais.produtos;
    aptos += ind.triagem.apto;
    sugestoes.push(...ind.sugestoes.filter((s) => s.apto));
  }
  sugestoes.sort((a, b) => b.prioridade - a.prioridade);
  resumoDeHoje = {
    data,
    categorias: mineracoes.length,
    produtos,
    aptos,
    sugestoes: sugestoes.slice(0, 8).map((s) => ({
      nome: s.nome, categoria: s.categoria, foto: s.foto, link: s.link, menor_preco: s.menor_preco, prioridade: s.prioridade, ncm: s.ncm,
    })),
    planilha: resumoDeHoje && resumoDeHoje.data === data ? resumoDeHoje.planilha : null,
  };
  return resumoDeHoje;
}

function situacao() {
  if (estado.atual) return 'minerando';
  if (estado.pausado) return 'pausado';
  return estado.problema ? 'erro' : 'aguardando';
}

function retrato() {
  return {
    situacao: situacao(),
    pausado: estado.pausado,
    atual: estado.atual,
    proxima_em: estado.pausado || estado.atual ? null : estado.proxima_em,
    intervalo_min: INTERVALO_MIN,
    problema: estado.problema,
    ligado_em: estado.ligado_em,
    hoje: hoje(),
    fila: filaOrdenada().ordem.map((c) => ({ id: c.id, caminho: c.caminho, origem: c.origem, ultima_mineracao: c.ultima_mineracao })),
    historico: estado.historico.slice(0, 20),
  };
}

/* ------------------------------------------------------------------ */
/* Ciclo de mineracao                                                  */
/* ------------------------------------------------------------------ */

function agendar(ms) {
  clearTimeout(relogio);
  if (estado.pausado) {
    estado.proxima_em = null;
    return;
  }
  estado.proxima_em = new Date(Date.now() + ms).toISOString();
  relogio = setTimeout(ciclo, ms);
}

function registrar(item) {
  estado.historico.unshift(item);
  estado.historico.length = Math.min(estado.historico.length, MAX_HISTORICO);
  gravarEstado();
}

async function ciclo() {
  if (estado.atual) return;
  clearTimeout(relogio);
  if (!credentialsConfigured()) {
    estado.problema = SEM_CREDENCIAL;
    return;
  }
  const inicio = new Date().toISOString();
  estado.atual = { id: null, caminho: 'Escolhendo a categoria', iniciado_em: inicio };
  try {
    const r = await minerarProximaDaFila({}, (alvo) => {
      estado.atual = { id: alvo.id, caminho: alvo.caminho, iniciado_em: inicio };
      log(`minerando ${alvo.caminho}`);
    });
    estado.problema = null;
    resumoDeHoje = null;
    produtosDeHoje = null;
    altaGuardada.clear();
    hoje().planilha = r.planilha && r.planilha.arquivo ? r.planilha.arquivo : null;
    registrar({
      mineracao_id: r.m.id,
      categoria: r.alvo.caminho,
      inicio,
      fim: new Date().toISOString(),
      produtos: r.arquivos.indicadores.totais.produtos,
      aptos: r.arquivos.indicadores.triagem.apto,
    });
    log(`concluida ${r.m.id}: ${r.arquivos.indicadores.totais.produtos} produtos`);
    // Leva a Shopee e as cotacoes para o aplicativo hospedado, se o Supabase estiver configurado.
    const retratos = await sincronizarRetratos();
    if (retratos && retratos.erro) log(`retratos nao enviados: ${retratos.erro}`);
  } catch (err) {
    // Uma falha (rede, limite da API) nao para o minerador: fica registrada e
    // a fila segue no proximo intervalo.
    estado.problema = `Ultima mineracao falhou: ${err.message}`;
    registrar({ categoria: estado.atual.caminho, inicio, fim: new Date().toISOString(), erro: err.message });
    log(`falha: ${err.message}`);
  } finally {
    estado.atual = null;
    agendar(INTERVALO_MIN * 60 * 1000);
  }
}

/* ------------------------------------------------------------------ */
/* Central (HTTP local)                                                */
/* ------------------------------------------------------------------ */

function responder(res, status, tipo, corpo) {
  res.writeHead(status, {
    'Content-Type': tipo,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(corpo);
}

// So aceita pedidos feitos a este computador pelo endereco local: barra
// paginas de outros sites que tentem falar com a central (DNS rebinding).
function hostLocal(req) {
  const host = String(req.headers.host || '');
  return host === `127.0.0.1:${PORTA}` || host === `localhost:${PORTA}`;
}

function json(res, status, corpo) {
  responder(res, status, 'application/json; charset=utf-8', JSON.stringify(corpo));
}

// Erro de uso (pacote inexistente, sourcing ainda nao feito) vira mensagem
// para a tela; qualquer outro sobe.
function comMensagem(res, fn) {
  return Promise.resolve().then(fn).then(
    (corpo) => json(res, 200, corpo),
    (err) => {
      if (err instanceof ToolError) return json(res, 400, { erro: err.message });
      log(`erro na central: ${err.message}`);
      return json(res, 500, { erro: 'Erro interno.' });
    },
  );
}

// Monta as duas planilhas da cotacao de um pacote: Mercado Livre e Alibaba.
function planilhaDoPacote(id) {
  detalharPacote(id); // confere o id e se ja ha resultado antes de carregar a mineracao
  return planilhasDaCotacao(carregarMineracao(id));
}

/* ------------------------------------------------------------------ */
/* Dados para o aplicativo web                                         */
/* ------------------------------------------------------------------ */

let produtosDeHoje = null;

// Produtos com detalhe das mineracoes do dia, do mais prioritario para o menos.
function produtosDoDia() {
  const data = dataLocal(new Date().toISOString());
  if (produtosDeHoje && produtosDeHoje.data === data) return produtosDeHoje;
  const itens = [];
  for (const m of mineracoesDoDia(data)) {
    for (const p of todosOsProdutos(m)) {
      if (!p.nome) continue;
      const est = p.estimativa_externa;
      itens.push({
        id: p.id,
        nome: p.nome,
        categoria: p.categoria,
        foto: p.foto,
        link: p.link,
        posicao: p.melhor_posicao,
        menor_preco: p.anuncios && p.anuncios.menor_preco ? p.anuncios.menor_preco.valor : undefined,
        situacao: situacaoDoProduto(p),
        prioridade: p.prioridade.pontos,
        ncm: ncmCurto(p),
        vendas_estimadas: est ? est.vendas : undefined,
        avaliacoes: est ? est.avaliacoes : undefined,
        nota: est ? est.avaliacao : undefined,
        internacional: p.anuncios ? p.anuncios.internacional : undefined,
        menor_preco_nacional: p.anuncios ? p.anuncios.menor_preco_nacional : undefined,
        fonte_da_estimativa: est ? `${est.fonte}, por ${est.periodo === 'mensal' ? 'mês' : 'semana'}` : undefined,
        mineracao_id: m.id,
      });
    }
  }
  itens.sort((a, b) => b.prioridade - a.prioridade || a.posicao - b.posicao);
  produtosDeHoje = { data, total: itens.length, itens: itens.slice(0, 200) };
  return produtosDeHoje;
}

// Situacao de cada integracao, para a tela Integracoes.
function integracoes() {
  const pacotes = listarPacotes().pacotes;
  const cotados = pacotes.filter((p) => p.sourcing);
  const shopee = lerShopee();
  const pedidos = lerPedidos();
  const ultima = estado.historico.find((h) => !h.erro);
  return [
    {
      id: 'mercado-livre', nome: 'Mercado Livre', via: 'API oficial, direto pelo minerador',
      ok: credentialsConfigured() && !estado.problema,
      detalhe: !credentialsConfigured() ? 'Client Secret não configurado.' : (estado.problema || (ultima ? `Última mineração: ${ultima.categoria}.` : 'Aguardando a primeira mineração.')),
      atualizado_em: ultima ? ultima.fim : null,
    },
    {
      id: 'shopee', nome: 'Shopee', via: 'JoomPulse, buscado pelo Claude',
      ok: Boolean(shopee),
      detalhe: shopee ? `${shopee.itens.length} produtos na última leitura. Vendas são estimativas do JoomPulse.` : 'Ainda sem leitura. Peça a atualização ao Claude.',
      atualizado_em: shopee ? shopee.consultado_em : null,
    },
    {
      id: 'joompro', nome: 'China (JoomPro)', via: 'Catálogo de importação do JoomPulse, buscado pelo Claude',
      ok: Boolean(lerJoompro()),
      detalhe: lerJoompro() ? `${lerJoompro().itens.length} produtos importáveis com par no Mercado Livre. O par é automático e precisa ser conferido.` : 'Ainda sem leitura. Peça a atualização ao Claude.',
      atualizado_em: lerJoompro() ? lerJoompro().consultado_em : null,
    },
    {
      id: 'accio', nome: 'Accio Work', via: 'Pasta de pacotes neste computador',
      ok: pacotes.length > 0,
      detalhe: `${pacotes.length} pacotes gravados, ${pacotes.length - cotados.length} aguardando cotação.`,
      atualizado_em: pacotes.length ? pacotes[0].minerado_em : null,
    },
    {
      id: 'alibaba', nome: 'Alibaba', via: 'Cotações feitas pelo Accio Work',
      ok: cotados.length > 0,
      detalhe: cotados.length ? `${cotados.length} pacote(s) cotado(s). Preço de anúncio, não cotação FOB.` : 'Nenhum pacote cotado ainda.',
      atualizado_em: cotados.length ? cotados[0].sourcing.feito_em : null,
    },
    {
      id: 'claude', nome: 'Claude', via: 'Fila de pedidos lida pelo Claude Code',
      ok: true,
      detalhe: `${pedidos.filter((p) => p.situacao === 'pendente').length} pedido(s) pendente(s). O Claude executa quando está aberto e você pede.`,
      atualizado_em: pedidos.length ? pedidos[0].criado_em : null,
    },
  ];
}

// Corpo JSON pequeno de um POST; recusa o que passar do limite.
function lerCorpo(req) {
  return new Promise((resolve, reject) => {
    let dados = '';
    req.setEncoding('utf8');
    req.on('data', (parte) => {
      dados += parte;
      if (dados.length > 8192) { reject(new ToolError('Pedido grande demais.')); req.destroy(); }
    });
    req.on('end', () => {
      try { resolve(dados ? JSON.parse(dados) : {}); } catch (_) { reject(new ToolError('O corpo do pedido nao e JSON valido.')); }
    });
    req.on('error', reject);
  });
}

/* ------------------------------------------------------------------ */
/* Aplicativo web compilado (web/dist)                                 */
/* ------------------------------------------------------------------ */

const PASTA_DO_APP = path.join(__dirname, 'web', 'dist');
const TIPOS_DE_ARQUIVO = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

// Devolve o arquivo do aplicativo, ou null se nao existir ou sair da pasta.
function arquivoDoApp(caminho) {
  const relativo = caminho === '/' ? 'index.html' : caminho.replace(/^\/+/, '');
  const alvo = path.resolve(PASTA_DO_APP, relativo);
  if (alvo !== PASTA_DO_APP && !alvo.startsWith(PASTA_DO_APP + path.sep)) return null;
  const tipo = TIPOS_DE_ARQUIVO[path.extname(alvo).toLowerCase()];
  if (!tipo) return null;
  try {
    return { tipo, dados: fs.readFileSync(alvo) };
  } catch (_) {
    return null;
  }
}

const COMANDOS = {
  pausar() {
    estado.pausado = true;
    clearTimeout(relogio);
    estado.proxima_em = null;
    gravarEstado();
  },
  retomar() {
    estado.pausado = false;
    gravarEstado();
    if (!estado.atual) agendar(INTERVALO_MIN * 60 * 1000);
  },
  'minerar-agora'() {
    if (!estado.atual) ciclo();
  },
};

function atender(req, res) {
  if (!hostLocal(req)) return responder(res, 403, 'text/plain; charset=utf-8', 'Acesso apenas local.');
  const pedido = new URL(req.url, `http://127.0.0.1:${PORTA}`);
  const caminho = pedido.pathname;

  if (req.method === 'POST' && caminho === '/api/accio/planilha' && req.headers['x-conecta-hub'] === '1') {
    return comMensagem(res, () => planilhaDoPacote(pedido.searchParams.get('id')));
  }
  if (req.method === 'POST' && caminho === '/api/pedidos' && req.headers['x-conecta-hub'] === '1') {
    return comMensagem(res, async () => criarPedido(await lerCorpo(req)));
  }
  if (req.method === 'POST') {
    const comando = caminho.startsWith('/api/') ? COMANDOS[caminho.slice(5)] : null;
    // O cabecalho proprio impede que um formulario de outro site dispare o comando.
    if (!comando || req.headers['x-conecta-hub'] !== '1') return responder(res, 404, 'text/plain; charset=utf-8', 'Nao encontrado.');
    comando();
    return responder(res, 200, 'application/json; charset=utf-8', JSON.stringify({ ok: true }));
  }
  if (req.method !== 'GET') return responder(res, 405, 'text/plain; charset=utf-8', 'Metodo nao aceito.');

  // O aplicativo web compilado fica na raiz; a central antiga continua em /central.
  if (caminho === '/central') return responder(res, 200, 'text/html; charset=utf-8', centralHtml());
  if (!caminho.startsWith('/api/') && !caminho.startsWith('/mineracao/')) {
    const app = arquivoDoApp(caminho);
    if (app) return responder(res, 200, app.tipo, app.dados);
    if (caminho === '/') return responder(res, 200, 'text/html; charset=utf-8', centralHtml());
  }
  if (caminho === '/api/integracoes') return json(res, 200, integracoes());
  if (caminho === '/api/produtos') return json(res, 200, produtosDoDia());
  if (caminho === '/api/joompro') return json(res, 200, lerJoompro() || { itens: [], consultado_em: null });
  if (caminho === '/api/shopee') return json(res, 200, lerShopee() || { itens: [], consultado_em: null });
  if (caminho === '/api/pedidos') return json(res, 200, { tipos: TIPOS, pedidos: lerPedidos().slice(0, 50) });
  if (caminho === '/api/estado') return responder(res, 200, 'application/json; charset=utf-8', JSON.stringify(retrato()));
  if (caminho === '/api/accio') return json(res, 200, listarPacotes());
  if (caminho === '/api/accio/pacote') return comMensagem(res, () => detalharPacote(pedido.searchParams.get('id')));
  if (caminho === '/api/em-alta') {
    const dias = Number.parseInt(pedido.searchParams.get('dias'), 10);
    return responder(res, 200, 'application/json; charset=utf-8', JSON.stringify(emAltaGuardado(PERIODOS.includes(dias) ? dias : PERIODOS[0])));
  }

  // Painel e catalogo de uma mineracao. O id vira nome de pasta: so o formato
  // gerado por salvarMineracao e so esses dois arquivos.
  const m = /^\/mineracao\/(\d{8}-\d{6}-MLB\d{1,12})\/(painel|catalogo)\.html$/.exec(caminho);
  if (m) {
    const arquivo = path.join(pastaMineracoes(), m[1], `${m[2]}.html`);
    if (fs.existsSync(arquivo)) return responder(res, 200, 'text/html; charset=utf-8', fs.readFileSync(arquivo));
  }
  return responder(res, 404, 'text/plain; charset=utf-8', 'Nao encontrado.');
}

function main() {
  const servidor = http.createServer((req, res) => {
    try {
      atender(req, res);
    } catch (err) {
      log(`erro na central: ${err.message}`);
      if (!res.headersSent) responder(res, 500, 'text/plain; charset=utf-8', 'Erro interno.');
      else res.end();
    }
  });
  servidor.on('error', (err) => {
    // Porta ocupada quase sempre e outro minerador ja rodando: dois juntos
    // minerariam a mesma categoria em dobro.
    log(err.code === 'EADDRINUSE' ? `a porta ${PORTA} ja esta em uso; o minerador ja deve estar rodando.` : `erro na central: ${err.message}`);
    process.exit(1);
  });
  servidor.listen(PORTA, '127.0.0.1', () => {
    log(`central em http://127.0.0.1:${PORTA} | intervalo de ${INTERVALO_MIN} min`);
    if (!credentialsConfigured()) estado.problema = SEM_CREDENCIAL;
    // A primeira mineracao espera um pouco, para um reinicio em sequencia nao disparar varias.
    agendar(30 * 1000);
  });
}

if (require.main === module) main();

module.exports = { atender, estado, retrato };
