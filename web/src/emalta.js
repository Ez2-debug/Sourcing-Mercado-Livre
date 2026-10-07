// Produtos em alta a partir das linhas do Supabase. E a mesma regra de
// server/emalta.js: mudanca de posicao entre duas mineracoes da mesma
// categoria, so para produtos aptos.

const DIA = 86400000;

// mineracoes: [{ id, categoria_id, consultado_em }], em qualquer ordem.
// Devolve, por categoria, a mineracao atual e a que serve de base.
export function paresPorCategoria(mineracoes, dias) {
  const porCategoria = new Map();
  for (const m of mineracoes) {
    if (!porCategoria.has(m.categoria_id)) porCategoria.set(m.categoria_id, []);
    porCategoria.get(m.categoria_id).push(m);
  }
  const pares = [];
  let semHistorico = 0;
  for (const lista of porCategoria.values()) {
    lista.sort((a, b) => Date.parse(b.consultado_em) - Date.parse(a.consultado_em));
    const atual = lista[0];
    const corte = Date.parse(atual.consultado_em) - dias * DIA;
    // Sem mineracao com a idade pedida, usa a mais antiga e informa o periodo real.
    const base = lista.find((m) => Date.parse(m.consultado_em) <= corte) || lista[lista.length - 1];
    if (base.id === atual.id) semHistorico += 1;
    else pares.push({ atual, base });
  }
  return { pares, semHistorico };
}

function ncmCurto(p) {
  if (Array.isArray(p.ncm_codigos) && p.ncm_codigos.length) return p.ncm_codigos[0];
  return p.ncm_posicao ? `posição ${p.ncm_posicao.split(' ou ')[0]}` : undefined;
}

// produtos: linhas de chs_produtos das mineracoes que aparecem nos pares.
export function calcularEmAlta(pares, semHistorico, produtos, dias, limite = 24) {
  const porMineracao = new Map();
  for (const p of produtos) {
    if (!porMineracao.has(p.mineracao_id)) porMineracao.set(p.mineracao_id, []);
    porMineracao.get(p.mineracao_id).push(p);
  }
  const subindo = [];
  const entraram = [];
  let menorPeriodo = Infinity;
  for (const { atual, base } of pares) {
    const periodo = (Date.parse(atual.consultado_em) - Date.parse(base.consultado_em)) / DIA;
    menorPeriodo = Math.min(menorPeriodo, periodo);
    const antes = new Map((porMineracao.get(base.id) || []).map((p) => [p.produto_id, p]));
    for (const p of porMineracao.get(atual.id) || []) {
      if (p.situacao !== 'apto') continue;
      const a = antes.get(p.produto_id);
      if (a && a.melhor_posicao <= p.melhor_posicao) continue;
      const item = {
        id: p.produto_id,
        nome: p.nome,
        categoria: p.categoria,
        foto: p.foto,
        link: p.link,
        menor_preco: p.menor_preco === null ? undefined : Number(p.menor_preco),
        ncm: ncmCurto(p),
        posicao: p.melhor_posicao,
        posicao_anterior: a ? a.melhor_posicao : undefined,
        subiu: a ? a.melhor_posicao - p.melhor_posicao : undefined,
        comparado_com: base.consultado_em,
      };
      (a ? subindo : entraram).push(item);
    }
  }
  subindo.sort((x, y) => y.subiu - x.subiu || x.posicao - y.posicao);
  entraram.sort((x, y) => x.posicao - y.posicao);
  return {
    dias_pedidos: dias,
    menor_periodo_em_dias: Number.isFinite(menorPeriodo) ? Math.round(menorPeriodo * 10) / 10 : null,
    categorias_comparadas: pares.length,
    categorias_sem_historico: semHistorico,
    total_subindo: subindo.length,
    total_entraram: entraram.length,
    subindo: subindo.slice(0, limite),
    entraram: entraram.slice(0, limite),
  };
}
