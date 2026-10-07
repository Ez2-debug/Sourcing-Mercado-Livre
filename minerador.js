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
 *
 * A central so atende em 127.0.0.1: nao fica visivel na rede.
 */

const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const { cleanEnv, credentialsConfigured, log } = require('./server/meli');
const { filaOrdenada, minerarProximaDaFila } = require('./server/automacao');
const { calcularIndicadores } = require('./server/indicadores');
const { dataLocal, mineracaoAnterior, mineracoesDoDia, pastaMineracoes } = require('./server/saida');
const { centralHtml } = require('./server/central');

const MAX_HISTORICO = 100;
const SEM_CREDENCIAL = 'Client Secret do Mercado Livre nao configurado. Defina a variavel de ambiente MELI_CLIENT_SECRET e reinicie o minerador.';

function inteiro(valor, padrao, min, max) {
  const n = Number.parseInt(cleanEnv(valor), 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : padrao;
}

const INTERVALO_MIN = inteiro(process.env.CONECTA_HUB_INTERVALO_MIN, 60, 5, 1440);
const PORTA = inteiro(process.env.CONECTA_HUB_PORTA, 4310, 1024, 65535);

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
  const caminho = new URL(req.url, `http://127.0.0.1:${PORTA}`).pathname;

  if (req.method === 'POST') {
    const comando = caminho.startsWith('/api/') ? COMANDOS[caminho.slice(5)] : null;
    // O cabecalho proprio impede que um formulario de outro site dispare o comando.
    if (!comando || req.headers['x-conecta-hub'] !== '1') return responder(res, 404, 'text/plain; charset=utf-8', 'Nao encontrado.');
    comando();
    return responder(res, 200, 'application/json; charset=utf-8', JSON.stringify({ ok: true }));
  }
  if (req.method !== 'GET') return responder(res, 405, 'text/plain; charset=utf-8', 'Metodo nao aceito.');

  if (caminho === '/') return responder(res, 200, 'text/html; charset=utf-8', centralHtml());
  if (caminho === '/api/estado') return responder(res, 200, 'application/json; charset=utf-8', JSON.stringify(retrato()));

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
