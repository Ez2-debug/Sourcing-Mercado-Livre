'use strict';

/*
 * Planilha Excel dos produtos minerados, com foto na celula e links.
 *
 * Aceita uma mineracao ou todas as de um dia. As fotos sao baixadas do CDN
 * de imagens do Mercado Livre e copiadas para dentro do arquivo.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { ToolError, cleanEnv, mapLimit } = require('./meli');
const { todosOsProdutos } = require('./mineracao');
const { dataParaExcel, marcaBarra, mesesNoCatalogo, ncmCurto, situacao } = require('./indicadores');
const { ESTILO, medirImagem, montarXlsx } = require('./xlsx');

const LADO = 96; // pixels da foto na celula
const ALTURA_DA_LINHA = 76; // pontos; cabe a foto com folga
const TIMEOUT_MS = 20000;
const MAX_BYTES = 3 * 1024 * 1024;

const ROTULO_SITUACAO = {
  apto: 'Apto para cotação',
  marca_registrada: 'Marca conhecida',
  regulado: 'Alerta regulatório',
  proibido: 'Proibido',
};
const ESTILO_SITUACAO = {
  apto: ESTILO.apto, marca_registrada: ESTILO.marca, regulado: ESTILO.regulado, proibido: ESTILO.proibido,
};

function pastaPlanilhas() {
  const base = cleanEnv(process.env.CONECTA_HUB_SAIDA);
  return path.join(base ? path.dirname(base) : path.join(os.homedir(), 'ConectaHubSourcing'), 'planilhas');
}

// So baixa dos CDNs de imagens do Mercado Livre e do Alibaba. No Mercado
// Livre, a versao "-O" (500 px) basta para a celula e pesa bem menos que a
// foto cheia ("-F").
async function baixarFoto(endereco) {
  let u;
  try { u = new URL(endereco); } catch (_) { return null; }
  if (u.protocol !== 'https:' || !/(^|\.)(mlstatic|alicdn)\.com$/.test(u.hostname)) return null;
  const tentativas = [endereco.replace(/-F\.jpg$/, '-O.jpg'), endereco];
  for (const alvo of tentativas) {
    try {
      const res = await fetch(alvo, { headers: { accept: 'image/jpeg,image/png' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) continue;
      const dados = Buffer.from(await res.arrayBuffer());
      if (dados.length <= MAX_BYTES && medirImagem(dados)) return dados;
    } catch (_) { /* tenta a proxima */ }
  }
  return null;
}

function tipoDeMarca(p) {
  if (p.sinais.sem_marca) return 'Sem marca';
  return marcaBarra(p) ? 'Conhecida' : 'De vendedor';
}

const COLUNAS = [
  ['Foto', 14], ['Produto', 58], ['Categoria no Mercado Livre', 40], ['Posição no ranking', 11],
  ['Menor preço (R$)', 13], ['Anúncios', 10], ['Vendedores', 11], ['Marca no anúncio', 22],
  ['Tipo de marca', 14], ['Situação na triagem', 20], ['Alertas', 14], ['NCM sugerida', 16],
  ['Prioridade', 11], ['No catálogo desde', 13], ['Meses no catálogo', 11], ['Venda estimada', 22], ['Termos em alta', 26], ['Link do produto', 46],
  ['Link do menor preço', 46], ['Link da foto', 46], ['Mineração', 26],
];

function linhaDoProduto(m, p) {
  const an = p.anuncios || {};
  const mp = an.menor_preco || {};
  const sit = situacao(p);
  const est = p.estimativa_externa;
  const venda = est
    ? `${est.vendas !== undefined ? `${est.vendas} un.` : ''}${est.faturamento !== undefined ? ` R$ ${Math.round(est.faturamento)}` : ''} por ${est.periodo === 'mensal' ? 'mês' : 'semana'} (${est.fonte})`.trim()
    : '';
  const t = ESTILO.texto;
  return {
    altura: ALTURA_DA_LINHA,
    celulas: [
      { v: p.foto ? '' : 'sem foto', s: t },
      { v: p.nome, s: p.link ? ESTILO.link : t, link: p.link },
      { v: p.categoria, s: t },
      { v: p.melhor_posicao, s: ESTILO.posicao },
      { v: mp.valor, s: ESTILO.dinheiro },
      { v: an.quantidade_anuncios, s: ESTILO.centro },
      { v: an.vendedores, s: ESTILO.centro },
      { v: p.marca || '', s: t },
      { v: tipoDeMarca(p), s: t },
      { v: ROTULO_SITUACAO[sit], s: ESTILO_SITUACAO[sit] },
      { v: p.sinais.regulatorio.map((r) => r.orgao).join(', '), s: t },
      { v: ncmCurto(p) || '', s: t },
      { v: p.prioridade.pontos, s: ESTILO.centro },
      { v: dataParaExcel(p.catalogo_desde), s: ESTILO.data },
      { v: mesesNoCatalogo(p, m.consultado_em), s: ESTILO.centro },
      { v: venda, s: t },
      { v: (p.tendencias_relacionadas || []).join(', '), s: t },
      { v: p.link || '', s: p.link ? ESTILO.link : t, link: p.link },
      { v: mp.link || '', s: mp.link ? ESTILO.link : t, link: mp.link },
      { v: p.foto || '', s: p.foto ? ESTILO.link : t, link: p.foto },
      { v: m.id, s: t },
    ],
  };
}

function abaSobre(mineracoes, total, semDetalhe, comFoto) {
  const notas = [
    ['Conteúdo', `${total} produto(s) minerado(s) no Mercado Livre Brasil pela extensão Conecta Hub Sourcing. ${comFoto} com foto na planilha.`],
    ['Minerações', mineracoes.map((m) => `${m.id} (${m.categoria_raiz.caminho}, ${new Date(m.consultado_em).toLocaleString('pt-BR')})`).join('; ')],
    ['Fora da planilha', `${semDetalhe} produto(s) do ranking sem nome nem foto, porque a API recusou o detalhe.`],
    ['Posição no ranking', 'Posição no ranking de mais vendidos da categoria. A API informa a ordem, não a quantidade vendida.'],
    ['Menor preço', 'Anúncio mais barato do produto no momento da consulta, em reais.'],
    ['Prioridade', 'Regra de triagem de 0 a 100 (posição, termos em alta, marca, concorrência, alertas). Não é estimativa de vendas.'],
    ['Tipo de marca', 'Conhecida: está na lista de marcas de grande circulação e fica fora da cotação. De vendedor: marca própria do anunciante; cotar o equivalente sem marca. A lista não substitui consulta ao INPI.'],
    ['Alertas', 'Anatel, Anvisa e Inmetro por palavra-chave no nome do produto. Servem de aviso; a exigência real depende do NCM.'],
    ['NCM sugerida', 'Ponto de partida pela descrição do anúncio e pela tabela oficial do Siscomex. Não é classificação fiscal; confirmar com o despachante.'],
    ['No catálogo desde', 'Data em que a página do produto foi criada no catálogo do Mercado Livre, e há quantos meses isso foi na data da mineração. Não é a data de cada anúncio: essa a API não informa. Produto recente e já no ranking é sinal de subida rápida.'],
    ['Venda estimada', 'Só aparece quando uma fonte externa foi registrada (por exemplo JoomPulse). É estimativa da fonte, não venda real nem dado do Mercado Livre.'],
    ['Links', 'Montados pelo padrão de endereços do site, não devolvidos pela API; algum pode não abrir.'],
    ['Fotos', 'Fotos do catálogo do Mercado Livre, copiadas para dentro da planilha. A coluna Link da foto aponta para a imagem original.'],
  ];
  return {
    nome: 'Sobre',
    larguras: [26, 110],
    linhas: notas.map(([a, b]) => ({ celulas: [{ v: a, s: ESTILO.rotulo }, { v: b, s: ESTILO.nota }] })),
  };
}

// Monta o .xlsx em memoria. `baixar` pode ser trocado nos testes.
async function montarPlanilha(mineracoes, baixar) {
  const pares = [];
  let semDetalhe = 0;
  for (const m of mineracoes) {
    for (const p of todosOsProdutos(m)) {
      if (!p.nome) { semDetalhe += 1; continue; }
      pares.push([m, p]);
    }
  }
  if (!pares.length) throw new ToolError('Nenhum produto com detalhe para exportar nessas mineracoes.');
  pares.sort(([, a], [, b]) => a.categoria.localeCompare(b.categoria, 'pt-BR') ||
    b.prioridade.pontos - a.prioridade.pontos || a.melhor_posicao - b.melhor_posicao);

  const fotos = await mapLimit(pares, 6, ([, p]) => (p.foto ? (baixar || baixarFoto)(p.foto) : null));
  const imagens = [];
  fotos.forEach((dados, i) => {
    const medida = dados && medirImagem(dados);
    if (!medida || !medida.largura || !medida.altura) return;
    const escala = LADO / Math.max(medida.largura, medida.altura);
    const largura = Math.max(1, Math.round(medida.largura * escala));
    const altura = Math.max(1, Math.round(medida.altura * escala));
    imagens.push({
      linha: i + 1, coluna: 0, dados, largura, altura,
      margemX: 2 + Math.round((LADO - largura) / 2), margemY: 2 + Math.round((LADO - altura) / 2),
    });
  });
  const linhas = pares.map(([m, p], i) => {
    const linha = linhaDoProduto(m, p);
    if (p.foto && !imagens.some((im) => im.linha === i + 1)) linha.celulas[0].v = 'foto indisponível';
    return linha;
  });
  const cabecalho = { altura: 32, celulas: COLUNAS.map(([titulo]) => ({ v: titulo, s: ESTILO.cabecalho })) };
  const buffer = montarXlsx([
    { nome: 'Produtos', larguras: COLUNAS.map(([, w]) => w), congelar: { colunas: 2, linhas: 1 }, filtro: true, linhas: [cabecalho, ...linhas], imagens },
    abaSobre(mineracoes, pares.length, semDetalhe, imagens.length),
  ]);
  return { buffer, produtos: pares.length, com_foto: imagens.length, sem_detalhe: semDetalhe };
}

// Grava a planilha. Se o arquivo estiver aberto no Excel, grava ao lado com a
// hora no nome em vez de falhar: a mineracao automatica nao pode parar por isso.
function gravarPlanilha(arquivo, buffer) {
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  try {
    fs.writeFileSync(arquivo, buffer);
    return arquivo;
  } catch (err) {
    if (err.code !== 'EBUSY' && err.code !== 'EPERM') throw err;
    const d = new Date();
    const hora = `${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
    const alternativo = arquivo.replace(/\.xlsx$/, `-${hora}.xlsx`);
    fs.writeFileSync(alternativo, buffer);
    return alternativo;
  }
}

async function exportarExcel(mineracoes, nomeBase, baixar) {
  const r = await montarPlanilha(mineracoes, baixar);
  const pedido = path.join(pastaPlanilhas(), `produtos-${nomeBase}.xlsx`);
  const arquivo = gravarPlanilha(pedido, r.buffer);
  return {
    arquivo,
    observacao: arquivo !== pedido ? `${path.basename(pedido)} estava aberto no Excel; gravei em outro arquivo.` : undefined,
    mineracoes: mineracoes.map((m) => m.id),
    produtos: r.produtos,
    com_foto: r.com_foto,
    sem_detalhe_fora_da_planilha: r.sem_detalhe,
  };
}

module.exports = { baixarFoto, exportarExcel, gravarPlanilha, montarPlanilha, pastaPlanilhas };
