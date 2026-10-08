// Razao: os dados do site organizados em planilha, nos moldes das planilhas
// de cotacao. "Composto" junta Mercado Livre, Alibaba e Shopee em uma linha
// por produto; os demais trazem um marketplace por vez.
//
// Este arquivo so monta as tabelas (testavel sem navegador). Quem grava o
// .xlsx e o planilha.js.

export const TIPOS_DE_RAZAO = [
  ['composto', 'Composto', 'Uma linha por produto cotado, com Mercado Livre, Alibaba e Shopee lado a lado, mais uma aba completa de cada marketplace.'],
  ['mercado-livre', 'Mercado Livre', 'Os produtos minerados, com triagem, NCM sugerida e estimativas.'],
  ['shopee', 'Shopee', 'Os mais vendidos da última leitura, com preço, vendas estimadas e avaliações.'],
  ['alibaba', 'Alibaba', 'Os candidatos cotados pelo Accio Work para cada produto do Mercado Livre.'],
];

const SITUACOES = { apto: 'Apto para cotação', marca_registrada: 'Marca conhecida', regulado: 'Alerta regulatório', proibido: 'Proibido' };
const TENDENCIAS = { subindo: 'Subindo', caindo: 'Caindo', estavel: 'Estável' };

/* ------------------------------------------------------------------ */
/* Apoio                                                               */
/* ------------------------------------------------------------------ */

const link = (texto, url) => (texto && url ? { texto, link: url } : (texto || ''));

// "US$ 1.20-1.80" ou "US$ 2,99 – 6,45" viram { min, max }; sem numero, vazio.
export function faixaDePreco(texto) {
  const numeros = (String(texto || '').match(/\d+(?:[.,]\d+)?/g) || [])
    .map((n) => Number(n.replace(',', '.')))
    .filter((n) => Number.isFinite(n))
    .slice(0, 2);
  if (!numeros.length) return {};
  return { min: Math.min(...numeros), max: Math.max(...numeros) };
}

const VAZIAS = new Set(['para', 'com', 'sem', 'por', 'dos', 'das', 'uma', 'kit', 'novo', 'nova', 'cor', 'pecas', 'unidades', 'and', 'the', 'for', 'with']);

export function palavras(nome) {
  return new Set(String(nome || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !VAZIAS.has(w)));
}

// O item da Shopee mais parecido com o produto, pelo nome. So vale com pelo
// menos tres palavras em comum; e sempre "por semelhanca", para conferir.
export function parecidoNaShopee(nome, itens) {
  const alvo = palavras(nome);
  let melhor = null;
  for (const item of itens) {
    let comuns = 0;
    for (const w of palavras(item.nome)) if (alvo.has(w)) comuns += 1;
    if (comuns >= 3 && (!melhor || comuns > melhor.comuns)) melhor = { item, comuns };
  }
  return melhor ? melhor.item : null;
}

/* ------------------------------------------------------------------ */
/* Abas                                                                */
/* ------------------------------------------------------------------ */

function abaMercadoLivre(produtos) {
  return {
    nome: 'Mercado Livre',
    colunas: [
      ['Código', 15], ['Produto', 58], ['Categoria', 38], ['Posição no ranking', 11, 'inteiro'], ['Menor preço (R$)', 13, 'reais'],
      ['Situação na triagem', 20], ['NCM sugerida', 16], ['Prioridade', 11, 'inteiro'], ['Vendas estimadas (un.)', 12, 'inteiro'],
      ['Avaliações (qtd.)', 12, 'inteiro'], ['Nota (0 a 5)', 9], ['Fonte e período', 20], ['Link do produto', 46], ['Link da foto', 46],
    ],
    linhas: produtos.map((p) => [
      p.id, link(p.nome, p.link), p.categoria, p.posicao, p.menor_preco, SITUACOES[p.situacao] || p.situacao || '', p.ncm || '', p.prioridade,
      p.vendas_estimadas, p.avaliacoes, p.nota, p.fonte_da_estimativa || '', link(p.link, p.link), link(p.foto, p.foto),
    ]),
  };
}

function abaShopee(itens) {
  return {
    nome: 'Shopee',
    colunas: [
      ['Código', 15], ['Produto', 58], ['Categoria', 38], ['Marca', 18], ['Preço (R$)', 12, 'reais'], ['Vendas est. 30 dias (un.)', 13, 'inteiro'],
      ['Faturamento est. 30 dias (R$)', 15, 'reais'], ['Tendência', 11], ['Avaliações (qtd.)', 12, 'inteiro'], ['Nota (0 a 5)', 9],
      ['Vendidos no total', 12, 'inteiro'], ['Loja', 26], ['Local da loja', 18], ['Link do produto', 46], ['Link da foto', 46],
    ],
    linhas: itens.map((p) => [
      p.id, link(p.nome, p.link), p.categoria, p.marca || (p.tem_marca ? '' : 'Sem marca'), p.preco, p.vendas_30_dias, p.faturamento_30_dias,
      TENDENCIAS[p.tendencia] || '', p.avaliacoes, p.nota, p.vendidos_no_total, p.loja || '', p.local_da_loja || '', link(p.link, p.link), link(p.foto, p.foto),
    ]),
  };
}

const cruzamento = (l) => (!l.candidato ? '' : (l.cruzamento === 'codigo' ? 'Pelo código' : 'Por semelhança; conferir'));

function abaAlibaba(linhas, ncmPorProduto) {
  return {
    nome: 'Alibaba',
    colunas: [
      ['Código', 15], ['Produto no Mercado Livre', 46], ['NCM sugerida', 16], ['Anúncio no Alibaba', 52], ['Fornecedor', 34],
      ['Preço do anúncio (US$)', 16], ['Preço mínimo (US$)', 12, 'dolar'], ['Preço máximo (US$)', 12, 'dolar'], ['MOQ do anúncio', 16],
      ['Local', 22], ['Aderência (Accio)', 11], ['Cruzamento', 20], ['Observação do Accio', 60], ['Link do anúncio', 46], ['Categoria do pacote', 34],
    ],
    linhas: linhas.map((l) => {
      const c = l.candidato || {};
      const faixa = faixaDePreco(c.preco);
      return [
        l.produto.id, l.produto.nome, ncmPorProduto.get(l.produto.id) || '', c.titulo ? link(c.titulo, c.link) : 'Sem candidato', c.fornecedor || '',
        c.preco || '', faixa.min, faixa.max, c.moq || '', c.local || '', c.aderencia || '', cruzamento(l), c.motivo || '', link(c.link, c.link), l.categoria || '',
      ];
    }),
  };
}

function abaComposta(linhas, produtos, shopee) {
  const porId = new Map(produtos.map((p) => [p.id, p]));
  return {
    nome: 'Razão composto',
    colunas: [
      ['#', 5, 'inteiro'], ['Código', 15], ['Produto no Mercado Livre', 52], ['ML: menor preço (R$)', 13, 'reais'], ['ML: posição', 9, 'inteiro'],
      ['ML: vendas est. (un.)', 12, 'inteiro'], ['NCM sugerida', 16], ['Alibaba: anúncio', 46], ['Alibaba: fornecedor', 30],
      ['Alibaba: preço mín. (US$)', 13, 'dolar'], ['Alibaba: preço máx. (US$)', 13, 'dolar'], ['Alibaba: MOQ', 15], ['Alibaba: aderência', 10],
      ['Alibaba: cruzamento', 20], ['Shopee: produto parecido', 46], ['Shopee: preço (R$)', 12, 'reais'], ['Shopee: vendas est. 30 dias', 13, 'inteiro'],
      ['Shopee: cruzamento', 20],
    ],
    linhas: linhas.map((l, i) => {
      const ml = porId.get(l.produto.id) || {};
      const c = l.candidato || {};
      const faixa = faixaDePreco(c.preco);
      const s = parecidoNaShopee(l.produto.nome, shopee);
      return [
        i + 1, l.produto.id, link(l.produto.nome, l.produto.link), l.produto.menor_preco === undefined ? ml.menor_preco : l.produto.menor_preco,
        ml.posicao, ml.vendas_estimadas, ml.ncm || '', c.titulo ? link(c.titulo, c.link) : 'Sem candidato', c.fornecedor || '', faixa.min, faixa.max,
        c.moq || '', c.aderencia || '', cruzamento(l), s ? link(s.nome, s.link) : '', s ? s.preco : undefined, s ? s.vendas_30_dias : undefined,
        s ? 'Por semelhança; conferir' : '',
      ];
    }),
  };
}

function abaSobre(tipo, dados) {
  const notas = [
    ['Gerado em', new Date().toLocaleString('pt-BR')],
    ['Conteúdo', `${dados.produtos.length} produto(s) do Mercado Livre, ${dados.shopee.length} da Shopee e ${dados.linhas.length} linha(s) de cotação no Alibaba.`],
  ];
  if (tipo === 'composto') {
    notas.push(['Razão composto', 'Uma linha por produto do Mercado Livre que foi enviado para cotação. As abas seguintes trazem cada marketplace completo.']);
    notas.push(['Shopee no composto', 'A Shopee não tem ligação direta com o produto do Mercado Livre. A coluna traz o item da última leitura com pelo menos três palavras do nome em comum, quando existe; é aproximação e precisa ser conferida.']);
  }
  notas.push(
    ['Mercado Livre', 'A API informa posição no ranking, não quantidade vendida. Vendas, avaliações e nota são estimativas do JoomPulse, quando registradas.'],
    ['Shopee', 'Vendas e faturamento são estimativas do JoomPulse a partir do contador público arredondado da Shopee; não são vendas reais.'],
    ['Alibaba', 'Preço e MOQ são os do anúncio, em dólares. Não é cotação FOB: frete, impostos e condições só saem com pedido ao fornecedor. Não há conversão de moeda nesta planilha.'],
    ['NCM sugerida', 'Ponto de partida para o despachante; não é classificação fiscal e não traz alíquota.'],
    ['Fotos', 'A planilha gerada pelo site não embute fotos; a coluna Link da foto aponta para a imagem.'],
  );
  return { nome: 'Sobre', colunas: [['Assunto', 28], ['Explicação', 112]], linhas: notas, semFiltro: true };
}

/* ------------------------------------------------------------------ */
/* Montagem                                                            */
/* ------------------------------------------------------------------ */

// entrada: { produtos, shopee, cotacoes: [{ categoria, linhas }] }
export function montarRazao(tipo, entrada) {
  const produtos = entrada.produtos || [];
  const shopee = entrada.shopee || [];
  const linhas = (entrada.cotacoes || []).flatMap((c) => (c.linhas || []).map((l) => ({ ...l, categoria: c.categoria })));
  const ncm = new Map(produtos.filter((p) => p.ncm).map((p) => [p.id, p.ncm]));
  const dados = { produtos, shopee, linhas };
  const dia = new Date().toISOString().slice(0, 10);
  const rotulo = TIPOS_DE_RAZAO.find(([id]) => id === tipo);
  if (!rotulo) throw new Error(`tipo de razão desconhecido: ${tipo}`);
  let abas;
  if (tipo === 'composto') abas = [abaComposta(linhas, produtos, shopee), abaMercadoLivre(produtos), abaAlibaba(linhas, ncm), abaShopee(shopee)];
  else if (tipo === 'mercado-livre') abas = [abaMercadoLivre(produtos)];
  else if (tipo === 'shopee') abas = [abaShopee(shopee)];
  else abas = [abaAlibaba(linhas, ncm)];
  return {
    arquivo: `Razao ${rotulo[1]} ${dia}.xlsx`,
    abas: [...abas, abaSobre(tipo, dados)],
    linhas: abas[0].linhas.length,
  };
}
