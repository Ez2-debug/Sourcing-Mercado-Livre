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

// entrada: { produtos, emAlta, shopee, tendencias, joompro, paraguai, amazon }
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

  const py = emAltaNasImportacoes(e.paraguai, 12);
  mercados.push({
    id: 'paraguai', mercado: 'Paraguai · importações', fonte: e.paraguai ? `UN Comtrade (ONU), ${e.paraguai.ano} contra ${e.paraguai.ano_anterior}` : 'UN Comtrade (ONU)',
    produtos: [],
    categorias: py.map((l) => ({ titulo: l.descricao, codigo: l.posicao, sinal: `+${Math.round(l.variacao * 100)}% em um ano`, valor_usd: l.valor_usd })),
    aviso: 'Tipos de produto que o país passou a importar mais. A posição do Sistema Harmonizado agrupa produtos parecidos: use como direção, não como produto pronto.',
    termos: [],
  });

  const joompro = ((e.joompro && e.joompro.itens) || []).slice(0, 8).map((j) => ({
    titulo: j.titulo, detalhe: j.categoria, link: j.link, foto: j.foto, preco: j.custo_no_brasil, moeda: 'BRL',
    sinal: `custo posto no Brasil a partir de ${j.pedido_minimo || '?'} un.; par no ML com semelhança ${typeof j.semelhanca === 'number' ? j.semelhanca.toFixed(2) : '?'}`,
  }));
  mercados.push({ id: 'china', mercado: 'China · JoomPro (fornecimento)', fonte: 'JoomPulse, catálogo JoomPro', produtos: joompro, termos: [] });

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

  return {
    gerado_em: new Date().toISOString(),
    aviso: 'Cada sinal vem da fonte indicada. Posição em ranking e termo de busca não são quantidade vendida; vendas da Shopee são estimativas do JoomPulse.',
    cruzados,
    mercados,
  };
}

export { montarRadar, termosEmVariosPaises };
