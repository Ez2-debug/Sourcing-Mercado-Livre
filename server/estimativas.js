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

// Quando a fonte nao informa tendencia, a idade do anuncio com vendas e o
// sinal disponivel: anuncio novo que ja vende esta em subida.
function tendenciaPelaIdade(dias) {
  if (dias === undefined) return '';
  if (dias <= 90) return `anúncio novo com tração (${dias} dias)`;
  if (dias <= 180) return `anúncio recente (${dias} dias)`;
  return '';
}

const CUBO_JOOMPULSE = 'MlbProductsSortedByProductId';
const MEDIDAS_JOOMPULSE = ['catalogOrderCount1w', 'catalogOrderGmv1w', 'reviewsCountMax', 'reviewsRating', 'daysInAd'];
const MAX_POR_CONSULTA = 100;

// Consulta CubeJS para a ferramenta query_cubejs_meli do conector JoomPulse:
// venda e faturamento semanais estimados por produto de catalogo.
function consultaJoomPulse(ids) {
  return JSON.stringify({
    dimensions: [`${CUBO_JOOMPULSE}.productId`],
    measures: MEDIDAS_JOOMPULSE.map((x) => `${CUBO_JOOMPULSE}.${x}`),
    filters: [
      { member: `${CUBO_JOOMPULSE}.productId`, operator: 'equals', values: ids },
      { member: `${CUBO_JOOMPULSE}.listingStatus`, operator: 'equals', values: ['active'] },
    ],
    limit: MAX_POR_CONSULTA,
  });
}

// Converte a resposta em colunas do JoomPulse ({ columns, data }) na lista de
// estimativas. Aceita o nome da coluna com ou sem o prefixo do cubo.
function estimativasDoJoomPulse(resposta) {
  let r = resposta;
  if (typeof r === 'string') {
    try { r = JSON.parse(r); } catch (_) { throw new ToolError('A resposta do JoomPulse nao e um JSON valido. Passe o resultado de query_cubejs_meli exatamente como veio.'); }
  }
  if (!r || !Array.isArray(r.columns) || !Array.isArray(r.data)) {
    throw new ToolError('A resposta do JoomPulse precisa ter "columns" e "data", como devolve query_cubejs_meli.');
  }
  const col = (nome) => r.columns.findIndex((c) => String(c).split('.').pop() === nome);
  const iId = col('productId');
  const iVendas = col('catalogOrderCount1w');
  if (iId < 0 || iVendas < 0) throw new ToolError('A resposta do JoomPulse nao traz as colunas productId e catalogOrderCount1w.');
  const opcional = { faturamento: col('catalogOrderGmv1w'), avaliacoes: col('reviewsCountMax'), avaliacao: col('reviewsRating'), dias_de_anuncio: col('daysInAd') };
  const lista = [];
  for (const linha of r.data) {
    if (!Array.isArray(linha) || typeof linha[iId] !== 'string' || typeof linha[iVendas] !== 'number') continue;
    const e = { produto_id: linha[iId], vendas: linha[iVendas] };
    for (const [campo, i] of Object.entries(opcional)) {
      // Nota zero no JoomPulse quer dizer "sem nota", nao nota zero.
      if (i >= 0 && typeof linha[i] === 'number' && !(campo === 'avaliacao' && linha[i] === 0)) e[campo] = linha[i];
    }
    lista.push(e);
  }
  if (!lista.length) throw new ToolError('A resposta do JoomPulse veio sem linhas de produto.');
  return lista;
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
    const dias = numero(e.dias_de_anuncio, 'dias_de_anuncio', id);
    if (dias !== undefined) est.dias_de_anuncio = Math.round(dias);
    const tendencia = String(e.tendencia === undefined || e.tendencia === null ? '' : e.tendencia).trim().slice(0, 60) ||
      tendenciaPelaIdade(est.dias_de_anuncio);
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

module.exports = { MAX_POR_CONSULTA, consultaJoomPulse, estimativasDoJoomPulse, registrarEstimativas };
