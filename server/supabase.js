'use strict';

/*
 * Gravacao das mineracoes no Supabase, pela API REST do projeto (PostgREST).
 *
 * As tabelas estao em supabase/schema.sql. O endereco do projeto e a chave
 * secreta chegam por variaveis de ambiente, preenchidas na tela de
 * configuracao da extensao. Sem as duas, nada e enviado.
 */

const { ToolError, cleanEnv } = require('./meli');
const { todosOsProdutos } = require('./mineracao');
const { calcularIndicadores, marcaBarra, situacao } = require('./indicadores');

const TIMEOUT_MS = 20000;
const LOTE = 200;

// A chave so sai para o proprio Supabase. Endereco local vale para testes.
function config() {
  const bruto = cleanEnv(process.env.SUPABASE_URL).replace(/\/+$/, '');
  const chave = cleanEnv(process.env.SUPABASE_KEY);
  if (!bruto || !chave) return null;
  let u;
  try { u = new URL(bruto); } catch (_) { u = null; }
  const local = u && u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost');
  const oficial = u && u.protocol === 'https:' && /^[a-z0-9]+\.supabase\.co$/.test(u.hostname);
  if (!u || u.pathname !== '/' || !(local || oficial)) {
    throw new ToolError('Endereco do Supabase invalido. Use o Project URL, no formato https://<projeto>.supabase.co.');
  }
  return { url: u.origin, chave };
}

function configurado() {
  try { return Boolean(config()); } catch (_) { return true; }
}

async function upsert(cfg, tabela, conflito, linhas) {
  for (let i = 0; i < linhas.length; i += LOTE) {
    let res;
    try {
      res = await fetch(`${cfg.url}/rest/v1/${tabela}?on_conflict=${conflito}`, {
        method: 'POST',
        headers: {
          apikey: cfg.chave,
          authorization: `Bearer ${cfg.chave}`,
          'content-type': 'application/json',
          prefer: 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify(linhas.slice(i, i + LOTE)),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      throw new ToolError(`Nao consegui falar com o Supabase (${(err.cause && err.cause.code) || err.message}).`);
    }
    if (res.ok) continue;
    let detalhe = '';
    try { const corpo = await res.json(); detalhe = corpo.message || corpo.error || corpo.code || ''; } catch (_) { /* sem corpo */ }
    if (res.status === 404 || /PGRST205|does not exist|schema cache/i.test(detalhe)) {
      throw new ToolError(`A tabela ${tabela} nao existe no projeto. Rode supabase/schema.sql e supabase/hospedagem.sql no SQL Editor do Supabase e tente de novo.`);
    }
    if (res.status === 401 || res.status === 403) {
      throw new ToolError(`O Supabase recusou a chave (HTTP ${res.status}). Use a chave secreta (service role) do projeto na configuracao da extensao.`);
    }
    throw new ToolError(`O Supabase respondeu HTTP ${res.status} ao gravar em ${tabela} (${detalhe || 'sem detalhe'}).`);
  }
}

function linhaDoProduto(m, p) {
  const an = p.anuncios || {};
  const est = p.estimativa_externa || {};
  const sinais = p.sinais || { regulatorio: [] };
  return {
    mineracao_id: m.id,
    produto_id: p.id,
    categoria_id: p.categoria_id,
    categoria: p.categoria,
    nome: p.nome || null,
    marca: p.marca || null,
    tipo_de_marca: !p.nome ? null : (sinais.sem_marca ? 'sem_marca' : (marcaBarra(p) ? 'conhecida' : 'de_vendedor')),
    foto: p.foto || null,
    link: p.link || null,
    melhor_posicao: p.melhor_posicao,
    menor_preco: an.menor_preco ? an.menor_preco.valor : null,
    quantidade_anuncios: an.quantidade_anuncios === undefined ? null : an.quantidade_anuncios,
    vendedores: an.vendedores === undefined ? null : an.vendedores,
    prioridade: p.prioridade ? p.prioridade.pontos : null,
    situacao: p.sinais ? situacao(p) : 'sem_detalhe',
    alertas: sinais.regulatorio.map((r) => r.orgao),
    termos_em_alta: p.tendencias_relacionadas || [],
    ncm_posicao: p.ncm ? p.ncm.posicao.map((x) => x.codigo).join(' ou ') : null,
    ncm_codigos: p.ncm ? p.ncm.sugestoes.map((s) => s.codigo) : [],
    estimativa_fonte: est.fonte || null,
    estimativa_periodo: est.periodo || null,
    estimativa_vendas: est.vendas === undefined ? null : est.vendas,
    estimativa_faturamento: est.faturamento === undefined ? null : est.faturamento,
    dados: p,
  };
}

// Grava a mineracao inteira. Rodar de novo atualiza as mesmas linhas.
async function salvarNoSupabase(m) {
  const cfg = config();
  if (!cfg) {
    throw new ToolError(
      'O Supabase nao esta configurado. No Claude Desktop, abra Settings > Extensions > Conecta Hub Sourcing > Configure ' +
      'e preencha o endereco do projeto e a chave secreta.'
    );
  }
  const indicadores = calcularIndicadores(m, null);
  delete indicadores.variacao;
  await upsert(cfg, 'chs_mineracoes', 'id', [{
    id: m.id,
    categoria_id: m.categoria_raiz.id,
    categoria: m.categoria_raiz.caminho,
    consultado_em: m.consultado_em,
    parametros: m.parametros,
    resumo: m.resumo,
    ncm: m.ncm || null,
    indicadores,
    atualizado_em: new Date().toISOString(),
  }]);
  const categorias = m.categorias.map((c) => ({
    mineracao_id: m.id,
    categoria_id: c.id,
    nome: c.nome,
    caminho: c.caminho,
    nivel: c.nivel,
    foto: c.foto || null,
    link: c.link || null,
    total_anuncios: c.total_anuncios === undefined ? null : c.total_anuncios,
    termos_em_alta: c.termos_em_alta || [],
  }));
  await upsert(cfg, 'chs_categorias', 'mineracao_id,categoria_id', categorias);
  const produtos = todosOsProdutos(m).map((p) => linhaDoProduto(m, p));
  await upsert(cfg, 'chs_produtos', 'mineracao_id,produto_id', produtos);
  return { projeto: new URL(cfg.url).hostname, mineracao_id: m.id, categorias: categorias.length, produtos: produtos.length };
}

// Usado depois de minerar: grava se estiver configurado e nunca derruba a
// ferramenta; o erro volta no resultado.
async function salvarSeConfigurado(m) {
  if (!configurado()) return undefined;
  try {
    return await salvarNoSupabase(m);
  } catch (err) {
    if (!(err instanceof ToolError)) throw err;
    return { erro: err.message };
  }
}

// Retratos para o aplicativo web hospedado: a ultima leitura da Shopee e as
// cotacoes dos pacotes. Cada um e uma linha de chs_retratos, substituida a
// cada envio. Nunca derruba quem chamou; o erro volta no resultado.
async function sincronizarRetratos() {
  if (!configurado()) return undefined;
  // Carregados aqui para este modulo nao depender deles ao ser importado.
  const { lerShopee } = require('./shopee');
  const { detalharPacote, listarPacotes } = require('./accio');
  try {
    const cfg = config();
    const agora = new Date().toISOString();
    const pacotes = listarPacotes().pacotes.map((p) => {
      // Caminhos do computador nao vao para a nuvem.
      const { pasta, pedido, ...resto } = p;
      const sourcing = p.sourcing ? { feito_em: p.sourcing.feito_em, candidatos: p.sourcing.candidatos, ligado_por: p.sourcing.ligado_por } : null;
      let linhas = null;
      if (p.sourcing) {
        try { linhas = detalharPacote(p.id).linhas; } catch (_) { linhas = null; }
      }
      return { ...resto, sourcing, linhas };
    });
    const linhas = [{ chave: 'cotacoes', atualizado_em: agora, dados: { pacotes } }];
    const shopee = lerShopee();
    if (shopee) linhas.push({ chave: 'shopee', atualizado_em: agora, dados: shopee });
    const joompro = require('./joompro').lerJoompro();
    if (joompro) linhas.push({ chave: 'joompro', atualizado_em: agora, dados: joompro });
    await upsert(cfg, 'chs_retratos', 'chave', linhas);
    return { projeto: new URL(cfg.url).hostname, retratos: linhas.map((l) => l.chave) };
  } catch (err) {
    if (!(err instanceof ToolError)) throw err;
    return { erro: err.message };
  }
}

module.exports = { configurado, salvarNoSupabase, salvarSeConfigurado, sincronizarRetratos };
