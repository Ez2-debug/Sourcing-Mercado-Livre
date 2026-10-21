/*
 * Radar de tendencias: o que esta em alta em cada mercado, com a fonte de cada
 * sinal, e os sinais que aparecem em mais de um mercado.
 *
 * Junta o que ja e coletado: ranking do Mercado Livre (Brasil e Mexico), a
 * Shopee e o JoomPro pelo JoomPulse, os termos mais buscados de cada pais, as
 * importacoes do Paraguai pela ONU e a Amazon quando houver credencial. Nao
 * cria numero novo: cada item sai com o sinal que a fonte deu.
 */

// Copia de server/radar.js para a versao hospedada, que monta o radar no navegador.
const CAPITULOS_INTEIROS = new Set(['33', '34', '42', '46', '57', '61', '62', '63', '64', '65', '66', '67', '82', '91', '92', '95', '96']);
const POSICOES = new Set(('3922 3923 3924 3925 3926 4414 4419 4420 4421 4817 4818 4819 4820 4821 4823 4909 4910 6911 6912 6913 6914 ' +
  '7009 7013 7018 7113 7117 7321 7323 7324 7326 7615 8301 8302 8303 8304 8305 8306 8414 8415 8418 8421 8422 8423 8450 8451 8452 8467 8470 ' +
  '8471 8472 8473 8504 8506 8507 8508 8509 8510 8513 8516 8517 8518 8519 8521 8523 8525 8527 8528 8536 8539 8543 8544 8711 8712 8713 8714 ' +
  '8715 9004 9006 9013 9019 9025 9401 9403 9404 9405').split(' '));
function emAltaNasImportacoes(dados, quantas = 15) {
  if (!dados) return [];
  return dados.linhas.filter((l) => {
    const c = l.posicao.replace('.', '');
    return (CAPITULOS_INTEIROS.has(c.slice(0, 2)) || POSICOES.has(c)) && typeof l.variacao === 'number' && l.valor_usd >= 200000 && l.variacao > 0;
  }).sort((a, b) => b.variacao - a.variacao).slice(0, quantas);
}


const VAZIAS = new Set(['para', 'com', 'sem', 'por', 'kit', 'de', 'del', 'la', 'el', 'los', 'las', 'y', 'e', 'o', 'a', 'en', 'em', 'do', 'da']);
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const palavras = (s) => norm(s).split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !VAZIAS.has(w));

function produtoDoRanking(p, sinal) {
  return { titulo: p.nome, detalhe: p.categoria, link: p.link, foto: p.foto, sinal, preco: p.menor_preco, moeda: p.moeda };
}

// Termos que aparecem nas buscas de mais de um pais (comparados sem acento).
function termosEmVariosPaises(tendencias) {
  const onde = new Map();
  for (const [site, pais] of Object.entries((tendencias && tendencias.paises) || {})) {
    pais.termos.forEach((t, i) => {
      const chave = norm(t.termo);
      if (!chave || chave === 'ofertas') return;
      if (!onde.has(chave)) onde.set(chave, { termo: t.termo, paises: [], melhor: i });
      const e = onde.get(chave);
      if (!e.paises.includes(pais.nome)) e.paises.push(pais.nome);
      e.melhor = Math.min(e.melhor, i);
      void site;
    });
  }
  return [...onde.values()].filter((e) => e.paises.length >= 2).sort((a, b) => b.paises.length - a.paises.length || a.melhor - b.melhor);
}

// A NCM de 4 digitos de um produto do Mercado Livre ("4202.12.10" ou "posicao 42.02").
function posicaoDaNcm(ncm) {
  const d = String(ncm || '').replace(/[^0-9]/g, '');
  return d.length >= 4 ? d.slice(0, 4) : null;
}

// entrada: { produtos, emAlta, shopee, tendencias, joompro, paraguai, aduana, buscas, amazon, internacional }
function montarRadar(entrada) {
  const e = entrada || {};
  const produtos = e.produtos || [];
  const emAlta = e.emAlta || [];
  const termos = (site) => (((e.tendencias || {}).paises || {})[site] || { termos: [] }).termos;
  const doSite = (site) => (p) => String(p.id).startsWith(site);
  const aptos = (site) => produtos.filter(doSite(site)).filter((p) => p.situacao === 'apto').slice(0, 8);
  const mercados = [];

  // Brasil: subindo no ranking, depois os aptos mais bem colocados, e as buscas.
  const subindoBr = emAlta.filter(doSite('MLB')).slice(0, 8).map((p) => produtoDoRanking(p, `subiu de ${p.posicao_anterior}º para ${p.posicao}º`));
  mercados.push({
    id: 'brasil', mercado: 'Brasil · Mercado Livre', fonte: 'API oficial do Mercado Livre',
    produtos: subindoBr.length ? subindoBr : aptos('MLB').map((p) => produtoDoRanking(p, `${p.posicao}º no ranking, apto`)),
    termos: termos('MLB').slice(0, 10).map((t) => ({ termo: t.termo, link: t.link })),
  });

  const shopee = ((e.shopee && e.shopee.itens) || [])
    .filter((p) => p.tendencia === 'subindo' && !p.tem_marca)
    .sort((a, b) => (b.vendas_30_dias || 0) - (a.vendas_30_dias || 0)).slice(0, 8)
    .map((p) => ({ titulo: p.nome, detalhe: p.categoria, link: p.link, foto: p.foto, preco: p.preco, moeda: 'BRL',
      sinal: `vendas subindo; ${(p.vendas_30_dias || 0).toLocaleString('pt-BR')} un. em 30 dias (estimativa JoomPulse)` }));
  mercados.push({ id: 'shopee', mercado: 'Brasil · Shopee', fonte: 'JoomPulse (estimativas)', produtos: shopee, termos: [] });

  const subindoMx = emAlta.filter(doSite('MLM')).slice(0, 8).map((p) => produtoDoRanking(p, `subió del ${p.posicao_anterior}º al ${p.posicao}º`));
  mercados.push({
    id: 'mexico', mercado: 'México · Mercado Libre', fonte: 'API oficial do Mercado Livre',
    produtos: subindoMx.length ? subindoMx : aptos('MLM').map((p) => produtoDoRanking(p, `${p.posicao}º no ranking, apto`)),
    termos: termos('MLM').slice(0, 10).map((t) => ({ termo: t.termo, link: t.link })),
  });

  for (const [site, id, nome] of [['MLA', 'argentina', 'Argentina'], ['MLC', 'chile', 'Chile'], ['MCO', 'colombia', 'Colômbia']]) {
    mercados.push({
      id, mercado: `${nome} · Mercado Libre`, fonte: 'Termos mais buscados (API oficial do Mercado Livre)', produtos: [],
      termos: termos(site).slice(0, 15).map((t) => ({ termo: t.termo, link: t.link })),
    });
  }

  // Paraguai: compra real pela aduana (mensal, por NCM e mercadoria), tendencia
  // anual pela ONU e o termometro diario das buscas no Google.
  const aduana = e.aduana;
  const pct = (v) => `${v > 0 ? '+' : ''}${Math.round(v * 100)}%`;
  const produtosPy = ((aduana && aduana.subindo) || []).slice(0, 10).map((n) => ({
    titulo: n.mercadorias && n.mercadorias[0] ? n.mercadorias[0] : n.descricao,
    detalhe: n.descricao,
    codigo: n.ncm,
    valor_usd: n.fob_usd,
    sinal: [`${pct(n.variacao_mes)} contra ${aduana.comparado_com}`, typeof n.variacao_ano === 'number' ? `${pct(n.variacao_ano)} em um ano` : '',
      n.origens && n.origens[0] ? `${Math.round(n.origens[0].participacao * 100)}% de ${n.origens[0].pais}` : ''].filter(Boolean).join(' · '),
  }));
  const buscasPy = ((((e.buscas || {}).paises || {}).PY || {}).itens || []).slice(0, 15)
    .map((b) => ({ termo: b.termo, link: b.link, extra: [b.trafego, b.dias_em_alta > 1 ? `${b.dias_em_alta} dias` : ''].filter(Boolean).join(' · ') }));
  const py = emAltaNasImportacoes(e.paraguai, 8);
  mercados.push({
    id: 'paraguai', mercado: 'Paraguai',
    fonte: [aduana ? `Aduana do Paraguai, ${aduana.mes} contra ${aduana.comparado_com}` : '', e.paraguai ? `ONU ${e.paraguai.ano}` : '', buscasPy.length ? 'buscas do Google hoje' : ''].filter(Boolean).join(' · ') || 'Aduana do Paraguai e ONU',
    produtos: produtosPy,
    categorias: py.map((l) => ({ titulo: l.descricao, codigo: l.posicao, sinal: `+${Math.round(l.variacao * 100)}% em ${e.paraguai.ano} (ONU)`, valor_usd: l.valor_usd })),
    aviso: 'Produtos: importações de consumo liberadas pela aduana no último mês publicado, que mais cresceram. Categorias: crescimento anual pela ONU. Buscas: assuntos do dia no Google, não necessariamente compra.',
    termos: buscasPy,
    rotuloDosTermos: 'Buscas em alta hoje no Google',
  });

  const joompro = ((e.joompro && e.joompro.itens) || []).slice(0, 8).map((j) => ({
    titulo: j.titulo, detalhe: j.categoria, link: j.link, foto: j.foto, preco: j.custo_no_brasil, moeda: 'BRL',
    sinal: `custo posto no Brasil a partir de ${j.pedido_minimo || '?'} un.; par no ML com semelhança ${typeof j.semelhanca === 'number' ? j.semelhanca.toFixed(2) : '?'}`,
  }));
  mercados.push({ id: 'china', mercado: 'China · JoomPro (fornecimento)', fonte: 'JoomPulse, catálogo JoomPro', produtos: joompro, termos: [] });

  // O que o Brasil compra de fora: Compra Internacional do Mercado Livre por
  // pais da loja e lojas internacionais da Shopee (estimativas do JoomPulse).
  const intl = e.internacional;
  const lista = (l, n) => ((l || []).slice(0, n)).map((p) => ({ titulo: p.titulo, detalhe: p.detalhe, link: p.link, foto: p.foto, preco: p.preco, moeda: p.moeda, sinal: p.sinal }));
  mercados.push({ id: 'importado-china', mercado: 'Brasil compra da China · Mercado Livre', fonte: 'JoomPulse, Compra Internacional (estimativas)',
    produtos: lista(intl && intl.china && intl.china.oportunidades, 8), termos: [],
    aviso: 'Sem marca de terceiros e sem órgão regulador no caminho. Pedidos por mês são estimativas do JoomPulse.' });
  mercados.push({ id: 'importado-eua', mercado: 'Brasil compra dos EUA · Mercado Livre', fonte: 'JoomPulse, Compra Internacional (estimativas)',
    produtos: lista(intl && intl.eua && (intl.eua.oportunidades.length ? intl.eua.oportunidades : intl.eua.referencia_de_marca), 8), termos: [],
    aviso: 'Dos EUA o Brasil compra sobretudo marca (games, áudio, suplementos). Marca de terceiros exige autorização para revender.' });
  mercados.push({ id: 'importado-shopee', mercado: 'Brasil compra de fora · Shopee', fonte: 'JoomPulse, lojas internacionais (estimativas)',
    produtos: lista(intl && intl.shopee && intl.shopee.oportunidades, 8), termos: [] });

  const amazon = ((e.amazon && e.amazon.itens) || []).filter((i) => i.amazon && i.amazon.ranking_de_vendas).sort((a, b) => a.amazon.ranking_de_vendas - b.amazon.ranking_de_vendas)
    .slice(0, 8).map((i) => ({ titulo: i.amazon.titulo, link: i.amazon.link, foto: i.amazon.foto, preco: i.amazon.preco, moeda: i.amazon.moeda, sinal: `${i.amazon.ranking_de_vendas}º no ranking de vendas da Amazon` }));
  mercados.push({ id: 'amazon', mercado: 'Amazon', fonte: 'Creators API oficial', produtos: amazon, termos: [], pendente: !e.amazon });

  // Sinais em mais de um mercado: buscas repetidas entre paises e produtos da
  // Shopee em alta que tambem aparecem nas buscas do Brasil.
  const cruzados = termosEmVariosPaises(e.tendencias).slice(0, 10).map((t) => ({ titulo: t.termo, sinal: `buscado em ${t.paises.join(', ')}` }));
  const buscasBr = termos('MLB').map((t) => palavras(t.termo)).filter((p) => p.length);
  for (const s of shopee) {
    const nome = new Set(palavras(s.titulo));
    const termo = buscasBr.find((p) => p.every((w) => nome.has(w)));
    if (termo) cruzados.push({ titulo: s.titulo, link: s.link, foto: s.foto, sinal: `em alta na Shopee e entre as buscas do Mercado Livre ("${termo.join(' ')}")` });
  }

  for (const p of ((intl && intl.nas_duas_lojas) || []).slice(0, 6)) cruzados.push({ titulo: p.titulo, link: p.link, foto: p.foto, sinal: p.sinal });

  // Produto em alta no Brasil hoje cuja NCM tambem cresce nas importacoes do Paraguai.
  const crescendoPy = new Map(((aduana && aduana.subindo) || []).map((n) => [n.ncm.replace(/[^0-9]/g, '').slice(0, 4), n]));
  const vistosPy = new Set();
  for (const p of emAlta.filter(doSite('MLB')).concat(aptos('MLB'))) {
    const pos = posicaoDaNcm(p.ncm);
    const n = pos && crescendoPy.get(pos);
    if (!n || vistosPy.has(p.id)) continue;
    vistosPy.add(p.id);
    cruzados.push({ titulo: p.nome, link: p.link, foto: p.foto, sinal: `em alta no Mercado Livre Brasil e importações do Paraguai nesta posição (${pos.slice(0, 2)}.${pos.slice(2)}) ${pct(n.variacao_mes)} no mês` });
  }

  return {
    gerado_em: new Date().toISOString(),
    aviso: 'Cada sinal vem da fonte indicada. Posição em ranking e termo de busca não são quantidade vendida; vendas da Shopee são estimativas do JoomPulse.',
    cruzados,
    mercados,
  };
}

export { montarRadar, posicaoDaNcm, termosEmVariosPaises };
