'use strict';

/*
 * Estimativas de venda de terceiros (por exemplo JoomPulse).
 *
 * A API do Mercado Livre nao informa quantidade vendida a esta aplicacao.
 * Ferramentas de inteligencia de mercado publicam estimativas proprias; este
 * modulo so as registra em cada produto minerado, com a fonte e o periodo,
 * para o painel mostrar. Nada aqui calcula ou ajusta numero: o que entra e o
 * que a fonte informou, e sai sempre rotulado como estimativa.
 */

const { ToolError } = require('./meli');
const { todosOsProdutos } = require('./mineracao');

const PERIODOS = ['semanal', 'mensal'];
const CAMPOS = ['vendas', 'faturamento', 'avaliacao', 'avaliacoes'];

function numero(valor, campo, id) {
  if (valor === undefined || valor === null || valor === '') return undefined;
  const n = Number(valor);
  if (!Number.isFinite(n) || n < 0) {
    throw new ToolError(`${campo} invalido para ${id}: "${valor}". Use um numero maior ou igual a zero.`);
  }
  return n;
}

function registrarEstimativas(m, entrada) {
  const fonte = String(entrada.fonte === undefined || entrada.fonte === null ? '' : entrada.fonte).trim();
  if (!fonte || fonte.length > 60) throw new ToolError('Informe a fonte das estimativas (por exemplo "JoomPulse"), com ate 60 caracteres.');
  const periodo = entrada.periodo === undefined ? 'semanal' : String(entrada.periodo);
  if (!PERIODOS.includes(periodo)) throw new ToolError(`periodo invalido: "${entrada.periodo}". Use ${PERIODOS.join(' ou ')}.`);
  const lista = Array.isArray(entrada.estimativas) ? entrada.estimativas : [];
  if (!lista.length) throw new ToolError('Informe ao menos uma estimativa em "estimativas".');

  const porId = new Map(todosOsProdutos(m).map((p) => [p.id, p]));
  const registrado_em = new Date().toISOString();
  const desconhecidos = [];
  let registrados = 0;
  for (const e of lista) {
    const id = String((e && e.produto_id) || '').trim().toUpperCase();
    const p = porId.get(id);
    if (!p) { desconhecidos.push(id || '(sem produto_id)'); continue; }
    const est = { fonte, periodo, registrado_em };
    for (const campo of CAMPOS) {
      const n = numero(e[campo], campo, id);
      if (n !== undefined) est[campo] = n;
    }
    // Crescimento no periodo, em pontos percentuais; pode ser negativo.
    if (e.crescimento_percentual !== undefined && e.crescimento_percentual !== null && e.crescimento_percentual !== '') {
      const c = Number(e.crescimento_percentual);
      if (!Number.isFinite(c) || c < -100 || c > 100000) throw new ToolError(`crescimento_percentual invalido para ${id}: "${e.crescimento_percentual}".`);
      est.crescimento_percentual = c;
    }
    const tendencia = String(e.tendencia === undefined || e.tendencia === null ? '' : e.tendencia).trim().slice(0, 60);
    if (tendencia) est.tendencia = tendencia;
    if (est.vendas === undefined && est.faturamento === undefined) {
      throw new ToolError(`A estimativa de ${id} precisa de "vendas" ou "faturamento".`);
    }
    p.estimativa_externa = est;
    registrados += 1;
  }
  if (!registrados) {
    throw new ToolError(`Nenhum produto_id pertence a esta mineracao: ${desconhecidos.slice(0, 10).join(', ')}.`);
  }
  return { fonte, periodo, registrados, fora_da_mineracao: desconhecidos };
}

module.exports = { registrarEstimativas };
