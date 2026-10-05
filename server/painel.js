'use strict';

/*
 * Painel de indicadores de uma mineracao, em HTML sem dependencias.
 *
 * Os graficos sao barras horizontais de uma serie so, em um unico tom: cada
 * um mostra contagem (magnitude), entao nao ha cor por categoria. O valor vai
 * na ponta da barra e a tabela no fim da pagina repete todos os dados.
 */

const { esc, preco, url } = require('./html');

const ROTULOS_TRIAGEM = {
  apto: 'Aptos para cotação',
  marca_registrada: 'Marca registrada',
  regulado: 'Alerta regulatório',
  proibido: 'Proibidos',
  sem_detalhe: 'Sem detalhe da API',
};

function bloco(label, valor, nota) {
  return `<div class="tile"><div class="tile-label">${esc(label)}</div><div class="tile-valor">${esc(valor)}</div>${nota ? `<div class="tile-nota">${esc(nota)}</div>` : ''}</div>`;
}

function barras(titulo, subtitulo, linhas) {
  const max = Math.max(1, ...linhas.map((l) => l.valor));
  const corpo = linhas.map((l) => `<div class="linha" title="${esc(l.detalhe || l.rotulo)}: ${l.valor}">
    <div class="rotulo">${esc(l.rotulo)}</div>
    <div class="trilho"><div class="barra" style="width:${l.valor ? Math.max(1.5, (l.valor / max) * 100).toFixed(1) : 0}%"></div><span class="valor">${l.valor}</span></div>
  </div>`).join('\n');
  return `<figure class="cartao">
  <figcaption><h2>${esc(titulo)}</h2><p>${esc(subtitulo)}</p></figcaption>
  ${linhas.length ? corpo : '<p class="vazio">Sem dados.</p>'}
</figure>`;
}

function listaVariacao(titulo, icone, itens, descrever) {
  if (!itens.length) return '';
  return `<div class="mov"><h3><span aria-hidden="true">${icone}</span> ${esc(titulo)} (${itens.length})</h3><ul>${itens.slice(0, 8).map((i) =>
    `<li>${url(i.link) ? `<a href="${url(i.link)}" target="_blank" rel="noopener">${esc(i.nome)}</a>` : esc(i.nome)} <span class="suave">${esc(descrever(i))}</span></li>`).join('')}</ul></div>`;
}

function secaoVariacao(v) {
  if (!v) {
    return `<section class="cartao larga"><h2>Variação no ranking</h2>
<p class="suave">Esta é a primeira mineração desta categoria. A partir da próxima, o painel mostra quem subiu, quem desceu e quem entrou no ranking.</p></section>`;
  }
  const partes = [
    listaVariacao('Subiram', '▲', v.subiram, (i) => `${i.posicao_anterior}º → ${i.posicao}º`),
    listaVariacao('Entraram', '＋', v.novos, (i) => `${i.posicao}º`),
    listaVariacao('Desceram', '▼', v.desceram, (i) => `${i.posicao_anterior}º → ${i.posicao}º`),
    listaVariacao('Saíram', '−', v.sairam, (i) => `estava em ${i.posicao_anterior}º`),
  ].join('');
  return `<section class="cartao larga"><h2>Variação no ranking</h2>
<p class="suave">Comparado com a mineração de ${esc(new Date(v.consultado_em).toLocaleString('pt-BR'))}. ${v.mantiveram} produto(s) mantiveram a posição. “Saíram” deixaram o grupo dos mais bem colocados, não necessariamente o site.</p>
<div class="movs">${partes || '<p class="suave">Nenhuma mudança de posição.</p>'}</div></section>`;
}

function cartaoSugestao(s, i) {
  return `<article class="sug">
  ${url(s.foto) ? `<img loading="lazy" src="${url(s.foto)}" alt="">` : '<div class="semfoto">sem foto</div>'}
  <div>
    <div class="suave">${i + 1}ª sugestão · prioridade ${s.prioridade} · ${s.apto ? 'apto para cotação' : 'com ressalva'}</div>
    <h3><a href="${url(s.link)}" target="_blank" rel="noopener">${esc(s.nome)}</a></h3>
    <div class="suave">${esc(s.categoria)}${s.menor_preco !== undefined ? ` · a partir de ${preco(s.menor_preco)}` : ''}</div>
    <ul class="motivos">${s.motivos.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>
    ${s.ressalvas ? `<ul class="ressalvas">${s.ressalvas.map((r) => `<li><span aria-hidden="true">⚠</span> ${esc(r)}</li>`).join('')}</ul>` : ''}
  </div>
</article>`;
}

function tabelaProdutos(m) {
  const linhas = m.categorias.flatMap((c) => c.produtos).map((p) => {
    const an = p.anuncios || {};
    const alertas = ((p.sinais && p.sinais.regulatorio) || []).map((r) => r.orgao).join(', ');
    return `<tr><td>${esc(p.categoria)}</td><td>${url(p.link) ? `<a href="${url(p.link)}" target="_blank" rel="noopener">${esc(p.nome || p.id)}</a>` : esc(p.nome || p.id)}</td>
<td class="num">${p.melhor_posicao}º</td><td class="num">${an.menor_preco ? preco(an.menor_preco.valor, an.menor_preco.moeda) : ''}</td>
<td class="num">${an.quantidade_anuncios !== undefined ? an.quantidade_anuncios : ''}</td><td>${esc(p.marca || '')}</td><td>${esc(alertas)}</td><td class="num">${p.prioridade ? p.prioridade.pontos : ''}</td></tr>`;
  }).join('\n');
  return `<details class="cartao larga"><summary>Tabela com todos os produtos</summary>
<div class="rolagem"><table><thead><tr><th>Categoria</th><th>Produto</th><th class="num">Posição</th><th class="num">Menor preço</th><th class="num">Anúncios</th><th>Marca</th><th>Alertas</th><th class="num">Prioridade</th></tr></thead>
<tbody>${linhas}</tbody></table></div></details>`;
}

function painelHtml(m, ind) {
  const t = ind.totais;
  const triagem = Object.keys(ROTULOS_TRIAGEM).map((k) => ({ rotulo: ROTULOS_TRIAGEM[k], valor: ind.triagem[k] }));
  const faixa = t.menor_preco !== undefined ? `${preco(t.menor_preco)} a ${preco(t.maior_preco)}` : 'sem preço';
  const vendas = ind.vendas.registros_com_campo_de_venda;
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Indicadores · ${esc(m.categoria_raiz.nome)}</title>
<style>
  :root { color-scheme: light; --plano:#f9f9f7; --cartao:#fcfcfb; --tinta:#0b0b0b; --tinta2:#52514e; --suave:#898781; --grade:#e1e0d9; --borda:rgba(11,11,11,.10); --serie:#2a78d6; --trilho:#cde2fb; --link:#1c5cab; --alerta:#fab219; }
  @media (prefers-color-scheme: dark) { :root { color-scheme: dark; --plano:#0d0d0d; --cartao:#1a1a19; --tinta:#fff; --tinta2:#c3c2b7; --suave:#898781; --grade:#2c2c2a; --borda:rgba(255,255,255,.10); --serie:#3987e5; --trilho:#0d366b; --link:#86b6ef; } }
  * { box-sizing:border-box; }
  body { margin:0; padding:16px; background:var(--plano); color:var(--tinta); font:15px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width:1180px; margin:0 auto; }
  h1 { font-size:22px; margin:0 0 4px; }
  h2 { font-size:16px; margin:0; } h3 { font-size:14px; margin:0 0 4px; font-weight:600; }
  a { color:var(--link); text-decoration:none; } a:hover { text-decoration:underline; }
  .suave, figcaption p { color:var(--tinta2); font-size:13px; margin:2px 0 0; }
  .topo { margin-bottom:16px; }
  .tiles { display:grid; grid-template-columns:repeat(auto-fit, minmax(160px, 1fr)); gap:12px; margin-bottom:12px; }
  .tile, .cartao { background:var(--cartao); border:1px solid var(--borda); border-radius:8px; padding:14px 16px; }
  .tile-label { color:var(--tinta2); font-size:13px; } .tile-valor { font-size:28px; font-weight:600; line-height:1.2; } .tile-nota { color:var(--suave); font-size:12px; }
  .grade { display:grid; grid-template-columns:repeat(auto-fit, minmax(420px, 1fr)); gap:12px; margin-bottom:12px; }
  .cartao { margin:0; } .larga { margin-bottom:12px; }
  figcaption { margin-bottom:12px; }
  .linha { display:grid; grid-template-columns:minmax(90px, 34%) 1fr; gap:8px; align-items:center; padding:3px 0; }
  .linha:hover .barra { filter:brightness(1.15); }
  .rotulo { font-size:13px; color:var(--tinta2); overflow-wrap:anywhere; }
  .trilho { display:flex; align-items:center; gap:6px; border-left:1px solid var(--grade); min-height:20px; }
  .barra { height:16px; background:var(--serie); border-radius:0 4px 4px 0; }
  .valor { font-size:13px; font-variant-numeric:tabular-nums; color:var(--tinta); }
  .vazio { color:var(--suave); }
  .movs { display:grid; grid-template-columns:repeat(auto-fit, minmax(250px, 1fr)); gap:16px; margin-top:12px; }
  .mov ul, .motivos, .ressalvas { margin:0; padding-left:18px; font-size:13px; }
  .sugs { display:grid; grid-template-columns:repeat(auto-fit, minmax(330px, 1fr)); gap:12px; margin-top:12px; }
  .sug { display:grid; grid-template-columns:96px 1fr; gap:12px; border:1px solid var(--borda); border-radius:8px; padding:10px; }
  .sug img, .semfoto { width:96px; height:96px; object-fit:contain; background:#fff; border-radius:6px; }
  .semfoto { display:flex; align-items:center; justify-content:center; color:#999; font-size:12px; }
  .motivos { margin-top:6px; } .ressalvas { list-style:none; padding-left:0; margin-top:6px; color:var(--tinta2); }
  summary { cursor:pointer; font-weight:600; }
  .rolagem { overflow-x:auto; margin-top:12px; }
  table { border-collapse:collapse; width:100%; font-size:13px; }
  th, td { text-align:left; padding:6px 8px; border-bottom:1px solid var(--grade); vertical-align:top; }
  th { color:var(--tinta2); font-weight:600; } .num { text-align:right; font-variant-numeric:tabular-nums; white-space:nowrap; }
</style>
</head>
<body>
<main>
<div class="topo">
  <h1>Indicadores · ${esc(ind.categoria)}</h1>
  <p class="suave">Mineração ${esc(m.id)} · consulta de ${esc(new Date(m.consultado_em).toLocaleString('pt-BR'))} · <a href="catalogo.html">abrir o catálogo com fotos</a></p>
</div>

<div class="tiles">
  ${bloco('Produtos minerados', t.produtos, `em ${t.categorias_com_produto} categoria(s)`)}
  ${bloco('Aptos para cotação', t.aptos_para_cotacao, 'sem marca e sem alerta')}
  ${bloco('Sem marca registrada', t.sem_marca_registrada)}
  ${bloco('Batem com termo em alta', t.em_alta)}
  ${bloco('Faixa de menor preço', faixa)}
</div>

<div class="grade">
  ${barras('Triagem para cotação', 'Produtos por situação', triagem)}
  ${barras('Produtos por categoria', 'Quantidade detalhada em cada categoria', ind.produtos_por_categoria)}
  ${barras('Menor preço no Brasil', 'Produtos por faixa do anúncio mais barato', ind.faixas_de_preco)}
  ${barras('Concorrência', 'Produtos por quantidade de anúncios', ind.concorrencia)}
</div>

<section class="cartao larga">
  <h2>Sugestões de produto</h2>
  <p class="suave">Ordem de análise pela regra de prioridade. Não é previsão de venda.</p>
  <div class="sugs">${ind.sugestoes.length ? ind.sugestoes.map(cartaoSugestao).join('\n') : '<p class="suave">Nenhum produto com detalhe suficiente para sugerir.</p>'}</div>
</section>

${secaoVariacao(ind.variacao)}

<section class="cartao larga">
  <h2>Dados de venda</h2>
  ${vendas.length
    ? `<p class="suave">Campos de venda exatamente como a API devolveu.</p><ul>${vendas.map((v) => `<li>${esc(v.nome || v.id)}: ${esc(JSON.stringify(v.campos))}</li>`).join('')}</ul>`
    : '<p class="suave">A API do Mercado Livre não devolveu quantidade vendida para nenhum produto desta mineração. Com o token desta aplicação, os recursos de anúncio e de busca respondem “acesso negado”, e os produtos de catálogo não trazem esse campo. O sinal de demanda disponível é a posição no ranking de mais vendidos e a sua variação entre minerações.</p>'}
</section>

${tabelaProdutos(m)}
</main>
</body>
</html>
`;
}

module.exports = { painelHtml };
