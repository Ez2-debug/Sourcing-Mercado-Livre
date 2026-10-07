'use strict';

/*
 * Passos da mineracao que nao dependem do protocolo MCP.
 *
 * O servidor MCP (index.js) e o minerador autonomo (minerador.js) usam as
 * mesmas funcoes, para que a mineracao feita pelo Claude e a feita em segundo
 * plano gravem exatamente o mesmo resultado.
 */

const { ToolError } = require('./meli');
const { minerarCategoria, todosOsProdutos } = require('./mineracao');
const { anotarNcm } = require('./ncm');
const { salvarSeConfigurado } = require('./supabase');
const { exportarExcel } = require('./planilha');
const { lerFila, ordenarFila } = require('./fila');
const { dataLocal, enviarParaAccio, listarMineracoes, mineracoesDoDia, salvarMineracao } = require('./saida');

// Minera, sugere NCM, grava em disco e, se configurado, no Supabase.
async function executarMineracao(id, opcoes) {
  const m = await minerarCategoria(id, opcoes);
  m.ncm = await anotarNcm(todosOsProdutos(m));
  const arquivos = salvarMineracao(m);
  return { m, arquivos, supabase: await salvarSeConfigurado(m) };
}

// Roda um passo opcional e devolve o erro no resultado em vez de derrubar a chamada.
async function tolerante(fn) {
  try {
    return await fn();
  } catch (err) {
    if (!(err instanceof ToolError)) throw err;
    return { erro: err.message };
  }
}

// A fila na ordem em que sera minerada.
function filaOrdenada() {
  const fila = lerFila();
  return { fila, ordem: ordenarFila(fila, listarMineracoes()) };
}

// Minera a categoria da fila que esta ha mais tempo parada, atualiza a
// planilha do dia e, se a fila pedir, grava o pacote do Accio Work.
// `aoEscolher` recebe a categoria antes de a mineracao comecar.
async function minerarProximaDaFila(opcoes, aoEscolher) {
  const { fila, ordem } = filaOrdenada();
  if (!fila.categorias.length) throw new ToolError('A fila esta vazia. Use definir_fila para escolher as categorias da mineracao automatica.');
  const alvo = ordem[0];
  if (aoEscolher) aoEscolher(alvo);
  const { m, arquivos, supabase } = await executarMineracao(alvo.id, opcoes || {});
  const hoje = dataLocal(m.consultado_em);
  const planilha = await tolerante(() => exportarExcel(mineracoesDoDia(hoje), hoje));
  const accio = fila.enviar_para_accio ? await tolerante(() => enviarParaAccio(m, {})) : undefined;
  return { alvo, ordem, m, arquivos, supabase, planilha, accio };
}

module.exports = { executarMineracao, filaOrdenada, minerarProximaDaFila, tolerante };
