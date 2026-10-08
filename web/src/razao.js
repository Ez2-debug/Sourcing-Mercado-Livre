// Razao: os dados do site organizados em planilha. "Composto" junta Mercado
// Livre, Alibaba e Shopee em uma linha por produto e traz um painel com
// premissas editaveis e formulas; os demais trazem um marketplace por vez.
//
// Este arquivo so descreve as abas (testavel sem navegador). Quem grava o
// .xlsx e o livro.js. Uma celula pode ser um valor, { texto, link } ou
// { formula }.

export const TIPOS_DE_RAZAO = [
  ['composto', 'Composto', 'Painel com premissas e fórmulas, uma linha por produto cotado com Mercado Livre, Alibaba e Shopee lado a lado, e uma aba completa de cada marketplace.'],
  ['mercado-livre', 'Mercado Livre', 'Os produtos minerados, com triagem, NCM sugerida e estimativas.'],
  ['shopee', 'Shopee', 'Os mais vendidos da última leitura, com preço, vendas estimadas e avaliações.'],
  ['alibaba', 'Alibaba', 'Os candidatos cotados pelo Accio Work para cada produto do Mercado Livre.'],
];

const SITUACOES = { apto: 'Apto para cotação', marca_registrada: 'Marca conhecida', regulado: 'Alerta regulatório', proibido: 'Proibido' };
const TENDENCIAS = { subindo: 'Subindo', caindo: 'Caindo', estavel: 'Estável' };
export const DECISOES = ['Cotar', 'Aguardar', 'Descartar'];

/* ------------------------------------------------------------------ */
/* Apoio                                                               */
/* ------------------------------------------------------------------ */

const link = (texto, url) => (texto && url ? { texto, link: url } : (texto || ''));
const numero = (v) => { const n = Number(v); return v !== '' && v !== null && v !== undefined && Number.isFinite(n) ? n : undefined; };

// Letra da coluna do Excel para um indice a partir de zero (0 = A, 26 = AA).
export function letra(i) {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

// "US$ 1.20-1.80" ou "US$ 2,99 – 6,45" viram { min, max }; sem numero, vazio.
export function faixaDePreco(texto) {
  const numeros = (String(texto || '').match(/\d+(?:[.,]\d+)?/g) || [])
    .map((n) => Number(n.replace(',', '.')))
    .filter((n) => Number.isFinite(n))
    .slice(0, 2);
  if (!numeros.length) return {};
  return { min: Math.min(...numeros), max: Math.max(...numeros) };
}

// "500 pieces" vira 500; sem numero, vazio.
export function quantidadeDoMoq(texto) {
  const m = String(texto || '').replace(/[.,](?=\d{3}\b)/g, '').match(/\d+/);
  return m ? Number(m[0]) : undefined;
}

const VAZIAS = new Set(['para', 'com', 'sem', 'por', 'dos', 'das', 'uma', 'kit', 'novo', 'nova', 'cor', 'pecas', 'unidades', 'and', 'the', 'for', 'with', 'metros', 'varias', 'cores']);

export function palavras(nome) {
  return String(nome || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !VAZIAS.has(w));
}

// O item da Shopee mais parecido com o produto, pelo nome. Vale com tres
// palavras em comum, ou com duas quando uma delas e a primeira palavra do
// produto (o tipo: "cortina", "mangueira"). E sempre "por semelhanca".
export function parecidoNaShopee(nome, itens) {
  const alvo = palavras(nome);
  const conjunto = new Set(alvo);
  let melhor = null;
  for (const item of itens) {
    const doItem = new Set(palavras(item.nome));
    let comuns = 0;
    for (const w of doItem) if (conjunto.has(w)) comuns += 1;
    const serve = comuns >= 3 || (comuns >= 2 && alvo.length > 0 && doItem.has(alvo[0]));
    if (!serve) continue;
    const vendas = item.vendas_30_dias || 0;
    if (!melhor || comuns > melhor.comuns || (comuns === melhor.comuns && vendas > melhor.vendas)) melhor = { item, comuns, vendas };
  }
  return melhor ? melhor.item : null;
}

/* ------------------------------------------------------------------ */
/* Abas de um marketplace                                              */
/* ------------------------------------------------------------------ */

function abaMercadoLivre(produtos) {
  return {
    nome: 'Mercado Livre',
    congelar: 2,
    colunas: [
      ['Código', 15], ['Produto', 58], ['Categoria', 38], ['Posição no ranking', 11, 'inteiro'], ['Menor preço (R$)', 13, 'reais'],
      ['Situação na triagem', 20], ['NCM sugerida', 16], ['Prioridade', 11, 'inteiro'], ['Vendas estimadas (un.)', 12, 'inteiro'],
      ['Avaliações (qtd.)', 12, 'inteiro'], ['Nota (0 a 5)', 9], ['Fonte e período', 20], ['Link do produto', 46], ['Link da foto', 46],
    ],
    linhas: produtos.map((p) => [
      p.id, link(p.nome, p.link), p.categoria, p.posicao, p.menor_preco, SITUACOES[p.situacao] || p.situacao || '', p.ncm || '', p.prioridade,
      p.vendas_estimadas, p.avaliacoes, p.nota, p.fonte_da_estimativa || '', link(p.link, p.link), link(p.foto, p.foto),
    ]),
    formatacoes: [{ coluna: 7, tipo: 'barra' }, { coluna: 5, tipo: 'texto', texto: 'Apto', tom: 'verde' }],
  };
}

function abaShopee(itens) {
  return {
    nome: 'Shopee',
    congelar: 2,
    colunas: [
      ['Código', 15], ['Produto', 58], ['Categoria', 38], ['Marca', 18], ['Preço (R$)', 12, 'reais'], ['Vendas est. 30 dias (un.)', 13, 'inteiro'],
      ['Faturamento est. 30 dias (R$)', 15, 'reais'], ['Tendência', 11], ['Avaliações (qtd.)', 12, 'inteiro'], ['Nota (0 a 5)', 9],
      ['Vendidos no total', 12, 'inteiro'], ['Loja', 26], ['Local da loja', 18], ['Link do produto', 46], ['Link da foto', 46],
    ],
    linhas: itens.map((p) => [
      p.id, link(p.nome, p.link), p.categoria, p.marca || (p.tem_marca ? '' : 'Sem marca'), p.preco, p.vendas_30_dias, p.faturamento_30_dias,
      TENDENCIAS[p.tendencia] || '', p.avaliacoes, p.nota, p.vendidos_no_total, p.loja || '', p.local_da_loja || '', link(p.link, p.link), link(p.foto, p.foto),
    ]),
    formatacoes: [{ coluna: 5, tipo: 'barra' }, { coluna: 7, tipo: 'texto', texto: 'Subindo', tom: 'verde' }, { coluna: 7, tipo: 'texto', texto: 'Caindo', tom: 'vermelho' }],
  };
}

const cruzamento = (l) => (!l.candidato ? '' : (l.cruzamento === 'codigo' ? 'Pelo código' : 'Por semelhança; conferir'));
const emReais = (usd, cambio) => (typeof usd === 'number' && cambio && cambio.venda > 0 ? Math.round(usd * cambio.venda * 100) / 100 : undefined);

function abaAlibaba(linhas, ncmPorProduto, cambio) {
  return {
    nome: 'Alibaba',
    congelar: 2,
    colunas: [
      ['Código', 15], ['Produto no Mercado Livre', 46], ['NCM sugerida', 16], ['Anúncio no Alibaba', 52], ['Fornecedor', 34],
      ['Preço do anúncio (US$)', 16], ['Preço mínimo (US$)', 12, 'dolar'], ['Preço máximo (US$)', 12, 'dolar'], ['Preço mínimo (R$, PTAX)', 13, 'reais'],
      ['MOQ do anúncio', 16], ['MOQ (quantidade)', 11, 'inteiro'], ['Local', 22], ['Aderência (Accio)', 11, 'inteiro'], ['Cruzamento', 20],
      ['Observação do Accio', 60], ['Link do anúncio', 46], ['Categoria do pacote', 34],
    ],
    linhas: linhas.map((l) => {
      const c = l.candidato || {};
      const faixa = faixaDePreco(c.preco);
      return [
        l.produto.id, l.produto.nome, l.produto.ncm || ncmPorProduto.get(l.produto.id) || '', c.titulo ? link(c.titulo, c.link) : 'Sem candidato', c.fornecedor || '',
        c.preco || '', faixa.min, faixa.max, emReais(faixa.min, cambio), c.moq || '', quantidadeDoMoq(c.moq), c.local || '', numero(c.aderencia), cruzamento(l),
        c.motivo || '', link(c.link, c.link), l.categoria || '',
      ];
    }),
    formatacoes: [{ coluna: 12, tipo: 'barra' }, { coluna: 3, tipo: 'texto', texto: 'Sem candidato', tom: 'vermelho' }, { coluna: 13, tipo: 'texto', texto: 'semelhança', tom: 'amarelo' }],
  };
}

/* ------------------------------------------------------------------ */
/* Razao composto e painel                                             */
/* ------------------------------------------------------------------ */

// Colunas do composto, por nome, para as formulas nao dependerem de posicao.
const COMPOSTO = [
  ['num', '#', 5, 'inteiro'], ['codigo', 'Código', 15], ['produto', 'Produto no Mercado Livre', 50], ['categoria', 'Categoria', 30],
  ['mlPreco', 'ML: menor preço (R$)', 13, 'reais'], ['mlPosicao', 'ML: posição', 9, 'inteiro'], ['mlVendas', 'ML: vendas est. (un.)', 12, 'inteiro'],
  ['ncm', 'NCM sugerida', 16], ['anuncio', 'Alibaba: anúncio', 44], ['fornecedor', 'Alibaba: fornecedor', 30],
  ['usdMin', 'Alibaba: preço mín. (US$)', 13, 'dolar'], ['usdMax', 'Alibaba: preço máx. (US$)', 13, 'dolar'], ['moqTexto', 'Alibaba: MOQ', 14],
  ['moq', 'MOQ (quantidade)', 11, 'inteiro'], ['aderencia', 'Alibaba: aderência', 10, 'inteiro'], ['cruzamento', 'Alibaba: cruzamento', 18],
  ['custo', 'Custo estimado un. (R$)', 13, 'reais'], ['margem', 'Margem bruta un. (R$)', 13, 'reais'], ['margemPct', 'Margem bruta (%)', 11, 'percentual'],
  ['investimento', 'Investimento no MOQ (R$)', 15, 'reais'], ['shopee', 'Shopee: produto parecido', 44], ['shopeePreco', 'Shopee: preço (R$)', 12, 'reais'],
  ['shopeeVendas', 'Shopee: vendas est. 30 dias', 13, 'inteiro'], ['diferenca', 'ML menos Shopee (R$)', 13, 'reais'], ['decisao', 'Decisão', 13], ['observacoes', 'Observações', 36],
];
const COL = Object.fromEntries(COMPOSTO.map(([id], i) => [id, letra(i)]));
const INDICE = Object.fromEntries(COMPOSTO.map(([id], i) => [id, i]));

// Celulas de premissa no painel (coluna C).
const PREMISSA = { dolar: 'Painel!$C$5', adicionais: 'Painel!$C$6', comissao: 'Painel!$C$7' };

function abaComposta(linhas, produtos, shopee, cambio) {
  const porId = new Map(produtos.map((p) => [p.id, p]));
  const dados = linhas.map((l, i) => {
    const r = i + 2;
    const ml = { ...(porId.get(l.produto.id) || {}), ...Object.fromEntries(Object.entries(l.produto).filter(([, v]) => v !== undefined && v !== null)) };
    const c = l.candidato || {};
    const faixa = faixaDePreco(c.preco);
    const s = parecidoNaShopee(l.produto.nome, shopee);
    const celula = {
      num: i + 1,
      codigo: l.produto.id,
      produto: link(l.produto.nome, l.produto.link),
      categoria: ml.categoria || l.categoria || '',
      mlPreco: ml.menor_preco,
      mlPosicao: ml.posicao,
      mlVendas: ml.vendas_estimadas,
      ncm: ml.ncm || '',
      anuncio: c.titulo ? link(c.titulo, c.link) : 'Sem candidato',
      fornecedor: c.fornecedor || '',
      usdMin: faixa.min,
      usdMax: faixa.max,
      moqTexto: c.moq || '',
      moq: quantidadeDoMoq(c.moq),
      aderencia: numero(c.aderencia),
      cruzamento: cruzamento(l),
      // As quatro contas seguem as premissas do painel: mudar la recalcula aqui.
      custo: { formula: `IF(${COL.usdMin}${r}="","",${COL.usdMin}${r}*${PREMISSA.dolar}*(1+${PREMISSA.adicionais}))` },
      margem: { formula: `IF(OR(${COL.mlPreco}${r}="",${COL.custo}${r}=""),"",${COL.mlPreco}${r}*(1-${PREMISSA.comissao})-${COL.custo}${r})` },
      margemPct: { formula: `IF(OR(${COL.margem}${r}="",${COL.mlPreco}${r}=0),"",${COL.margem}${r}/${COL.mlPreco}${r})` },
      investimento: { formula: `IF(OR(${COL.custo}${r}="",${COL.moq}${r}=""),"",${COL.custo}${r}*${COL.moq}${r})` },
      shopee: s ? link(s.nome, s.link) : '',
      shopeePreco: s ? s.preco : undefined,
      shopeeVendas: s ? s.vendas_30_dias : undefined,
      diferenca: { formula: `IF(OR(${COL.mlPreco}${r}="",${COL.shopeePreco}${r}=""),"",${COL.mlPreco}${r}-${COL.shopeePreco}${r})` },
      decisao: '',
      observacoes: '',
    };
    return COMPOSTO.map(([id]) => celula[id]);
  });
  return {
    nome: 'Razão composto',
    congelar: 3,
    colunas: COMPOSTO.map(([, titulo, largura, formato]) => [titulo, largura, formato]),
    linhas: dados,
    formatacoes: [
      { coluna: INDICE.margemPct, tipo: 'escala' },
      { coluna: INDICE.aderencia, tipo: 'barra' },
      { coluna: INDICE.anuncio, tipo: 'texto', texto: 'Sem candidato', tom: 'vermelho' },
      { coluna: INDICE.cruzamento, tipo: 'texto', texto: 'semelhança', tom: 'amarelo' },
      { coluna: INDICE.decisao, tipo: 'texto', texto: 'Cotar', tom: 'verde' },
      { coluna: INDICE.decisao, tipo: 'texto', texto: 'Descartar', tom: 'vermelho' },
    ],
    listas: [{ coluna: INDICE.decisao, opcoes: DECISOES }],
    entradas: [INDICE.decisao, INDICE.observacoes],
  };
}

function abaPainel(quantas, cambio) {
  const ultima = Math.max(2, quantas + 1);
  const faixa = (id) => `'Razão composto'!$${COL[id]}$2:$${COL[id]}$${ultima}`;
  const titulo = (t) => [{ v: t, estilo: 'secao' }];
  const linha = (rotulo, valor, formato, nota) => ['', { v: rotulo, estilo: 'rotulo' }, { ...valor, formato }, { v: nota || '', estilo: 'nota' }];
  const f = (formula) => ({ formula });
  return {
    nome: 'Painel',
    livre: true,
    larguras: [3, 46, 18, 86],
    linhas: [
      [{ v: 'Razão composto — Conecta Market Sourcing', estilo: 'titulo' }],
      [{ v: `Gerado em ${new Date().toLocaleString('pt-BR')}. As células amarelas são suas: altere e a planilha recalcula.`, estilo: 'nota' }],
      [],
      titulo('Premissas'),
      linha('Dólar (R$)', { v: cambio && cambio.venda > 0 ? cambio.venda : 0, estilo: 'entrada' }, 'cambio',
        cambio && cambio.venda > 0 ? `${cambio.fonte}, cotação de ${cambio.cotado_em}. Troque pelo câmbio que quiser simular.` : 'Sem cotação disponível ao gerar: preencha o dólar.'),
      linha('Custos adicionais sobre o preço do anúncio (%)', { v: 0, estilo: 'entrada' }, 'percentual',
        'Frete, seguro, impostos e despesas de importação, como percentual do preço do fornecedor. Começa em zero de propósito: preencha com o número do seu despachante.'),
      linha('Comissão e taxas do marketplace (%)', { v: 0, estilo: 'entrada' }, 'percentual',
        'Percentual do preço de venda que fica com o marketplace. Começa em zero: preencha com a taxa do seu anúncio.'),
      [],
      titulo('Resumo'),
      linha('Produtos no razão', f(`COUNTA(${faixa('codigo')})`), 'inteiro'),
      linha('Com fornecedor no Alibaba', f(`COUNT(${faixa('usdMin')})`), 'inteiro'),
      linha('Sem candidato', f(`COUNTIF(${faixa('anuncio')},"Sem candidato")`), 'inteiro'),
      linha('Com produto parecido na Shopee', f(`COUNT(${faixa('shopeePreco')})`), 'inteiro', 'A Shopee entra por semelhança de nome; confira cada par.'),
      linha('Aderência média (Accio)', f(`IFERROR(AVERAGE(${faixa('aderencia')}),"")`), 'decimal', 'Nota de 0 a 100 dada pelo Accio para a semelhança entre o candidato e o produto.'),
      linha('Menor preço médio no Mercado Livre (R$)', f(`IFERROR(AVERAGE(${faixa('mlPreco')}),"")`), 'reais'),
      linha('Custo estimado médio por unidade (R$)', f(`IFERROR(AVERAGE(${faixa('custo')}),"")`), 'reais', 'Preço mínimo do anúncio, convertido pelo dólar e acrescido dos custos adicionais acima.'),
      linha('Margem bruta mediana (%)', f(`IFERROR(MEDIAN(${faixa('margemPct')}),"")`), 'percentual', 'Com as premissas em zero, é só a diferença entre o preço no Mercado Livre e o preço de anúncio convertido: não é lucro.'),
      linha('Produtos com margem bruta acima de 50%', f(`COUNTIF(${faixa('margemPct')},">"&0.5)`), 'inteiro'),
      linha('Produtos com margem bruta negativa', f(`COUNTIF(${faixa('margemPct')},"<0")`), 'inteiro'),
      linha('Investimento para comprar o MOQ de todos (R$)', f(`SUM(${faixa('investimento')})`), 'reais', 'Custo estimado por unidade vezes a quantidade mínima de cada anúncio.'),
      [],
      titulo('Suas decisões'),
      linha('Marcados como Cotar', f(`COUNTIF(${faixa('decisao')},"Cotar")`), 'inteiro', 'Escolha a decisão de cada produto na coluna Decisão da aba Razão composto.'),
      linha('Investimento no MOQ dos marcados como Cotar (R$)', f(`SUMIF(${faixa('decisao')},"Cotar",${faixa('investimento')})`), 'reais'),
      linha('Marcados como Aguardar', f(`COUNTIF(${faixa('decisao')},"Aguardar")`), 'inteiro'),
      linha('Marcados como Descartar', f(`COUNTIF(${faixa('decisao')},"Descartar")`), 'inteiro'),
      linha('Ainda sem decisão', f(`COUNTA(${faixa('codigo')})-COUNTIF(${faixa('decisao')},"Cotar")-COUNTIF(${faixa('decisao')},"Aguardar")-COUNTIF(${faixa('decisao')},"Descartar")`), 'inteiro'),
    ],
  };
}

function abaSobre(tipo, dados) {
  const notas = [
    ['Gerado em', new Date().toLocaleString('pt-BR')],
    ['Conteúdo', `${dados.produtos.length} produto(s) do Mercado Livre, ${dados.shopee.length} da Shopee e ${dados.linhas.length} linha(s) de cotação no Alibaba.`],
  ];
  if (tipo === 'composto') {
    notas.push(['Painel', 'Traz as premissas (células amarelas) e o resumo. Custo, margem e investimento da aba Razão composto são fórmulas ligadas a essas premissas.']);
    notas.push(['Custo estimado', 'Preço mínimo do anúncio no Alibaba × dólar × (1 + custos adicionais). Com os custos adicionais em zero, é só o preço de anúncio convertido. Não é cotação FOB nem custo de importação apurado.']);
    notas.push(['Margem bruta', 'Menor preço no Mercado Livre × (1 − comissão) − custo estimado. Serve para comparar produtos entre si; não desconta impostos sobre a venda, frete ao cliente nem despesas.']);
    notas.push(['Decisão e Observações', 'Colunas para você preencher. A Decisão tem lista (Cotar, Aguardar, Descartar) e o painel conta cada uma.']);
    notas.push(['Shopee no composto', 'A Shopee não tem ligação direta com o produto do Mercado Livre. A coluna traz o item mais vendido com nome parecido, quando existe; é aproximação e precisa ser conferida.']);
  }
  notas.push(
    ['Mercado Livre', 'A API informa posição no ranking, não quantidade vendida. Vendas, avaliações e nota são estimativas do JoomPulse, quando registradas.'],
    ['Shopee', 'Vendas e faturamento são estimativas do JoomPulse a partir do contador público arredondado da Shopee; não são vendas reais.'],
    ['Alibaba', 'Preço e MOQ são os do anúncio, em dólares. Não é cotação FOB: frete, impostos e condições só saem com pedido ao fornecedor.'],
    ['Conversão para reais', dados.cambio && dados.cambio.venda ? `Dólar a R$ ${dados.cambio.venda.toFixed(4).replace('.', ',')} (${dados.cambio.fonte}, cotação de ${dados.cambio.cotado_em}).` : 'Sem cotação do dólar disponível ao gerar.'],
    ['NCM sugerida', 'Ponto de partida para o despachante; não é classificação fiscal e não traz alíquota.'],
    ['Fotos', 'A planilha gerada pelo site não embute fotos; a coluna Link da foto aponta para a imagem.'],
  );
  return { nome: 'Sobre', colunas: [['Assunto', 28], ['Explicação', 112]], linhas: notas, semFiltro: true };
}

/* ------------------------------------------------------------------ */
/* Montagem                                                            */
/* ------------------------------------------------------------------ */

// entrada: { produtos, shopee, relacionados, cotacoes: [{ categoria, linhas }], cambio }
export function montarRazao(tipo, entrada) {
  const produtos = entrada.produtos || [];
  const shopee = entrada.shopee || [];
  // Para achar o parecido, valem tambem os itens buscados pelo nome dos produtos cotados.
  const paraCasar = shopee.concat(entrada.relacionados || []);
  const linhas = (entrada.cotacoes || []).flatMap((c) => (c.linhas || []).map((l) => ({ ...l, categoria: c.categoria })));
  const ncm = new Map(produtos.filter((p) => p.ncm).map((p) => [p.id, p.ncm]));
  const cambio = entrada.cambio || null;
  const dados = { produtos, shopee, linhas, cambio };
  const dia = new Date().toISOString().slice(0, 10);
  const rotulo = TIPOS_DE_RAZAO.find(([id]) => id === tipo);
  if (!rotulo) throw new Error(`tipo de razão desconhecido: ${tipo}`);
  let abas;
  if (tipo === 'composto') {
    abas = [abaPainel(linhas.length, cambio), abaComposta(linhas, produtos, paraCasar, cambio), abaMercadoLivre(produtos), abaAlibaba(linhas, ncm, cambio), abaShopee(shopee)];
  } else if (tipo === 'mercado-livre') abas = [abaMercadoLivre(produtos)];
  else if (tipo === 'shopee') abas = [abaShopee(shopee)];
  else abas = [abaAlibaba(linhas, ncm, cambio)];
  const principal = abas.find((a) => !a.livre);
  return {
    arquivo: `Razao ${rotulo[1]} ${dia}.xlsx`,
    abas: [...abas, abaSobre(tipo, dados)],
    linhas: principal.linhas.length,
  };
}
