// De onde o app le os dados.
//
// Com VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY, le o Supabase e exige login.
// Sem eles, abre em modo demonstracao e le a central do minerador local
// (http://127.0.0.1:4310) pelo atalho do Vite. As duas fontes devolvem o
// mesmo formato, para as telas nao saberem a diferenca.

import { createClient } from '@supabase/supabase-js';
import { calcularEmAlta, paresPorCategoria } from './emalta.js';

const URL_SUPABASE = (import.meta.env.VITE_SUPABASE_URL || '').trim();
const CHAVE_PUBLICA = (import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim();

export const comSupabase = /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(URL_SUPABASE) && CHAVE_PUBLICA.length > 0;
export const supabase = comSupabase ? createClient(URL_SUPABASE, CHAVE_PUBLICA) : null;

const cotacao = (import.meta.env.VITE_COTACAO_URL || '').trim();
export const COTACAO_URL = /^https:\/\/[^\s"'<>]+$/i.test(cotacao) ? cotacao : null;

async function local(caminho) {
  const r = await fetch(caminho, { cache: 'no-store' });
  if (!r.ok) throw new Error('A central do minerador não respondeu. Ela está ligada?');
  return r.json();
}

function conferir({ data, error }) {
  if (error) throw new Error(error.message);
  return data;
}

// O Supabase devolve no maximo 1000 linhas por pedido.
async function todasAsLinhas(montar) {
  const linhas = [];
  for (let de = 0; ; de += 1000) {
    const pagina = conferir(await montar().range(de, de + 999));
    linhas.push(...pagina);
    if (pagina.length < 1000) return linhas;
  }
}

/* ------------------------------------------------------------------ */
/* Visao geral                                                         */
/* ------------------------------------------------------------------ */

function mesmoDia(iso, ref) {
  return new Date(iso).toDateString() === ref.toDateString();
}

async function visaoGeralDoSupabase() {
  const mineracoes = conferir(await supabase
    .from('chs_mineracoes')
    .select('id, categoria, categoria_id, consultado_em, indicadores')
    .order('consultado_em', { ascending: false })
    .limit(60));
  const hoje = new Date();
  // A mesma categoria minerada duas vezes no dia conta uma vez: vale a mais recente.
  const vistas = new Set();
  const deHoje = mineracoes.filter((m) => {
    if (!mesmoDia(m.consultado_em, hoje) || vistas.has(m.categoria_id)) return false;
    vistas.add(m.categoria_id);
    return true;
  });
  const sugestoes = deHoje
    .flatMap((m) => ((m.indicadores && m.indicadores.sugestoes) || []).filter((s) => s.apto))
    .sort((a, b) => b.prioridade - a.prioridade)
    .slice(0, 8);
  const soma = (campo) => deHoje.reduce((t, m) => t + (((m.indicadores || {})[campo[0]] || {})[campo[1]] || 0), 0);
  return {
    demonstracao: false,
    situacao: null,
    hoje: { categorias: deHoje.length, produtos: soma(['totais', 'produtos']), aptos: soma(['triagem', 'apto']), sugestoes },
    categorias_acompanhadas: new Set(mineracoes.map((m) => m.categoria_id)).size,
    ultima_mineracao: mineracoes.length ? mineracoes[0].consultado_em : null,
    historico: mineracoes.slice(0, 12).map((m) => ({
      id: m.id,
      categoria: m.categoria,
      quando: m.consultado_em,
      produtos: ((m.indicadores || {}).totais || {}).produtos,
      aptos: ((m.indicadores || {}).triagem || {}).apto,
    })),
  };
}

async function visaoGeralLocal() {
  const e = await local('/api/estado');
  return {
    demonstracao: true,
    situacao: e.situacao,
    atual: e.atual,
    proxima_em: e.proxima_em,
    hoje: e.hoje,
    categorias_acompanhadas: e.fila.length,
    ultima_mineracao: e.historico.length ? e.historico[0].fim : null,
    historico: e.historico.filter((h) => !h.erro).slice(0, 12).map((h) => ({
      id: h.mineracao_id, categoria: h.categoria, quando: h.fim, produtos: h.produtos, aptos: h.aptos,
    })),
  };
}

export function carregarVisaoGeral() {
  return comSupabase ? visaoGeralDoSupabase() : visaoGeralLocal();
}

/* ------------------------------------------------------------------ */
/* Em alta                                                             */
/* ------------------------------------------------------------------ */

async function emAltaDoSupabase(dias) {
  const mineracoes = await todasAsLinhas(() => supabase
    .from('chs_mineracoes')
    .select('id, categoria_id, consultado_em')
    .order('consultado_em', { ascending: false }));
  const { pares, semHistorico } = paresPorCategoria(mineracoes, dias);
  if (!pares.length) return calcularEmAlta([], semHistorico, [], dias);
  const ids = Array.from(new Set(pares.flatMap((p) => [p.atual.id, p.base.id])));
  const produtos = await todasAsLinhas(() => supabase
    .from('chs_produtos')
    .select('mineracao_id, produto_id, categoria, nome, foto, link, melhor_posicao, menor_preco, situacao, ncm_posicao, ncm_codigos')
    .in('mineracao_id', ids)
    .order('mineracao_id')
    .order('produto_id'));
  return calcularEmAlta(pares, semHistorico, produtos, dias);
}

export function carregarEmAlta(dias) {
  return comSupabase ? emAltaDoSupabase(dias) : local(`/api/em-alta?dias=${dias}`);
}
