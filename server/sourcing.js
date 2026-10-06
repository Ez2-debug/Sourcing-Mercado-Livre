'use strict';

/*
 * Planilha do sourcing feito pelo Accio Work.
 *
 * O Accio grava o resultado da busca em sourcing-plans/<plano>/sourcing.md,
 * com uma tabela de candidatos do Alibaba. Este modulo le essa tabela, cruza
 * cada candidato com o produto minerado e monta um Excel com os dois lados.
 *
 * O Accio nem sempre diz qual candidato responde a qual produto. Quando o
 * codigo do produto (MLB...) aparece na linha do candidato, o cruzamento e
 * exato; senao e feito pelas palavras em comum e sai marcado para conferencia.
 */

const fs = require('node:fs');
const path = require('node:path');

const { ToolError, mapLimit } = require('./meli');
const { ncmCurto, selecionarParaAccio } = require('./indicadores');
const { ESTILO, medirImagem, montarXlsx } = require('./xlsx');
const { baixarFoto, gravarPlanilha, pastaPlanilhas } = require('./planilha');
const { pastaAccio } = require('./saida');

const LADO = 96;
const VAZIAS = new Set(['para', 'com', 'sem', 'dos', 'das', 'por', 'kit', 'cor', 'de', 'do', 'da', 'em', 'e', 'o', 'a', 'que', 'mas', 'nao', 'anuncio', 'preco', 'moq', 'fob', 'prazo', 'confirme', 'atende', 'correspondencia']);

function norm(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function palavras(s) {
  return new Set(norm(s).split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !VAZIAS.has(w))
    .map((w) => (w.length > 3 ? w.replace(/(oes|aes)$/, 'ao').replace(/s$/, '') : w)));
}

// Linhas da tabela "Selected Candidates" do sourcing.md:
// | # | ![](foto) | [titulo](link) | fornecedor | preco / MOQ | local | aderencia | motivo |
function lerSourcingMd(texto) {
  const candidatos = [];
  for (const linha of String(texto).split(/\r?\n/)) {
    const cel = linha.split('|').map((c) => c.trim());
    if (cel.length < 9 || !/^\d+$/.test(cel[1])) continue;
    const foto = (cel[2].match(/!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/) || [])[1];
    const produto = cel[3].match(/\[(.*)\]\((https?:\/\/[^)\s]+)\)/);
    if (!produto) continue;
    const [preco, moq] = cel[5].split(' / ');
    candidatos.push({
      numero: Number(cel[1]),
      foto,
      titulo: produto[1],
      link: produto[2],
      fornecedor: cel[4],
      preco: (preco || '').trim(),
      moq: (moq || '').trim(),
      local: cel[6],
      aderencia: cel[7],
      motivo: cel.slice(8, -1).join(' | '),
    });
  }
  return candidatos;
}

// Cada candidato responde a no maximo um produto. Primeiro os que citam o
// codigo do produto; depois, do par com mais palavras em comum para o menor.
function cruzar(produtos, candidatos) {
  const par = new Map(); // produto.id -> { candidato, exato }
  const usados = new Set();
  for (const c of candidatos) {
    const texto = `${c.titulo} ${c.motivo}`.toUpperCase();
    const p = produtos.find((x) => !par.has(x.id) && texto.includes(x.id));
    if (p) { par.set(p.id, { candidato: c, exato: true }); usados.add(c); }
  }
  // O Accio percorre o briefing em ordem, entao a posicao do candidato na
  // tabela desempata produtos quase iguais (duas mangueiras, tres torneiras).
  const pares = [];
  produtos.forEach((p, i) => {
    if (par.has(p.id)) return;
    const doProduto = palavras(p.nome);
    candidatos.forEach((c, j) => {
      if (usados.has(c)) return;
      const doCandidato = palavras(`${c.titulo} ${c.motivo}`);
      let comuns = 0;
      for (const w of doProduto) if (doCandidato.has(w)) comuns += 1;
      const distancia = Math.abs(i - j);
      if (comuns >= 2 || (comuns >= 1 && distancia <= 1)) pares.push({ p, c, pontos: comuns - 0.5 * distancia });
    });
  });
  pares.sort((a, b) => b.pontos - a.pontos);
  for (const { p, c } of pares) {
    if (par.has(p.id) || usados.has(c)) continue;
    par.set(p.id, { candidato: c, exato: false });
    usados.add(c);
  }
  return { par, sobraram: candidatos.filter((c) => !usados.has(c)) };
}

// Procura o sourcing.md do pacote: na pasta informada, na pasta do pacote
// ou, por ultimo, no plano mais recente do Accio gravado depois da mineracao.
function localizarSourcing(m, pasta) {
  const base = path.resolve(pastaAccio());
  const dentro = (p) => {
    const r = path.resolve(p);
    return r === base || r.startsWith(base + path.sep);
  };
  const achar = (raiz, profundidade) => {
    const achados = [];
    const andar = (dir, n) => {
      let itens;
      try { itens = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
      for (const it of itens) {
        const alvo = path.join(dir, it.name);
        if (it.isDirectory() && n < profundidade && it.name !== 'node_modules') andar(alvo, n + 1);
        else if (it.isFile() && it.name === 'sourcing.md') achados.push({ arquivo: alvo, quando: fs.statSync(alvo).mtimeMs });
      }
    };
    andar(raiz, 0);
    return achados.sort((a, b) => b.quando - a.quando);
  };
  if (pasta) {
    if (!dentro(pasta)) throw new ToolError(`A pasta precisa estar dentro da pasta do Accio Work (${base}).`);
    const r = achar(pasta, 3);
    if (!r.length) throw new ToolError(`Nao achei nenhum sourcing.md em ${pasta}.`);
    return r[0].arquivo;
  }
  const doPacote = achar(path.join(base, 'conecta-hub-mineracao', m.id), 3);
  if (doPacote.length) return doPacote[0].arquivo;
  const depois = Date.parse(m.consultado_em);
  const recentes = achar(base, 4).filter((x) => x.quando >= depois);
  if (!recentes.length) {
    throw new ToolError(
      `O Accio Work ainda nao gravou resultado de sourcing depois da mineracao ${m.id}. ` +
      'Rode o pedido do briefing no Accio e tente de novo, ou informe a pasta do plano em "pasta".'
    );
  }
  return recentes[0].arquivo;
}

const COLUNAS = [
  ['#', 5], ['Foto Mercado Livre', 14], ['Produto no Mercado Livre', 46], ['Menor preço no Brasil (R$)', 13],
  ['Posição no ranking', 10], ['NCM sugerida', 15], ['Foto Alibaba', 14], ['Candidato no Alibaba', 46],
  ['Fornecedor', 34], ['Preço do anúncio (US$)', 14], ['MOQ do anúncio', 16], ['Local', 15],
  ['Aderência (Accio)', 11], ['Cruzamento', 16], ['Observação do Accio', 60], ['Link Mercado Livre', 40], ['Link Alibaba', 40],
];

function ancorar(dados, linha, coluna) {
  const medida = dados && medirImagem(dados);
  if (!medida || !medida.largura || !medida.altura) return null;
  const escala = LADO / Math.max(medida.largura, medida.altura);
  const largura = Math.max(1, Math.round(medida.largura * escala));
  const altura = Math.max(1, Math.round(medida.altura * escala));
  return { linha, coluna, dados, largura, altura, margemX: 2 + Math.round((LADO - largura) / 2), margemY: 2 + Math.round((LADO - altura) / 2) };
}

async function planilhaDoSourcing(m, pasta, baixar) {
  const arquivoMd = localizarSourcing(m, pasta);
  const candidatos = lerSourcingMd(fs.readFileSync(arquivoMd, 'utf8'));
  if (!candidatos.length) throw new ToolError(`Nao consegui ler candidatos em ${arquivoMd}; o formato da tabela mudou.`);
  // Os mesmos produtos, na mesma ordem, do pacote enviado ao Accio. Sem o
  // pacote em disco, refaz a selecao padrao.
  let produtos;
  try {
    produtos = JSON.parse(fs.readFileSync(path.join(pastaAccio(), 'conecta-hub-mineracao', m.id, 'produtos.json'), 'utf8')).produtos;
  } catch (_) {
    produtos = selecionarParaAccio(m, {}).produtos;
  }
  const { par, sobraram } = cruzar(produtos, candidatos);
  const pegar = baixar || baixarFoto;
  const fotosMl = await mapLimit(produtos, 6, (p) => (p.foto ? pegar(p.foto) : null));
  const fotosAli = await mapLimit(produtos, 6, (p) => (par.has(p.id) && par.get(p.id).candidato.foto ? pegar(par.get(p.id).candidato.foto) : null));

  const t = ESTILO.texto;
  const imagens = [];
  const linhas = produtos.map((p, i) => {
    const achado = par.get(p.id);
    const c = achado ? achado.candidato : {};
    const an = p.anuncios || {};
    for (const [dados, col] of [[fotosMl[i], 1], [fotosAli[i], 6]]) {
      const im = ancorar(dados, i + 1, col);
      if (im) imagens.push(im);
    }
    return {
      altura: 76,
      celulas: [
        { v: i + 1, s: ESTILO.centro },
        { v: '', s: t },
        { v: p.nome, s: ESTILO.link, link: p.link },
        { v: an.menor_preco ? an.menor_preco.valor : undefined, s: ESTILO.dinheiro },
        { v: p.melhor_posicao, s: ESTILO.posicao },
        { v: ncmCurto(p) || '', s: t },
        { v: '', s: t },
        { v: c.titulo || 'Sem candidato', s: c.link ? ESTILO.link : ESTILO.marca, link: c.link },
        { v: c.fornecedor || '', s: t },
        { v: (c.preco || '').replace(/\$/g, ''), s: t },
        { v: c.moq || '', s: t },
        { v: c.local || '', s: ESTILO.centro },
        { v: c.aderencia || '', s: ESTILO.centro },
        { v: achado ? (achado.exato ? 'Pelo código' : 'Por semelhança; conferir') : '', s: achado && !achado.exato ? ESTILO.marca : t },
        { v: c.motivo || '', s: t },
        { v: p.link || '', s: p.link ? ESTILO.link : t, link: p.link },
        { v: c.link || '', s: c.link ? ESTILO.link : t, link: c.link },
      ],
    };
  });
  const notas = [
    ['Conteúdo', `Sourcing feito pelo Accio Work para ${produtos.length} produto(s) da mineração ${m.id} (${m.categoria_raiz.caminho}).`],
    ['Origem dos dados do Alibaba', `${arquivoMd} — ${candidatos.length} candidato(s) lido(s).`],
    ['Cruzamento', 'Pelo código: a linha do candidato cita o código do produto. Por semelhança: escolhido pelas palavras em comum entre o produto e o candidato; precisa ser conferido.'],
    ['Candidatos sem produto', sobraram.length ? sobraram.map((c) => `${c.titulo} (${c.fornecedor})`).join('; ') : 'Nenhum.'],
    ['Preço do anúncio', 'Faixa publicada no anúncio do Alibaba, em dólares. Não é cotação FOB: frete, impostos e condições só saem com pedido de cotação.'],
    ['MOQ do anúncio', 'Quantidade mínima publicada, na unidade do anúncio (peças, jogos, metros).'],
    ['Menor preço no Brasil', 'Anúncio mais barato do produto no Mercado Livre na mineração, em reais e já com impostos. Não é comparável direto com o preço do Alibaba.'],
    ['Aderência', 'Nota de 0 a 100 dada pelo Accio para a semelhança entre o candidato e o produto pedido.'],
    ['NCM sugerida', 'Ponto de partida para o despachante; não é classificação fiscal.'],
  ];
  const buffer = montarXlsx([
    {
      nome: 'Sourcing',
      larguras: COLUNAS.map(([, w]) => w),
      congelar: { colunas: 3, linhas: 1 },
      filtro: true,
      linhas: [{ altura: 34, celulas: COLUNAS.map(([titulo]) => ({ v: titulo, s: ESTILO.cabecalho })) }, ...linhas],
      imagens,
    },
    { nome: 'Sobre', larguras: [28, 112], linhas: notas.map(([a, b]) => ({ celulas: [{ v: a, s: ESTILO.rotulo }, { v: b, s: ESTILO.nota }] })) },
  ]);
  const arquivo = gravarPlanilha(path.join(pastaPlanilhas(), `sourcing-${m.id}.xlsx`), buffer);
  return {
    arquivo,
    mineracao_id: m.id,
    resultado_do_accio: arquivoMd,
    produtos: produtos.length,
    candidatos: candidatos.length,
    cruzados_pelo_codigo: Array.from(par.values()).filter((x) => x.exato).length,
    cruzados_por_semelhanca: Array.from(par.values()).filter((x) => !x.exato).length,
    produtos_sem_candidato: produtos.filter((p) => !par.has(p.id)).map((p) => p.nome),
    candidatos_sem_produto: sobraram.map((c) => c.titulo),
  };
}

module.exports = { cruzar, lerSourcingMd, planilhaDoSourcing };
