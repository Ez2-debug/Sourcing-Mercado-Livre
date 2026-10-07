'use strict';

/*
 * Pagina da central de mineracao (minerador.js).
 *
 * E uma pagina fixa: os dados chegam por /api/estado e sao escritos no DOM com
 * textContent, de modo que nomes de categoria e de produto nunca viram HTML.
 */

function centralHtml() {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Conecta Hub Sourcing</title>
<style>
  :root { color-scheme: light; --plano:#f9f9f7; --cartao:#fcfcfb; --tinta:#0b0b0b; --tinta2:#52514e; --suave:#898781; --grade:#e1e0d9; --borda:rgba(11,11,11,.10); --serie:#2a78d6; --trilho:#cde2fb; --link:#1c5cab; --ok:#1f8a4c; --okfundo:#dff3e6; --alerta:#9a6700; --alertafundo:#fdf0cf; --erro:#b3261e; --errofundo:#fbe3e1; }
  @media (prefers-color-scheme: dark) { :root { color-scheme: dark; --plano:#0d0d0d; --cartao:#1a1a19; --tinta:#fff; --tinta2:#c3c2b7; --suave:#898781; --grade:#2c2c2a; --borda:rgba(255,255,255,.10); --serie:#3987e5; --trilho:#0d366b; --link:#86b6ef; --ok:#5fcf8c; --okfundo:#12331f; --alerta:#f2c25b; --alertafundo:#3a2c08; --erro:#f2877f; --errofundo:#3d1512; } }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--plano); color:var(--tinta); font:15px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; }
  header { border-bottom:1px solid var(--borda); background:var(--cartao); }
  .faixa { max-width:1180px; margin:0 auto; padding:12px 16px; display:flex; align-items:center; gap:12px; flex-wrap:wrap; }
  .marca { display:flex; align-items:center; gap:10px; font-weight:650; font-size:17px; margin-right:auto; }
  .logo { width:28px; height:28px; border-radius:7px; background:var(--serie); display:grid; place-items:center; color:#fff; font-size:15px; font-weight:700; }
  .marca small { display:block; font-weight:400; font-size:12px; color:var(--tinta2); }
  main { max-width:1180px; margin:0 auto; padding:16px; }
  h2 { font-size:16px; margin:0 0 2px; }
  a { color:var(--link); text-decoration:none; } a:hover { text-decoration:underline; }
  .suave { color:var(--tinta2); font-size:13px; margin:0; }
  button { font:inherit; font-size:14px; padding:7px 14px; border-radius:7px; border:1px solid var(--borda); background:var(--cartao); color:var(--tinta); cursor:pointer; }
  button.principal { background:var(--serie); border-color:var(--serie); color:#fff; }
  button:disabled { opacity:.5; cursor:default; }
  .pilula { display:inline-flex; align-items:center; gap:7px; padding:4px 11px; border-radius:999px; font-size:13px; font-weight:600; background:var(--okfundo); color:var(--ok); }
  .pilula.pausado { background:var(--alertafundo); color:var(--alerta); }
  .pilula.erro { background:var(--errofundo); color:var(--erro); }
  .ponto { width:8px; height:8px; border-radius:50%; background:currentColor; }
  .minerando .ponto { animation:pulso 1.2s ease-in-out infinite; }
  @keyframes pulso { 50% { opacity:.25; transform:scale(.7); } }
  .cartao { background:var(--cartao); border:1px solid var(--borda); border-radius:8px; padding:14px 16px; margin-bottom:12px; }
  .agora { display:grid; grid-template-columns:1fr auto; gap:6px 16px; align-items:center; }
  .agora-titulo { font-size:20px; font-weight:600; overflow-wrap:anywhere; }
  .agora-rotulo { color:var(--tinta2); font-size:13px; }
  .relogio { font-size:28px; font-weight:600; font-variant-numeric:tabular-nums; text-align:right; }
  .progresso { grid-column:1 / -1; height:6px; border-radius:3px; background:var(--trilho); overflow:hidden; }
  .progresso i { display:block; height:100%; width:0; background:var(--serie); border-radius:3px; }
  .minerando .progresso i { width:35%; animation:corre 1.6s linear infinite; }
  @keyframes corre { from { margin-left:-35%; } to { margin-left:100%; } }
  @media (prefers-reduced-motion: reduce) { .minerando .progresso i, .minerando .ponto { animation:none; } .minerando .progresso i { width:100%; } }
  .aviso { background:var(--errofundo); color:var(--erro); border-radius:8px; padding:10px 14px; margin-bottom:12px; font-size:14px; overflow-wrap:anywhere; }
  .tiles { display:grid; grid-template-columns:repeat(auto-fit, minmax(160px, 1fr)); gap:12px; margin-bottom:12px; }
  .tile { background:var(--cartao); border:1px solid var(--borda); border-radius:8px; padding:14px 16px; }
  .tile-label { color:var(--tinta2); font-size:13px; } .tile-valor { font-size:28px; font-weight:600; line-height:1.2; font-variant-numeric:tabular-nums; } .tile-nota { color:var(--suave); font-size:12px; }
  .colunas { display:grid; grid-template-columns:repeat(auto-fit, minmax(min(100%, 440px), 1fr)); gap:12px; }
  .sugs { display:grid; gap:10px; margin-top:12px; }
  .sug { display:grid; grid-template-columns:64px 1fr; gap:12px; align-items:center; }
  .sug img, .semfoto { width:64px; height:64px; object-fit:contain; background:#fff; border-radius:6px; border:1px solid var(--borda); }
  .semfoto { display:grid; place-items:center; color:#999; font-size:11px; }
  .sug-nome { font-weight:600; font-size:14px; overflow-wrap:anywhere; }
  .rolagem { overflow-x:auto; margin-top:12px; }
  table { border-collapse:collapse; width:100%; font-size:13px; }
  th, td { text-align:left; padding:6px 8px; border-bottom:1px solid var(--grade); vertical-align:top; }
  th { color:var(--tinta2); font-weight:600; white-space:nowrap; } .num { text-align:right; font-variant-numeric:tabular-nums; white-space:nowrap; }
  tr.atual td { background:var(--trilho); }
  .falha { color:var(--erro); }
  nav { max-width:1180px; margin:0 auto; padding:0 16px; display:flex; gap:4px; }
  nav button { border:0; border-bottom:2px solid transparent; border-radius:0; background:none; padding:9px 12px; color:var(--tinta2); font-weight:600; }
  nav button[aria-selected="true"] { color:var(--tinta); border-bottom-color:var(--serie); }
  .barra-alta { display:flex; align-items:center; gap:12px; flex-wrap:wrap; margin-bottom:12px; }
  .barra-alta h2 { margin-right:auto; }
  .periodos { display:inline-flex; border:1px solid var(--borda); border-radius:7px; overflow:hidden; }
  .periodos button { border:0; border-radius:0; background:var(--cartao); }
  .periodos button[aria-pressed="true"] { background:var(--serie); color:#fff; }
  .grade-alta { display:grid; grid-template-columns:repeat(auto-fill, minmax(min(100%, 250px), 1fr)); gap:12px; margin:12px 0 20px; }
  .produto { background:var(--cartao); border:1px solid var(--borda); border-radius:8px; padding:12px; display:flex; flex-direction:column; gap:8px; }
  .produto img, .produto .semfoto { width:100%; height:150px; object-fit:contain; background:#fff; border-radius:6px; border:1px solid var(--borda); }
  .produto-nome { font-weight:600; font-size:14px; overflow-wrap:anywhere; }
  .selo { align-self:flex-start; padding:3px 9px; border-radius:999px; font-size:12px; font-weight:650; background:var(--okfundo); color:var(--ok); font-variant-numeric:tabular-nums; }
  .selo.novo { background:var(--trilho); color:var(--link); }
  .produto .preco { font-size:17px; font-weight:600; font-variant-numeric:tabular-nums; }
  .produto button { margin-top:auto; }
  .produto a.botao { margin-top:auto; text-align:center; font-size:14px; padding:7px 14px; border-radius:7px; background:var(--serie); color:#fff; }
  .produto a.botao:hover { text-decoration:none; filter:brightness(1.1); }
  .vazio { color:var(--suave); font-size:13px; margin:12px 0 0; }
  footer { max-width:1180px; margin:0 auto; padding:4px 16px 24px; color:var(--suave); font-size:12px; }
</style>
</head>
<body>
<header>
  <div class="faixa">
    <div class="marca"><span class="logo">C</span><span>Conecta Hub Sourcing<small>Central de mineração · Mercado Livre Brasil</small></span></div>
    <span id="pilula" class="pilula"><span class="ponto"></span><span id="pilula-texto">Conectando</span></span>
    <button id="pausar">Pausar</button>
    <button id="agora" class="principal">Minerar agora</button>
  </div>
  <nav role="tablist">
    <button id="aba-mineracao" role="tab" aria-selected="true">Mineração</button>
    <button id="aba-alta" role="tab" aria-selected="false">Em alta</button>
  </nav>
</header>
<main id="tela-alta" hidden>
  <div class="barra-alta">
    <h2>Produtos em alta</h2>
    <span class="periodos"><button id="p7" aria-pressed="true">7 dias</button><button id="p30" aria-pressed="false">30 dias</button></span>
  </div>
  <p id="alta-resumo" class="suave">&nbsp;</p>
  <h2 id="alta-subindo-titulo" style="margin-top:16px">Subindo no ranking</h2>
  <div id="alta-subindo" class="grade-alta"></div>
  <h2>Entraram entre os mais bem colocados</h2>
  <div id="alta-entraram" class="grade-alta"></div>
</main>
<main id="tela-mineracao">
  <div id="aviso" class="aviso" hidden></div>
  <section id="cartao-agora" class="cartao agora">
    <div>
      <div id="agora-rotulo" class="agora-rotulo">&nbsp;</div>
      <div id="agora-titulo" class="agora-titulo">&nbsp;</div>
    </div>
    <div>
      <div id="relogio-rotulo" class="agora-rotulo" style="text-align:right">&nbsp;</div>
      <div id="relogio" class="relogio">--:--</div>
    </div>
    <div class="progresso"><i></i></div>
  </section>
  <section class="tiles">
    <div class="tile"><div class="tile-label">Categorias mineradas hoje</div><div id="t-categorias" class="tile-valor">0</div><div id="t-categorias-nota" class="tile-nota">&nbsp;</div></div>
    <div class="tile"><div class="tile-label">Produtos lidos hoje</div><div id="t-produtos" class="tile-valor">0</div><div class="tile-nota">com detalhe de catálogo</div></div>
    <div class="tile"><div class="tile-label">Aptos para cotação</div><div id="t-aptos" class="tile-valor">0</div><div class="tile-nota">sem marca conhecida nem alerta</div></div>
    <div class="tile"><div class="tile-label">Ciclo da fila</div><div id="t-ciclo" class="tile-valor">0</div><div id="t-ciclo-nota" class="tile-nota">&nbsp;</div></div>
  </section>
  <div class="colunas">
    <section class="cartao">
      <h2>Sugestões de hoje</h2>
      <p class="suave">Produtos aptos com maior prioridade de triagem. A prioridade é regra de triagem, não medida de demanda.</p>
      <div id="sugs" class="sugs"></div>
    </section>
    <section class="cartao">
      <h2>Atividade recente</h2>
      <p class="suave">Últimas execuções do minerador neste computador.</p>
      <div class="rolagem"><table><thead><tr><th>Horário</th><th>Categoria</th><th class="num">Produtos</th><th class="num">Aptos</th><th>Abrir</th></tr></thead><tbody id="historico"></tbody></table></div>
      <p id="planilha" class="vazio"></p>
    </section>
  </div>
  <section class="cartao">
    <h2>Fila de categorias</h2>
    <p class="suave">Na ordem em que serão mineradas: primeiro as que nunca foram, depois as que estão há mais tempo paradas.</p>
    <div class="rolagem"><table><thead><tr><th class="num">#</th><th>Categoria</th><th>Origem</th><th>Última mineração</th></tr></thead><tbody id="fila"></tbody></table></div>
  </section>
</main>
<footer>A API do Mercado Livre informa posição no ranking, não quantidade vendida. Os alertas regulatórios vêm de palavras-chave e precisam ser conferidos pela NCM.</footer>
<script>
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var estado = null;
  var falhas = 0;

  function el(tag, texto, classe) {
    var e = document.createElement(tag);
    if (texto !== undefined && texto !== null) e.textContent = String(texto);
    if (classe) e.className = classe;
    return e;
  }
  function link(texto, href) {
    var a = el('a', texto);
    a.href = href; a.target = '_blank'; a.rel = 'noopener';
    return a;
  }
  function hora(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    var hoje = new Date().toDateString() === d.toDateString();
    var h = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    return hoje ? h : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' ' + h;
  }
  function duracao(ms) {
    var s = Math.max(0, Math.round(ms / 1000));
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
    var dois = function (n) { return (n < 10 ? '0' : '') + n; };
    return (h ? h + ':' + dois(m) : dois(m)) + ':' + dois(r);
  }
  // Id da mineracao (AAAAMMDD-HHMMSS-MLBxxx) para data legivel.
  function dataDoId(id) {
    if (!id) return 'nunca';
    return id.slice(6, 8) + '/' + id.slice(4, 6) + ' ' + id.slice(9, 11) + ':' + id.slice(11, 13);
  }
  function preco(v) {
    return typeof v === 'number' ? v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '';
  }
  function fotoSegura(u) {
    return typeof u === 'string' && /^https:\\/\\/[a-z0-9.-]+\\.mlstatic\\.com\\//i.test(u) ? u : null;
  }
  function linkSeguro(u) {
    return typeof u === 'string' && /^https:\\/\\//i.test(u) ? u : null;
  }

  function relogio() {
    if (!estado) return;
    var agora = Date.now();
    if (estado.situacao === 'minerando' && estado.atual) {
      $('relogio').textContent = duracao(agora - new Date(estado.atual.iniciado_em).getTime());
    } else if (estado.situacao === 'aguardando' && estado.proxima_em) {
      $('relogio').textContent = duracao(new Date(estado.proxima_em).getTime() - agora);
    } else {
      $('relogio').textContent = '--:--';
    }
  }

  function desenhar() {
    var e = estado;
    var minerando = e.situacao === 'minerando';
    var textos = { minerando: 'Minerando', aguardando: 'Ativo', pausado: 'Pausado', erro: 'Com erro' };
    $('pilula').className = 'pilula ' + e.situacao;
    $('pilula-texto').textContent = textos[e.situacao] || e.situacao;
    $('cartao-agora').className = 'cartao agora ' + e.situacao;
    $('pausar').textContent = e.pausado ? 'Retomar' : 'Pausar';
    $('agora').disabled = minerando;

    var proxima = e.fila.length ? e.fila[0] : null;
    if (minerando && e.atual) {
      $('agora-rotulo').textContent = 'Minerando agora';
      $('agora-titulo').textContent = e.atual.caminho;
      $('relogio-rotulo').textContent = 'Tempo decorrido';
    } else if (e.pausado) {
      $('agora-rotulo').textContent = 'Mineração pausada · próxima da fila';
      $('agora-titulo').textContent = proxima ? proxima.caminho : 'Fila vazia';
      $('relogio-rotulo').textContent = '\\u00a0';
    } else {
      $('agora-rotulo').textContent = 'Próxima categoria';
      $('agora-titulo').textContent = proxima ? proxima.caminho : 'Fila vazia';
      $('relogio-rotulo').textContent = 'Começa em';
    }

    var aviso = $('aviso');
    if (e.problema) { aviso.hidden = false; aviso.textContent = e.problema; } else { aviso.hidden = true; }

    $('t-categorias').textContent = e.hoje.categorias;
    $('t-categorias-nota').textContent = 'a cada ' + e.intervalo_min + ' min';
    $('t-produtos').textContent = e.hoje.produtos;
    $('t-aptos').textContent = e.hoje.aptos;
    var feitas = e.fila.filter(function (c) { return c.ultima_mineracao; }).length;
    $('t-ciclo').textContent = feitas + ' / ' + e.fila.length;
    $('t-ciclo-nota').textContent = 'categorias já mineradas ao menos uma vez';

    var sugs = $('sugs');
    sugs.replaceChildren();
    if (!e.hoje.sugestoes.length) sugs.appendChild(el('p', 'Ainda não há produto apto minerado hoje.', 'vazio'));
    e.hoje.sugestoes.forEach(function (s) {
      var linha = el('div', null, 'sug');
      var foto = fotoSegura(s.foto);
      if (foto) { var img = el('img'); img.src = foto; img.alt = ''; img.loading = 'lazy'; linha.appendChild(img); }
      else linha.appendChild(el('div', 'sem foto', 'semfoto'));
      var corpo = el('div');
      var nome = el('div', null, 'sug-nome');
      var href = linkSeguro(s.link);
      nome.appendChild(href ? link(s.nome, href) : el('span', s.nome));
      corpo.appendChild(nome);
      var partes = [s.categoria, preco(s.menor_preco), 'prioridade ' + s.prioridade];
      if (s.ncm) partes.push('NCM sugerida ' + s.ncm);
      corpo.appendChild(el('p', partes.filter(Boolean).join(' · '), 'suave'));
      linha.appendChild(corpo);
      sugs.appendChild(linha);
    });

    var hist = $('historico');
    hist.replaceChildren();
    if (!e.historico.length) {
      var vazio = el('tr'); var td = el('td', 'Nenhuma execução ainda.', 'vazio'); td.colSpan = 5; vazio.appendChild(td); hist.appendChild(vazio);
    }
    e.historico.slice(0, 12).forEach(function (h) {
      var tr = el('tr');
      tr.appendChild(el('td', hora(h.fim)));
      tr.appendChild(el('td', h.categoria));
      if (h.erro) {
        var erro = el('td', h.erro, 'falha'); erro.colSpan = 3; tr.appendChild(erro);
      } else {
        tr.appendChild(el('td', h.produtos, 'num'));
        tr.appendChild(el('td', h.aptos, 'num'));
        var abrir = el('td');
        abrir.appendChild(link('painel', '/mineracao/' + encodeURIComponent(h.mineracao_id) + '/painel.html'));
        abrir.appendChild(document.createTextNode(' · '));
        abrir.appendChild(link('catálogo', '/mineracao/' + encodeURIComponent(h.mineracao_id) + '/catalogo.html'));
        tr.appendChild(abrir);
      }
      hist.appendChild(tr);
    });
    $('planilha').textContent = e.hoje.planilha ? 'Planilha do dia: ' + e.hoje.planilha : '';

    var fila = $('fila');
    fila.replaceChildren();
    e.fila.forEach(function (c, i) {
      var tr = el('tr');
      if (minerando && e.atual && e.atual.id === c.id) tr.className = 'atual';
      tr.appendChild(el('td', i + 1, 'num'));
      tr.appendChild(el('td', c.caminho));
      tr.appendChild(el('td', c.origem || ''));
      tr.appendChild(el('td', dataDoId(c.ultima_mineracao)));
      fila.appendChild(tr);
    });
    relogio();
  }

  function buscar() {
    fetch('/api/estado', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (e) { estado = e; falhas = 0; desenhar(); })
      .catch(function () {
        falhas += 1;
        if (falhas < 2) return;
        $('pilula').className = 'pilula erro';
        $('pilula-texto').textContent = 'Minerador desligado';
        $('cartao-agora').className = 'cartao agora';
      });
  }
  function comando(nome) {
    fetch('/api/' + nome, { method: 'POST', headers: { 'X-Conecta-Hub': '1' } }).then(buscar, buscar);
  }
  $('pausar').addEventListener('click', function () { comando(estado && estado.pausado ? 'retomar' : 'pausar'); });
  $('agora').addEventListener('click', function () { comando('minerar-agora'); });

  /* ---- Em alta ---- */
  var dias = 7;

  function dia(iso) {
    return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  }
  function textoDoPedido(p) {
    return 'Quero cotar a importação deste produto: ' + p.nome + ' (' + p.id + ')' + (p.link ? ' ' + p.link : '');
  }
  function cartaoDeProduto(p, cotacao) {
    var c = el('article', null, 'produto');
    var foto = fotoSegura(p.foto);
    if (foto) { var img = el('img'); img.src = foto; img.alt = ''; img.loading = 'lazy'; c.appendChild(img); }
    else c.appendChild(el('div', 'sem foto', 'semfoto'));
    c.appendChild(p.subiu
      ? el('span', '▲ ' + p.subiu + ' · ' + p.posicao_anterior + 'º → ' + p.posicao + 'º', 'selo')
      : el('span', 'Entrou em ' + p.posicao + 'º', 'selo novo'));
    var nome = el('div', null, 'produto-nome');
    var href = linkSeguro(p.link);
    nome.appendChild(href ? link(p.nome, href) : el('span', p.nome));
    c.appendChild(nome);
    if (typeof p.menor_preco === 'number') c.appendChild(el('div', preco(p.menor_preco), 'preco'));
    var partes = [p.categoria, p.ncm ? 'NCM sugerida ' + p.ncm : '', 'comparado com ' + dia(p.comparado_com)];
    c.appendChild(el('p', partes.filter(Boolean).join(' · '), 'suave'));
    if (cotacao) {
      var a = link('Cotar importação', cotacao.replace('{pedido}', encodeURIComponent(textoDoPedido(p))));
      a.className = 'botao';
      c.appendChild(a);
    } else {
      var b = el('button', 'Copiar pedido de cotação');
      b.addEventListener('click', function () {
        navigator.clipboard.writeText(textoDoPedido(p)).then(function () {
          b.textContent = 'Copiado';
          setTimeout(function () { b.textContent = 'Copiar pedido de cotação'; }, 1500);
        });
      });
      c.appendChild(b);
    }
    return c;
  }
  function desenharAlta(a) {
    var cotacao = linkSeguro(a.cotacao_url);
    var resumo;
    if (!a.categorias_comparadas) {
      resumo = 'Ainda não há duas minerações da mesma categoria para comparar. O histórico começa a aparecer no segundo ciclo da fila.';
    } else {
      resumo = a.categorias_comparadas + ' categorias comparadas · ' + a.total_subindo + ' produtos aptos subiram · ' + a.total_entraram + ' entraram.';
      if (a.menor_periodo_em_dias !== null && a.menor_periodo_em_dias < a.dias_pedidos) {
        resumo += ' O histórico ainda é mais curto que ' + a.dias_pedidos + ' dias: há categoria comparada com ' +
          a.menor_periodo_em_dias.toLocaleString('pt-BR') + ' dia(s) atrás. A data de comparação aparece em cada produto.';
      }
      if (a.categorias_sem_historico) resumo += ' ' + a.categorias_sem_historico + ' categorias ainda têm uma mineração só.';
    }
    $('alta-resumo').textContent = resumo;
    [['alta-subindo', a.subindo, 'Nenhum produto apto subiu no período.'], ['alta-entraram', a.entraram, 'Nenhum produto apto entrou no período.']].forEach(function (g) {
      var caixa = $(g[0]);
      caixa.replaceChildren();
      if (!g[1].length) caixa.appendChild(el('p', g[2], 'vazio'));
      g[1].forEach(function (p) { caixa.appendChild(cartaoDeProduto(p, cotacao)); });
    });
  }
  function buscarAlta() {
    fetch('/api/em-alta?dias=' + dias, { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(desenharAlta)
      .catch(function () { $('alta-resumo').textContent = 'Não consegui ler o histórico. O minerador está ligado?'; });
  }
  function periodo(n) {
    dias = n;
    $('p7').setAttribute('aria-pressed', String(n === 7));
    $('p30').setAttribute('aria-pressed', String(n === 30));
    buscarAlta();
  }
  $('p7').addEventListener('click', function () { periodo(7); });
  $('p30').addEventListener('click', function () { periodo(30); });

  function aba(nome) {
    var alta = nome === 'alta';
    $('tela-alta').hidden = !alta;
    $('tela-mineracao').hidden = alta;
    $('aba-alta').setAttribute('aria-selected', String(alta));
    $('aba-mineracao').setAttribute('aria-selected', String(!alta));
    if (alta) buscarAlta();
  }
  $('aba-mineracao').addEventListener('click', function () { aba('mineracao'); });
  $('aba-alta').addEventListener('click', function () { aba('alta'); });

  buscar();
  setInterval(buscar, 5000);
  setInterval(relogio, 1000);
})();
</script>
</body>
</html>`;
}

module.exports = { centralHtml };
