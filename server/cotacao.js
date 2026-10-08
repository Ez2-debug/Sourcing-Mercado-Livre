'use strict';

/*
 * Cotacao em duas planilhas separadas, com os mesmos produtos na mesma ordem:
 *
 *   cotacao-<id>-mercado-livre.xlsx  o produto como esta no Mercado Livre
 *   cotacao-<id>-alibaba.xlsx        o candidato que o Accio achou no Alibaba
 *
 * As duas tem a coluna "#" e o codigo do produto (MLB...), que ligam uma
 * linha a outra. Os produtos sao os do pacote enviado ao Accio Work.
 */

const fs = require('node:fs');
const path = require('node:path');

const { ToolError, mapLimit } = require('./meli');
const { todosOsProdutos } = require('./mineracao');
const { dataParaExcel, ncmCurto } = require('./indicadores');
const { ESTILO, medirImagem, montarXlsx } = require('./xlsx');
const { baixarFoto, gravarPlanilha, pastaPlanilhas } = require('./planilha');
const { detalharPacote } = require('./accio');
const { pastaAccio } = require('./saida');

const LADO = 96;
const ALTURA = 76;

const COLUNAS_ML = [
  ['#', 5], ['Foto', 14], ['Código', 15], ['Produto no Mercado Livre', 58], ['Categoria', 38], ['Posição no ranking', 11],
  ['Menor preço (R$)', 13], ['Anúncios', 10], ['Vendedores', 11], ['Marca no anúncio', 20], ['NCM sugerida', 16],
  ['No catálogo desde', 13], ['Vendas estimadas (un.)', 12], ['Faturamento estimado (R$)', 14], ['Avaliações (qtd.)', 12],
  ['Nota (0 a 5)', 9], ['Fonte e período', 18], ['Link do produto', 46],
];

const COLUNAS_ALIBABA = [
  ['#', 5], ['Foto', 14], ['Código', 15], ['Produto no Mercado Livre', 46], ['NCM sugerida', 16], ['Descrição oficial da NCM', 44], ['Anúncio no Alibaba', 52], ['Fornecedor', 34],
  ['Preço do anúncio (US$)', 16], ['Preço mínimo (US$)', 12], ['Preço máximo (US$)', 12], ['MOQ do anúncio', 16], ['Local', 22],
  ['Aderência (Accio)', 11], ['Cruzamento', 18], ['Observação do Accio', 60], ['Link do anúncio', 46],
];

// "US$ 1.20-1.80", "$4.00 - 6.50" ou "US$ 2,99 – 6,45" viram { min, max }.
// Com um numero so, min e max sao iguais; sem numero, os dois ficam vazios.
function faixaDePreco(texto) {
  const numeros = (String(texto || '').match(/\d+(?:[.,]\d+)?/g) || [])
    .map((n) => Number(n.replace(',', '.')))
    .filter((n) => Number.isFinite(n));
  if (!numeros.length) return {};
  return { min: Math.min(...numeros.slice(0, 2)), max: Math.max(...numeros.slice(0, 2)) };
}

function ancorar(dados, linha) {
  const medida = dados && medirImagem(dados);
  if (!medida || !medida.largura || !medida.altura) return null;
  const escala = LADO / Math.max(medida.largura, medida.altura);
  const largura = Math.max(1, Math.round(medida.largura * escala));
  const altura = Math.max(1, Math.round(medida.altura * escala));
  return { linha, coluna: 1, dados, largura, altura, margemX: 2 + Math.round((LADO - largura) / 2), margemY: 2 + Math.round((LADO - altura) / 2) };
}

function cabecalho(colunas) {
  return { altura: 34, celulas: colunas.map(([titulo]) => ({ v: titulo, s: ESTILO.cabecalho })) };
}

function abaSobre(notas) {
  return { nome: 'Sobre', larguras: [28, 112], linhas: notas.map(([a, b]) => ({ celulas: [{ v: a, s: ESTILO.rotulo }, { v: b, s: ESTILO.nota }] })) };
}

function linhaMl(p, i) {
  const an = p.anuncios || {};
  const mp = an.menor_preco || {};
  const est = p.estimativa_externa;
  const t = ESTILO.texto;
  return {
    altura: ALTURA,
    celulas: [
      { v: i + 1, s: ESTILO.centro },
      { v: p.foto ? '' : 'sem foto', s: t },
      { v: p.id, s: t },
      { v: p.nome, s: p.link ? ESTILO.link : t, link: p.link },
      { v: p.categoria, s: t },
      { v: p.melhor_posicao, s: ESTILO.posicao },
      { v: mp.valor, s: ESTILO.dinheiro },
      { v: an.quantidade_anuncios, s: ESTILO.centro },
      { v: an.vendedores, s: ESTILO.centro },
      { v: p.marca || '', s: t },
      { v: ncmCurto(p) || '', s: t },
      { v: dataParaExcel(p.catalogo_desde), s: ESTILO.data },
      { v: est ? est.vendas : undefined, s: ESTILO.centro },
      { v: est ? est.faturamento : undefined, s: ESTILO.dinheiro },
      { v: est ? est.avaliacoes : undefined, s: ESTILO.centro },
      { v: est ? est.avaliacao : undefined, s: ESTILO.centro },
      { v: est ? `${est.fonte}, por ${est.periodo === 'mensal' ? 'mês' : 'semana'}` : '', s: t },
      { v: p.link || '', s: p.link ? ESTILO.link : t, link: p.link },
    ],
  };
}

// Descricao oficial do codigo sugerido ou, sem codigo de 8 digitos, da posicao.
function descricaoDaNcm(p) {
  if (!p.ncm) return '';
  const alvo = p.ncm.sugestoes.length ? p.ncm.sugestoes[0] : p.ncm.posicao[0];
  return (alvo && alvo.descricao) || '';
}

function linhaAlibaba(p, achado, i) {
  const c = achado.candidato || {};
  const faixa = faixaDePreco(c.preco);
  const t = ESTILO.texto;
  const cruzamento = !achado.candidato ? '' : (achado.cruzamento === 'codigo' ? 'Pelo código' : 'Por semelhança; conferir');
  return {
    altura: ALTURA,
    celulas: [
      { v: i + 1, s: ESTILO.centro },
      { v: '', s: t },
      { v: p.id, s: t },
      { v: p.nome, s: t },
      { v: ncmCurto(p) || '', s: t },
      { v: descricaoDaNcm(p), s: t },
      { v: c.titulo || 'Sem candidato', s: c.link ? ESTILO.link : ESTILO.marca, link: c.link },
      { v: c.fornecedor || '', s: t },
      { v: c.preco || '', s: t },
      { v: faixa.min, s: ESTILO.dinheiro },
      { v: faixa.max, s: ESTILO.dinheiro },
      { v: c.moq || '', s: t },
      { v: c.local || '', s: t },
      { v: c.aderencia || '', s: ESTILO.centro },
      { v: cruzamento, s: achado.cruzamento === 'semelhanca' ? ESTILO.marca : t },
      { v: c.motivo || '', s: t },
      { v: c.link || '', s: c.link ? ESTILO.link : t, link: c.link },
    ],
  };
}

async function planilhasDaCotacao(m, baixar) {
  const detalhe = detalharPacote(m.id);
  // O pacote guarda o produto como estava ao ser enviado; a mineracao tem a
  // versao atual, com as estimativas registradas depois.
  const atuais = new Map(todosOsProdutos(m).map((p) => [p.id, p]));
  let doPacote;
  try {
    doPacote = JSON.parse(fs.readFileSync(path.join(pastaAccio(), 'conecta-hub-mineracao', m.id, 'produtos.json'), 'utf8')).produtos;
  } catch (_) {
    throw new ToolError(`Nao consegui ler o pacote ${m.id} na pasta do Accio Work.`);
  }
  const produtos = doPacote.map((p) => atuais.get(p.id) || p);
  const achados = new Map(detalhe.linhas.map((l) => [l.produto.id, l]));
  const pegar = baixar || baixarFoto;

  const fotosMl = await mapLimit(produtos, 6, (p) => (p.foto ? pegar(p.foto) : null));
  const fotosAli = await mapLimit(produtos, 6, (p) => {
    const c = (achados.get(p.id) || {}).candidato;
    return c && c.foto ? pegar(c.foto) : null;
  });
  const imagens = (fotos) => fotos.map((dados, i) => ancorar(dados, i + 1)).filter(Boolean);

  const comCandidato = produtos.filter((p) => (achados.get(p.id) || {}).candidato).length;
  const titulo = `${produtos.length} produto(s) da mineração ${m.id} (${m.categoria_raiz.caminho}).`;
  const ligacao = 'As duas planilhas da cotação têm os mesmos produtos na mesma ordem. A coluna # e o código MLB ligam cada linha desta planilha à linha correspondente da outra.';

  const ml = montarXlsx([
    { nome: 'Mercado Livre', larguras: COLUNAS_ML.map(([, w]) => w), congelar: { colunas: 4, linhas: 1 }, filtro: true,
      linhas: [cabecalho(COLUNAS_ML), ...produtos.map(linhaMl)], imagens: imagens(fotosMl) },
    abaSobre([
      ['Conteúdo', `Como estão no Mercado Livre os ${titulo}`],
      ['Par desta planilha', ligacao],
      ['Posição no ranking', 'Posição no ranking de mais vendidos da categoria. A API informa a ordem, não a quantidade vendida.'],
      ['Menor preço', 'Anúncio mais barato do produto na mineração, em reais e já com impostos. Não é comparável direto com o preço do Alibaba.'],
      ['Vendas, faturamento, avaliações e nota', 'Só aparecem quando uma fonte externa foi registrada (por exemplo JoomPulse). São estimativas da fonte, não vendas reais nem dado do Mercado Livre. Avaliação não é venda.'],
      ['NCM sugerida', 'Ponto de partida para o despachante; não é classificação fiscal.'],
    ]),
  ]);
  const alibaba = montarXlsx([
    { nome: 'Alibaba', larguras: COLUNAS_ALIBABA.map(([, w]) => w), congelar: { colunas: 4, linhas: 1 }, filtro: true,
      linhas: [cabecalho(COLUNAS_ALIBABA), ...produtos.map((p, i) => linhaAlibaba(p, achados.get(p.id) || {}, i))], imagens: imagens(fotosAli) },
    abaSobre([
      ['Conteúdo', `Candidatos no Alibaba, levantados pelo Accio Work, para os ${titulo}`],
      ['Par desta planilha', ligacao],
      ['Origem', `${detalhe.arquivo}`],
      ['Preço do anúncio', 'Faixa publicada no anúncio do Alibaba, em dólares. Não é cotação FOB: frete, impostos e condições só saem com pedido de cotação ao fornecedor. Mínimo e máximo são lidos do texto do anúncio.'],
      ['NCM sugerida', 'Sugerida a partir da descrição do produto no Mercado Livre e da tabela oficial do Siscomex; vale para o equivalente importado. É ponto de partida para o despachante, não classificação fiscal, e não traz alíquota. Vazia quando o tipo de produto não está no dicionário.'],
      ['MOQ do anúncio', 'Quantidade mínima publicada, na unidade do anúncio (peças, jogos, metros).'],
      ['Aderência', 'Nota de 0 a 100 dada pelo Accio para a semelhança entre o candidato e o produto pedido.'],
      ['Cruzamento', 'Pelo código: a linha do candidato cita o código do produto. Por semelhança: escolhido pelas palavras em comum; precisa ser conferido.'],
      ['Sem candidato', `${produtos.length - comCandidato} produto(s) ficaram sem candidato.`],
      ['Candidatos sem produto', detalhe.candidatos_sem_produto.length ? detalhe.candidatos_sem_produto.map((c) => `${c.titulo} (${c.fornecedor})`).join('; ') : 'Nenhum.'],
    ]),
  ]);

  return {
    mineracao_id: m.id,
    mercado_livre: gravarPlanilha(path.join(pastaPlanilhas(), `cotacao-${m.id}-mercado-livre.xlsx`), ml),
    alibaba: gravarPlanilha(path.join(pastaPlanilhas(), `cotacao-${m.id}-alibaba.xlsx`), alibaba),
    produtos: produtos.length,
    com_candidato: comCandidato,
    sem_candidato: produtos.filter((p) => !(achados.get(p.id) || {}).candidato).map((p) => p.nome),
  };
}

module.exports = { faixaDePreco, planilhasDaCotacao };
