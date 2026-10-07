'use strict';

/*
 * Produtos em alta: quem subiu no ranking do Mercado Livre entre duas
 * mineracoes da mesma categoria.
 *
 * So existe porque as mineracoes ficam gravadas: a API nao guarda historico.
 * E mudanca de posicao, nao de vendas. Cada categoria e comparada com a
 * mineracao mais recente que tenha pelo menos o periodo pedido; quando o
 * historico e mais curto, usa a mais antiga e informa o periodo real.
 */

const fs = require('node:fs');
const path = require('node:path');

const { todosOsProdutos } = require('./mineracao');
const { ncmCurto, situacao } = require('./indicadores');
const { listarMineracoes, pastaMineracoes } = require('./saida');

const DIA = 86400000;
const PERIODOS = [7, 30];

// AAAAMMDD-HHMMSS-<categoria>, gravado em UTC por salvarMineracao.
function instanteDoId(id) {
  return Date.UTC(+id.slice(0, 4), +id.slice(4, 6) - 1, +id.slice(6, 8), +id.slice(9, 11), +id.slice(11, 13), +id.slice(13, 15));
}

function ler(id) {
  try {
    return JSON.parse(fs.readFileSync(path.join(pastaMineracoes(), id, 'mineracao.json'), 'utf8'));
  } catch (_) {
    return null;
  }
}

// Para cada categoria, a mineracao atual e a que serve de base da comparacao.
function paresPorCategoria(ids, dias) {
  const porCategoria = new Map();
  for (const id of ids) {
    const cat = id.slice(16);
    if (!porCategoria.has(cat)) porCategoria.set(cat, []);
    porCategoria.get(cat).push(id);
  }
  const pares = [];
  let semHistorico = 0;
  for (const lista of porCategoria.values()) {
    // A lista vem da mais recente para a mais antiga.
    const atual = lista[0];
    const corte = instanteDoId(atual) - dias * DIA;
    const base = lista.find((id) => instanteDoId(id) <= corte) || lista[lista.length - 1];
    if (base === atual) semHistorico += 1;
    else pares.push({ atual, base });
  }
  return { pares, semHistorico };
}

const precoDe = (p) => (p.anuncios && p.anuncios.menor_preco ? p.anuncios.menor_preco.valor : undefined);

function emAlta(opcoes) {
  const o = opcoes || {};
  const dias = PERIODOS.includes(o.dias) ? o.dias : PERIODOS[0];
  const limite = Number.isInteger(o.limite) && o.limite > 0 ? Math.min(o.limite, 100) : 24;
  const { pares, semHistorico } = paresPorCategoria(listarMineracoes(), dias);
  const subindo = [];
  const entraram = [];
  let menorPeriodo = Infinity;
  let comparadas = 0;
  for (const par of pares) {
    const atual = ler(par.atual);
    const base = ler(par.base);
    if (!atual || !base) continue;
    comparadas += 1;
    const periodo = (Date.parse(atual.consultado_em) - Date.parse(base.consultado_em)) / DIA;
    menorPeriodo = Math.min(menorPeriodo, periodo);
    const antes = new Map(todosOsProdutos(base).map((p) => [p.id, p]));
    for (const p of todosOsProdutos(atual)) {
      // So o que pode seguir para cotacao: sem marca conhecida e sem alerta.
      if (situacao(p) !== 'apto') continue;
      const a = antes.get(p.id);
      if (a && a.melhor_posicao <= p.melhor_posicao) continue;
      const item = {
        id: p.id,
        nome: p.nome,
        categoria: p.categoria,
        foto: p.foto,
        link: p.link,
        menor_preco: precoDe(p),
        ncm: ncmCurto(p),
        posicao: p.melhor_posicao,
        posicao_anterior: a ? a.melhor_posicao : undefined,
        subiu: a ? a.melhor_posicao - p.melhor_posicao : undefined,
        comparado_com: base.consultado_em,
        dias_comparados: Math.round(periodo * 10) / 10,
      };
      for (const k of Object.keys(item)) if (item[k] === undefined) delete item[k];
      (a ? subindo : entraram).push(item);
    }
  }
  subindo.sort((x, y) => y.subiu - x.subiu || x.posicao - y.posicao);
  entraram.sort((x, y) => x.posicao - y.posicao);
  return {
    dias_pedidos: dias,
    // Com pouco historico a comparacao cobre menos dias do que o pedido.
    menor_periodo_em_dias: Number.isFinite(menorPeriodo) ? Math.round(menorPeriodo * 10) / 10 : null,
    categorias_comparadas: comparadas,
    categorias_sem_historico: semHistorico,
    total_subindo: subindo.length,
    total_entraram: entraram.length,
    subindo: subindo.slice(0, limite),
    entraram: entraram.slice(0, limite),
    observacao: 'Mudanca de posicao no ranking entre duas mineracoes, nao quantidade vendida. ' +
      '"Entraram" passaram a figurar entre os mais bem colocados que a mineracao detalha.',
  };
}

module.exports = { PERIODOS, emAlta, instanteDoId };
