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

/* ------------------------------------------------------------------ */
/* Backend local (minerador): integracoes, produtos, Shopee, cotacoes  */
/* ------------------------------------------------------------------ */

async function comando(caminho, corpo) {
  const r = await fetch(caminho, {
    method: 'POST',
    headers: { 'X-Conecta-Hub': '1', 'Content-Type': 'application/json' },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const dados = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(dados.erro || 'O backend recusou o pedido.');
  return dados;
}

// Um retrato enviado pelo minerador (chs_retratos): "shopee" ou "cotacoes".
async function retrato(chave) {
  const linhas = conferir(await supabase.from('chs_retratos').select('dados, atualizado_em').eq('chave', chave).limit(1));
  return linhas.length ? linhas[0].dados : null;
}

// Produtos das mineracoes das ultimas 36 horas, a mais recente de cada categoria.
async function produtosDoSupabase() {
  const desde = new Date(Date.now() - 36 * 3600 * 1000).toISOString();
  const mineracoes = conferir(await supabase.from('chs_mineracoes').select('id, categoria_id, consultado_em')
    .gte('consultado_em', desde).order('consultado_em', { ascending: false }).limit(200));
  const vistas = new Set();
  const ids = mineracoes.filter((m) => !vistas.has(m.categoria_id) && vistas.add(m.categoria_id)).map((m) => m.id);
  if (!ids.length) return { total: 0, itens: [] };
  const linhas = await todasAsLinhas(() => supabase.from('chs_produtos')
    .select('mineracao_id, produto_id, nome, categoria, foto, link, melhor_posicao, menor_preco, situacao, prioridade, ncm_posicao, ncm_codigos, estimativa_fonte, estimativa_periodo, estimativa_vendas, avaliacoes:dados->estimativa_externa->avaliacoes, nota:dados->estimativa_externa->avaliacao, internacional:dados->anuncios->internacional, menor_preco_nacional:dados->anuncios->menor_preco_nacional')
    .in('mineracao_id', ids).not('nome', 'is', null).order('prioridade', { ascending: false }).order('produto_id'));
  const itens = linhas.slice(0, 200).map((p) => ({
    id: p.produto_id,
    nome: p.nome,
    categoria: p.categoria,
    foto: p.foto,
    link: p.link,
    posicao: p.melhor_posicao,
    menor_preco: p.menor_preco === null ? undefined : Number(p.menor_preco),
    situacao: p.situacao,
    prioridade: p.prioridade,
    ncm: Array.isArray(p.ncm_codigos) && p.ncm_codigos.length ? p.ncm_codigos[0] : (p.ncm_posicao ? `posição ${p.ncm_posicao.split(' ou ')[0]}` : undefined),
    vendas_estimadas: p.estimativa_vendas === null ? undefined : Number(p.estimativa_vendas),
    avaliacoes: typeof p.avaliacoes === 'number' ? p.avaliacoes : undefined,
    nota: typeof p.nota === 'number' ? p.nota : undefined,
    internacional: p.internacional || undefined,
    menor_preco_nacional: typeof p.menor_preco_nacional === 'number' ? p.menor_preco_nacional : undefined,
    fonte_da_estimativa: p.estimativa_fonte ? `${p.estimativa_fonte}, por ${p.estimativa_periodo === 'mensal' ? 'mês' : 'semana'}` : undefined,
    mineracao_id: p.mineracao_id,
  }));
  return { total: linhas.length, itens };
}

async function pacoteDoSupabase(id) {
  const r = await retrato('cotacoes');
  const pacote = r && r.pacotes.find((p) => p.id === id);
  if (!pacote || !pacote.linhas) throw new Error('Esta cotação ainda não foi enviada pelo minerador.');
  return { id, linhas: pacote.linhas };
}

export const carregarEstado = () => local('/api/estado');
export const carregarIntegracoes = () => local('/api/integracoes');
export const carregarProdutos = () => (comSupabase ? produtosDoSupabase() : local('/api/produtos'));
export const carregarShopee = () => (comSupabase
  ? retrato('shopee').then((r) => r || { itens: [], consultado_em: null })
  : local('/api/shopee'));
export const carregarJoompro = () => (comSupabase
  ? retrato('joompro').then((r) => r || { itens: [], consultado_em: null })
  : local('/api/joompro'));
export const carregarPacotes = () => (comSupabase
  ? retrato('cotacoes').then((r) => r || { pacotes: [] })
  : local('/api/accio'));
export const carregarPacote = (id) => (comSupabase ? pacoteDoSupabase(id) : local(`/api/accio/pacote?id=${encodeURIComponent(id)}`));
export const carregarPedidos = () => local('/api/pedidos');
export const criarPedido = (pedido) => comando('/api/pedidos', pedido);
export const gerarPlanilhas = (id) => comando(`/api/accio/planilha?id=${encodeURIComponent(id)}`);
export const comandarMinerador = (nome) => comando(`/api/${nome}`);

// Todas as cotacoes ja feitas, com as linhas produto x candidato. Na versao
// hospedada as linhas ja vem no retrato; no backend local, uma chamada por pacote.
export async function carregarCotacoesCompletas() {
  const { pacotes } = await carregarPacotes();
  const cotados = pacotes.filter((p) => p.sourcing);
  return Promise.all(cotados.map(async (p) => ({
    id: p.id,
    categoria: p.categoria,
    linhas: p.linhas || (await carregarPacote(p.id)).linhas || [],
  })));
}
