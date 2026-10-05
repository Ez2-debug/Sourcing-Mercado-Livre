'use strict';

/*
 * Gravacao das mineracoes em disco e envio para o Accio Work.
 *
 * O Accio Work e um aplicativo local que trabalha sobre pastas do computador
 * (por padrao ~/AccioWork). "Enviar" aqui e gravar nessa pasta um pacote com
 * os produtos, as fotos e um briefing que o agente do Accio le para buscar
 * fornecedores.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { ToolError, cleanEnv } = require('./meli');
const { esc, preco, url } = require('./html');
const { calcularIndicadores, selecionarParaAccio } = require('./indicadores');
const { painelHtml } = require('./painel');

function pastaMineracoes() {
  return cleanEnv(process.env.CONECTA_HUB_SAIDA) || path.join(os.homedir(), 'ConectaHubSourcing', 'mineracoes');
}

function pastaAccio() {
  return cleanEnv(process.env.ACCIO_WORK_DIR) || path.join(os.homedir(), 'AccioWork');
}

function carimbo(iso) {
  return iso.replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
}

function gravar(arquivo, conteudo) {
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  fs.writeFileSync(arquivo, conteudo, 'utf8');
}

/* ------------------------------------------------------------------ */
/* Catalogo em HTML                                                    */
/* ------------------------------------------------------------------ */

function cartaoProduto(p) {
  const an = p.anuncios || {};
  const etiquetas = [];
  if (p.sinais && p.sinais.sem_marca) etiquetas.push('<span class="tag ok">Sem marca registrada</span>');
  if (p.marca && !(p.sinais && p.sinais.sem_marca)) etiquetas.push(`<span class="tag marca">Marca: ${esc(p.marca)}</span>`);
  for (const r of (p.sinais && p.sinais.regulatorio) || []) {
    etiquetas.push(`<span class="tag ${r.orgao === 'Proibido' ? 'ruim' : 'alerta'}" title="${esc(r.motivo)}">${esc(r.orgao)}</span>`);
  }
  for (const t of p.tendencias_relacionadas || []) etiquetas.push(`<span class="tag alta">Em alta: ${esc(t)}</span>`);
  const outras = p.aparicoes.filter((a) => a.categoria_id !== p.categoria_id)
    .map((a) => `${esc(a.categoria)} (${a.posicao}º)`).join('; ');
  const casa = p.aparicoes.find((a) => a.categoria_id === p.categoria_id);
  return `<article class="produto">
  ${url(p.foto) ? `<img loading="lazy" src="${url(p.foto)}" alt="${esc(p.nome || p.id)}">` : '<div class="semfoto">sem foto</div>'}
  <div class="corpo">
    <div class="pos">${casa && casa.posicao ? `${casa.posicao}º no ranking` : ''} · prioridade ${p.prioridade ? p.prioridade.pontos : 0}</div>
    <h3><a href="${url(p.link)}" target="_blank" rel="noopener">${esc(p.nome || p.id)}</a></h3>
    <div class="preco">${an.menor_preco ? `a partir de ${preco(an.menor_preco.valor, an.menor_preco.moeda)}` : (p.detalhe_indisponivel ? `detalhe indisponível (${esc(p.detalhe_indisponivel)})` : 'sem preço')}</div>
    <div class="meta">${an.quantidade_anuncios !== undefined ? `${an.quantidade_anuncios} anúncio(s) · ${an.vendedores || 0} vendedor(es)` : ''}</div>
    <div class="tags">${etiquetas.join('')}</div>
    ${outras ? `<div class="meta">Também em: ${outras}</div>` : ''}
  </div>
</article>`;
}

function catalogoHtml(m) {
  const secoes = m.categorias.filter((c) => c.produtos.length).map((c) => `<section>
  <header class="cat">
    ${url(c.foto) ? `<img src="${url(c.foto)}" alt="${esc(c.nome)}">` : ''}
    <div>
      <h2>${url(c.link) ? `<a href="${url(c.link)}" target="_blank" rel="noopener">${esc(c.caminho)}</a>` : esc(c.caminho)}</h2>
      <p>${esc(c.id)} · ${c.produtos.length} produto(s)${c.termos_em_alta.length ? ` · em alta: ${esc(c.termos_em_alta.slice(0, 6).join(', '))}` : ''}</p>
    </div>
  </header>
  <div class="grade">${c.produtos.map(cartaoProduto).join('\n')}</div>
</section>`).join('\n');
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Mineração · ${esc(m.categoria_raiz.nome)}</title>
<style>
  :root { --fundo:#f5f5f5; --cartao:#fff; --texto:#222; --suave:#666; --borda:#e3e3e3; --link:#3483fa; }
  @media (prefers-color-scheme: dark) { :root { --fundo:#161616; --cartao:#222; --texto:#eee; --suave:#aaa; --borda:#333; --link:#7ab0ff; } }
  * { box-sizing: border-box; }
  body { margin:0; padding:16px; background:var(--fundo); color:var(--texto); font:15px/1.45 system-ui, sans-serif; }
  main { max-width:1200px; margin:0 auto; }
  h1 { font-size:22px; margin:0 0 4px; }
  .aviso { color:var(--suave); font-size:13px; margin:0 0 24px; }
  section { margin-bottom:32px; }
  .cat { display:flex; gap:12px; align-items:center; margin-bottom:12px; }
  .cat img { width:56px; height:56px; object-fit:contain; border-radius:8px; background:#fff; border:1px solid var(--borda); }
  .cat h2 { font-size:18px; margin:0; }
  .cat p { margin:2px 0 0; color:var(--suave); font-size:13px; }
  .grade { display:grid; grid-template-columns:repeat(auto-fill, minmax(230px, 1fr)); gap:12px; }
  .produto { background:var(--cartao); border:1px solid var(--borda); border-radius:8px; overflow:hidden; display:flex; flex-direction:column; }
  .produto img, .semfoto { width:100%; height:200px; object-fit:contain; background:#fff; }
  .semfoto { display:flex; align-items:center; justify-content:center; color:#999; }
  .corpo { padding:10px 12px 12px; }
  .pos, .meta { color:var(--suave); font-size:12px; }
  h3 { font-size:14px; font-weight:500; margin:4px 0 6px; }
  a { color:var(--link); text-decoration:none; }
  a:hover { text-decoration:underline; }
  .preco { font-size:17px; margin-bottom:2px; }
  .tags { margin:6px 0; display:flex; flex-wrap:wrap; gap:4px; }
  .tag { font-size:11px; padding:2px 6px; border-radius:4px; background:#e8e8e8; color:#333; }
  .tag.ok { background:#d6f5df; color:#0a5c2b; } .tag.alerta { background:#fff0c2; color:#6b4e00; }
  .tag.ruim { background:#ffd9d9; color:#8a0f0f; } .tag.alta { background:#dbe9ff; color:#103f85; }
</style>
</head>
<body>
<main>
<h1>Mineração · ${esc(m.categoria_raiz.caminho)}</h1>
<p class="aviso">Consulta de ${esc(new Date(m.consultado_em).toLocaleString('pt-BR'))}. ${m.resumo.produtos_detalhados} produto(s) em ${m.resumo.categorias_com_ranking} categoria(s).
A API do Mercado Livre informa a posição no ranking, não a quantidade vendida. A prioridade é uma regra de triagem, não uma estimativa de demanda.
Os alertas de Anatel, Anvisa e Inmetro vêm de palavras-chave e precisam ser conferidos.</p>
${secoes || '<p>Nenhum produto encontrado.</p>'}
</main>
</body>
</html>
`;
}

/* ------------------------------------------------------------------ */
/* Mineracoes salvas                                                   */
/* ------------------------------------------------------------------ */

function salvarMineracao(m) {
  const id = `${carimbo(m.consultado_em)}-${m.categoria_raiz.id}`;
  const pasta = path.join(pastaMineracoes(), id);
  m.id = id;
  const indicadores = calcularIndicadores(m, mineracaoAnterior(m));
  gravar(path.join(pasta, 'mineracao.json'), JSON.stringify(m, null, 2));
  gravar(path.join(pasta, 'catalogo.html'), catalogoHtml(m));
  gravar(path.join(pasta, 'painel.html'), painelHtml(m, indicadores));
  return {
    id,
    pasta,
    painel: path.join(pasta, 'painel.html'),
    catalogo: path.join(pasta, 'catalogo.html'),
    dados: path.join(pasta, 'mineracao.json'),
    indicadores,
  };
}

// A mineracao mais recente da mesma categoria raiz, anterior a `m`.
function mineracaoAnterior(m) {
  const sufixo = `-${m.categoria_raiz.id}`;
  const id = listarMineracoes().find((x) => x.endsWith(sufixo) && x < m.id);
  if (!id) return null;
  try {
    return JSON.parse(fs.readFileSync(path.join(pastaMineracoes(), id, 'mineracao.json'), 'utf8'));
  } catch (_) {
    return null;
  }
}

// Recalcula os indicadores de uma mineracao ja gravada e regrava o painel.
function gerarPainel(m) {
  const indicadores = calcularIndicadores(m, mineracaoAnterior(m));
  const painel = path.join(pastaMineracoes(), m.id, 'painel.html');
  gravar(painel, painelHtml(m, indicadores));
  return { painel, indicadores };
}

function listarMineracoes() {
  const base = pastaMineracoes();
  if (!fs.existsSync(base)) return [];
  return fs.readdirSync(base, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(base, d.name, 'mineracao.json')))
    .map((d) => d.name)
    .sort()
    .reverse();
}

function carregarMineracao(id) {
  const ids = listarMineracoes();
  if (!ids.length) throw new ToolError('Ainda nao ha mineracao salva. Rode minerar_categoria primeiro.');
  const alvo = id === undefined || id === null || id === '' ? ids[0] : String(id).trim();
  // O id vira nome de pasta: so aceita o formato gerado por salvarMineracao.
  if (!/^\d{8}-\d{6}-MLB\d{1,12}$/.test(alvo) || !ids.includes(alvo)) {
    throw new ToolError(`mineracao_id nao encontrado: "${id}". Use listar_mineracoes para ver os disponiveis.`);
  }
  return JSON.parse(fs.readFileSync(path.join(pastaMineracoes(), alvo, 'mineracao.json'), 'utf8'));
}

function resumirMineracoes() {
  return listarMineracoes().slice(0, 30).map((id) => {
    try {
      const m = JSON.parse(fs.readFileSync(path.join(pastaMineracoes(), id, 'mineracao.json'), 'utf8'));
      return { id, categoria: m.categoria_raiz.caminho, consultado_em: m.consultado_em, produtos: m.resumo.produtos_detalhados };
    } catch (_) {
      return { id, erro: 'arquivo ilegivel' };
    }
  });
}

/* ------------------------------------------------------------------ */
/* Accio Work                                                          */
/* ------------------------------------------------------------------ */

function briefingAccio(m, produtos) {
  const linhas = [
    `# Pedido de sourcing: ${m.categoria_raiz.caminho}`,
    '',
    `Origem: mineração do Mercado Livre Brasil feita pela Conecta Hub em ${new Date(m.consultado_em).toLocaleDateString('pt-BR')}.`,
    'Os dados estruturados estão em `produtos.json`, nesta mesma pasta.',
    '',
    '## O que fazer',
    '',
    'Para cada produto abaixo, encontre fornecedores no Alibaba.com que fabriquem um item equivalente ao da foto e dos atributos.',
    'Monte a comparação com preço FOB, MOQ, prazo de produção, certificações e verificação do fornecedor.',
    'O preço de referência é o menor anúncio no Mercado Livre, em reais e já com impostos e frete; ele não é o preço alvo de compra.',
    '',
    '## Restrições',
    '',
    '- Não cotar item de marca registrada nem réplica; buscar produto sem marca ou com possibilidade de marca própria (OEM/ODM).',
    '- Os alertas regulatórios (Anatel, Anvisa, Inmetro) vieram de palavras-chave: pedir ao fornecedor os laudos e certificados correspondentes.',
    '- O Mercado Livre informa posição no ranking, não volume. Não estimar unidades vendidas a partir da posição.',
    '',
    '## Produtos',
    '',
  ];
  produtos.forEach((p, i) => {
    const an = p.anuncios || {};
    linhas.push(`### ${i + 1}. ${p.nome}`, '');
    if (p.foto) linhas.push(`![${p.nome.replace(/[\[\]]/g, '')}](${p.foto})`, '');
    linhas.push(`- Categoria no Mercado Livre: ${p.categoria}`);
    linhas.push(`- Posição no ranking da categoria: ${p.melhor_posicao}º`);
    if (an.menor_preco) linhas.push(`- Preço de referência no Brasil: ${preco(an.menor_preco.valor, an.menor_preco.moeda)} (${an.quantidade_anuncios} anúncio(s))`);
    if (p.tendencias_relacionadas.length) linhas.push(`- Termos em alta relacionados: ${p.tendencias_relacionadas.join(', ')}`);
    if (p.sinais.regulatorio.length) linhas.push(`- Alerta regulatório: ${p.sinais.regulatorio.map((r) => r.orgao).join(', ')}`);
    if (p.atributos && p.atributos.length) {
      linhas.push(`- Atributos: ${p.atributos.slice(0, 8).map((a) => `${a.nome}: ${a.valor}`).join('; ')}`);
    }
    linhas.push(`- Página no Mercado Livre: ${p.link}`);
    if (p.fotos) linhas.push(`- Outras fotos: ${p.fotos.slice(1).join(' , ')}`);
    linhas.push('');
  });
  return linhas.join('\n');
}

function enviarParaAccio(m, filtros) {
  const base = pastaAccio();
  if (!fs.existsSync(base)) {
    throw new ToolError(
      `A pasta do Accio Work nao existe: ${base}. Abra o Accio Work uma vez para ele cria-la, ` +
      'ou informe outra pasta no campo "Pasta do Accio Work" da configuracao da extensao.'
    );
  }
  const sel = selecionarParaAccio(m, filtros);
  if (!sel.produtos.length) {
    throw new ToolError(
      'Nenhum produto passou nos filtros para envio ao Accio Work ' +
      `(descartados: ${JSON.stringify(sel.descartados)}). ` +
      'Use incluir_marcas ou incluir_regulados para afrouxar, ou minere outra categoria.'
    );
  }
  const pasta = path.join(base, 'conecta-hub-mineracao', m.id);
  const pacote = {
    origem: 'Conecta Hub Sourcing',
    mineracao_id: m.id,
    categoria_raiz: m.categoria_raiz,
    consultado_em: m.consultado_em,
    filtros: {
      incluir_regulados: Boolean(filtros && filtros.incluir_regulados === true),
      incluir_marcas: Boolean(filtros && filtros.incluir_marcas === true),
    },
    produtos: sel.produtos,
  };
  gravar(path.join(pasta, 'produtos.json'), JSON.stringify(pacote, null, 2));
  gravar(path.join(pasta, 'briefing-sourcing.md'), briefingAccio(m, sel.produtos));
  gravar(path.join(pasta, 'catalogo.html'), catalogoHtml(m));
  return {
    pasta,
    arquivos: ['briefing-sourcing.md', 'produtos.json', 'catalogo.html'],
    produtos_enviados: sel.produtos.length,
    descartados: sel.descartados,
    acima_do_limite: sel.acima_do_limite,
    pedido_para_o_accio:
      `Abra a pasta ${pasta} como workspace e siga o arquivo briefing-sourcing.md: ` +
      'busque fornecedores no Alibaba para cada produto listado e monte a comparacao.',
  };
}

module.exports = {
  carregarMineracao,
  catalogoHtml,
  enviarParaAccio,
  gerarPainel,
  pastaAccio,
  pastaMineracoes,
  resumirMineracoes,
  salvarMineracao,
  selecionarParaAccio,
};
