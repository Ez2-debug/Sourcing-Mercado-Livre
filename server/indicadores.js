'use strict';

/*
 * Indicadores de uma mineracao: triagem, distribuicoes, comparacao com a
 * mineracao anterior da mesma categoria e sugestoes de produto.
 *
 * Tudo aqui e contagem do que a API devolveu. Nao ha estimativa de vendas:
 * a comparacao entre mineracoes mostra mudanca de posicao no ranking, que e
 * o unico sinal de demanda que a API entrega.
 */

const { todosOsProdutos } = require('./mineracao');

const FAIXAS_PRECO = [
  { ate: 25, rotulo: 'até R$ 25' },
  { ate: 50, rotulo: 'R$ 25 a 50' },
  { ate: 100, rotulo: 'R$ 50 a 100' },
  { ate: 250, rotulo: 'R$ 100 a 250' },
  { ate: 500, rotulo: 'R$ 250 a 500' },
  { ate: Infinity, rotulo: 'acima de R$ 500' },
];

const FAIXAS_ANUNCIOS = [
  { ate: 1, rotulo: '1 anúncio' },
  { ate: 5, rotulo: '2 a 5' },
  { ate: 20, rotulo: '6 a 20' },
  { ate: 100, rotulo: '21 a 100' },
  { ate: Infinity, rotulo: 'mais de 100' },
];

function distribuir(valores, faixas) {
  const linhas = faixas.map((f) => ({ rotulo: f.rotulo, valor: 0 }));
  for (const v of valores) {
    if (typeof v !== 'number') continue;
    linhas[faixas.findIndex((f) => v <= f.ate)].valor += 1;
  }
  return linhas;
}

const precoDe = (p) => (p.anuncios && p.anuncios.menor_preco ? p.anuncios.menor_preco.valor : undefined);

/* ------------------------------------------------------------------ */
/* Triagem                                                             */
/* ------------------------------------------------------------------ */

// Situacao do produto na triagem para cotacao. A ordem importa: proibido
// vence qualquer outro motivo.
function situacao(p) {
  if (!p.nome) return 'sem_detalhe';
  const reg = p.sinais.regulatorio;
  if (reg.some((r) => r.orgao === 'Proibido')) return 'proibido';
  if (reg.length) return 'regulado';
  if (!p.sinais.sem_marca) return 'marca_registrada';
  return 'apto';
}

function porPrioridade(a, b) {
  return b.prioridade.pontos - a.prioridade.pontos || a.melhor_posicao - b.melhor_posicao;
}

function selecionarParaAccio(m, filtros) {
  const f = filtros || {};
  const limite = Number.isInteger(f.limite) && f.limite > 0 ? Math.min(f.limite, 100) : 20;
  const descartados = { proibido: 0, regulado: 0, marca_registrada: 0, sem_detalhe: 0 };
  const aceitos = [];
  for (const p of todosOsProdutos(m)) {
    if (!p.nome) { descartados.sem_detalhe += 1; continue; }
    const reg = p.sinais.regulatorio;
    // Produto proibido nunca segue para cotacao, independente do filtro.
    if (reg.some((r) => r.orgao === 'Proibido')) { descartados.proibido += 1; continue; }
    if (reg.length && f.incluir_regulados !== true) { descartados.regulado += 1; continue; }
    if (!p.sinais.sem_marca && f.incluir_marcas !== true) { descartados.marca_registrada += 1; continue; }
    aceitos.push(p);
  }
  aceitos.sort(porPrioridade);
  return { produtos: aceitos.slice(0, limite), descartados, acima_do_limite: Math.max(0, aceitos.length - limite) };
}

/* ------------------------------------------------------------------ */
/* Sugestoes                                                           */
/* ------------------------------------------------------------------ */

function motivos(p) {
  const c = p.prioridade.componentes;
  const lista = [`${p.melhor_posicao}º no ranking de mais vendidos`];
  if (p.aparicoes.length > 1) lista.push(`aparece em ${p.aparicoes.length} rankings`);
  if (c.termo_em_alta) lista.push(`bate com o termo em alta "${p.tendencias_relacionadas[0]}"`);
  if (c.sem_marca_registrada) lista.push('sem marca registrada');
  const n = p.anuncios && p.anuncios.quantidade_anuncios;
  if (c.poucos_anuncios_concorrentes) lista.push(n === 1 ? 'um único anúncio concorrente' : `só ${n} anúncios concorrentes`);
  return lista;
}

function ressalvas(p) {
  const lista = [];
  if (!p.sinais.sem_marca) lista.push(`marca registrada (${p.marca}): só com produto equivalente sem marca`);
  for (const r of p.sinais.regulatorio) lista.push(`${r.orgao}: ${r.motivo}`);
  return lista;
}

// Os aptos vem primeiro. Se nao houver o bastante, completa com os demais
// (nunca os proibidos), e cada um leva a ressalva que o tirou da triagem.
function sugerir(m, quantidade) {
  const validos = todosOsProdutos(m).filter((p) => !['sem_detalhe', 'proibido'].includes(situacao(p)));
  const aptos = validos.filter((p) => situacao(p) === 'apto').sort(porPrioridade);
  const outros = validos.filter((p) => situacao(p) !== 'apto').sort(porPrioridade);
  return aptos.concat(outros).slice(0, quantidade).map((p) => {
    const item = {
      id: p.id,
      nome: p.nome,
      categoria: p.categoria,
      foto: p.foto,
      link: p.link,
      menor_preco: precoDe(p),
      prioridade: p.prioridade.pontos,
      apto: situacao(p) === 'apto',
      motivos: motivos(p),
    };
    const r = ressalvas(p);
    if (r.length) item.ressalvas = r;
    for (const k of Object.keys(item)) if (item[k] === undefined) delete item[k];
    return item;
  });
}

/* ------------------------------------------------------------------ */
/* Comparacao com a mineracao anterior                                 */
/* ------------------------------------------------------------------ */

function comparar(m, anterior) {
  if (!anterior) return null;
  const antes = new Map(todosOsProdutos(anterior).map((p) => [p.id, p]));
  const agora = todosOsProdutos(m);
  const linha = (p, a) => ({
    id: p.id,
    nome: p.nome || p.id,
    link: p.link,
    posicao: p.melhor_posicao,
    posicao_anterior: a ? a.melhor_posicao : undefined,
    menor_preco: precoDe(p),
    menor_preco_anterior: a ? precoDe(a) : undefined,
  });
  const out = { subiram: [], desceram: [], novos: [], sairam: [], mantiveram: 0 };
  for (const p of agora) {
    const a = antes.get(p.id);
    if (!a) out.novos.push(linha(p));
    else if (p.melhor_posicao < a.melhor_posicao) out.subiram.push(linha(p, a));
    else if (p.melhor_posicao > a.melhor_posicao) out.desceram.push(linha(p, a));
    else out.mantiveram += 1;
  }
  const ids = new Set(agora.map((p) => p.id));
  for (const a of antes.values()) {
    if (!ids.has(a.id)) out.sairam.push({ id: a.id, nome: a.nome || a.id, link: a.link, posicao_anterior: a.melhor_posicao });
  }
  out.subiram.sort((x, y) => (y.posicao_anterior - y.posicao) - (x.posicao_anterior - x.posicao));
  out.desceram.sort((x, y) => (y.posicao - y.posicao_anterior) - (x.posicao - x.posicao_anterior));
  out.novos.sort((x, y) => x.posicao - y.posicao);
  return {
    mineracao_anterior: anterior.id,
    consultado_em: anterior.consultado_em,
    // As duas mineracoes detalham so os mais bem colocados; "sairam" quer
    // dizer que deixaram esse grupo, nao que sumiram do site.
    observacao: 'Compara os produtos detalhados nas duas mineracoes. "Sairam" deixaram o grupo dos mais bem colocados.',
    ...out,
  };
}

/* ------------------------------------------------------------------ */
/* Indicadores                                                         */
/* ------------------------------------------------------------------ */

function calcularIndicadores(m, anterior) {
  const produtos = todosOsProdutos(m);
  const triagem = { apto: 0, marca_registrada: 0, regulado: 0, proibido: 0, sem_detalhe: 0 };
  const orgaos = {};
  const vendas = [];
  for (const p of produtos) {
    triagem[situacao(p)] += 1;
    for (const r of (p.sinais && p.sinais.regulatorio) || []) orgaos[r.orgao] = (orgaos[r.orgao] || 0) + 1;
    if (p.campos_de_venda) vendas.push({ id: p.id, nome: p.nome, campos: p.campos_de_venda });
  }
  const precos = produtos.map(precoDe).filter((v) => typeof v === 'number');
  return {
    mineracao_id: m.id,
    categoria: m.categoria_raiz.caminho,
    consultado_em: m.consultado_em,
    totais: {
      produtos: produtos.length,
      categorias_com_produto: m.categorias.filter((c) => c.produtos.length).length,
      aptos_para_cotacao: triagem.apto,
      sem_marca_registrada: produtos.filter((p) => p.sinais && p.sinais.sem_marca).length,
      em_alta: produtos.filter((p) => p.tendencias_relacionadas && p.tendencias_relacionadas.length).length,
      menor_preco: precos.length ? Math.min(...precos) : undefined,
      maior_preco: precos.length ? Math.max(...precos) : undefined,
    },
    triagem,
    alertas_por_orgao: orgaos,
    produtos_por_categoria: m.categorias.filter((c) => c.produtos.length)
      .map((c) => ({ rotulo: c.nome, detalhe: c.caminho, valor: c.produtos.length })),
    faixas_de_preco: distribuir(precos, FAIXAS_PRECO),
    concorrencia: distribuir(produtos.map((p) => p.anuncios && p.anuncios.quantidade_anuncios), FAIXAS_ANUNCIOS),
    vendas: {
      registros_com_campo_de_venda: vendas,
      observacao: vendas.length
        ? 'Campos de venda exatamente como a API devolveu.'
        : 'A API nao devolveu nenhum campo de vendas. Com o token desta aplicacao, /items e /sites/MLB/search respondem 403 ' +
          'e os produtos de catalogo nao trazem quantidade vendida. O sinal de demanda disponivel e a posicao no ranking e sua variacao entre mineracoes.',
    },
    variacao: comparar(m, anterior),
    sugestoes: sugerir(m, 8),
  };
}

module.exports = { calcularIndicadores, comparar, selecionarParaAccio, situacao, sugerir };
