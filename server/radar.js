'use strict';

/*
 * Radar de tendencias: o que esta em alta em cada mercado, com a fonte de cada
 * sinal, e os sinais que aparecem em mais de um mercado.
 *
 * Junta o que ja e coletado: ranking do Mercado Livre (Brasil e Mexico), a
 * Shopee e o JoomPro pelo JoomPulse, o que o Brasil compra de fora, as
 * importacoes do Paraguai (aduana e ONU) e a Amazon quando houver credencial.
 * So produtos e categorias, em portugues. Nao cria numero novo: cada item sai
 * com o sinal que a fonte deu.
 */

const { emAltaNasImportacoes } = require('./comtrade');

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

// entrada: { produtos, emAlta, shopee, tendencias, joompro, paraguai, aduana, amazon, internacional, traducoes }
// So produtos, tudo em portugues: titulo em outra lingua sai traduzido quando
// ha traducao guardada (traducoes: { textos: { original: portugues } }).
function montarRadar(entrada) {
  const e = entrada || {};
  const textos = (e.traducoes && e.traducoes.textos) || {};
  const tr = (s) => textos[String(s || '').replace(/\s+/g, ' ').trim()] || s;
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
  });

  const shopee = ((e.shopee && e.shopee.itens) || [])
    .filter((p) => p.tendencia === 'subindo' && !p.tem_marca)
    .sort((a, b) => (b.vendas_30_dias || 0) - (a.vendas_30_dias || 0)).slice(0, 8)
    .map((p) => ({ titulo: p.nome, detalhe: p.categoria, link: p.link, foto: p.foto, preco: p.preco, moeda: 'BRL',
      sinal: `vendas subindo; ${(p.vendas_30_dias || 0).toLocaleString('pt-BR')} un. em 30 dias (estimativa JoomPulse)` }));
  mercados.push({ id: 'shopee', mercado: 'Brasil · Shopee', fonte: 'JoomPulse (estimativas)', produtos: shopee });

  const subindoMx = emAlta.filter(doSite('MLM')).slice(0, 8).map((p) => produtoDoRanking(p, `subiu de ${p.posicao_anterior}º para ${p.posicao}º`));
  mercados.push({
    id: 'mexico', mercado: 'México · Mercado Livre', fonte: 'API oficial do Mercado Livre; títulos traduzidos do espanhol',
    produtos: (subindoMx.length ? subindoMx : aptos('MLM').map((p) => produtoDoRanking(p, `${p.posicao}º no ranking, apto`)))
      .map((p) => ({ ...p, titulo: tr(p.titulo), detalhe: tr(p.detalhe) })),
  });

  // Paraguai: compra real pela aduana (mensal, por NCM e mercadoria), tendencia
  // anual pela ONU e o termometro diario das buscas no Google.
  const aduana = e.aduana;
  const pct = (v) => `${v > 0 ? '+' : ''}${Math.round(v * 100)}%`;
  const produtosPy = ((aduana && aduana.subindo) || []).slice(0, 10).map((n) => ({
    // Nome da NCM brasileira: a nomenclatura e a mesma do Mercosul.
    titulo: n.nome_pt || n.descricao,
    codigo: n.ncm,
    valor_usd: n.fob_usd,
    sinal: [`${pct(n.variacao_mes)} contra ${aduana.comparado_com}`, typeof n.variacao_ano === 'number' ? `${pct(n.variacao_ano)} em um ano` : '',
      n.origens && n.origens[0] ? `${Math.round(n.origens[0].participacao * 100)}% de ${n.origens[0].pais}` : ''].filter(Boolean).join(' · '),
  }));
  const py = emAltaNasImportacoes(e.paraguai, 8);
  mercados.push({
    id: 'paraguai', mercado: 'Paraguai',
    fonte: [aduana ? `Aduana do Paraguai, ${aduana.mes} contra ${aduana.comparado_com}` : '', e.paraguai ? `ONU ${e.paraguai.ano}` : ''].filter(Boolean).join(' · ') || 'Aduana do Paraguai e ONU',
    produtos: produtosPy,
    categorias: py.map((l) => ({ titulo: l.descricao, codigo: l.posicao, sinal: `+${Math.round(l.variacao * 100)}% em ${e.paraguai.ano} (ONU)`, valor_usd: l.valor_usd })),
    aviso: 'Produtos: importações de consumo liberadas pela aduana no último mês publicado que mais cresceram, com o nome da NCM. Categorias: crescimento anual pela ONU.',
  });

  const joompro = ((e.joompro && e.joompro.itens) || []).slice(0, 8).map((j) => ({
    // Titulo do par no Mercado Livre Brasil: o do catalogo vem em ingles.
    titulo: (j.mercado_livre && j.mercado_livre.titulo) || j.titulo, detalhe: j.mercado_livre && j.mercado_livre.categoria, link: j.link, foto: j.foto, preco: j.custo_no_brasil, moeda: 'BRL',
    sinal: `custo posto no Brasil a partir de ${j.pedido_minimo || '?'} un.; par no ML com semelhança ${typeof j.semelhanca === 'number' ? j.semelhanca.toFixed(2) : '?'}`,
  }));
  mercados.push({ id: 'china', mercado: 'China · JoomPro (fornecimento)', fonte: 'JoomPulse, catálogo JoomPro; título do par no Mercado Livre', produtos: joompro });

  // O que o Brasil compra de fora: Compra Internacional do Mercado Livre por
  // pais da loja e lojas internacionais da Shopee (estimativas do JoomPulse).
  const intl = e.internacional;
  const lista = (l, n) => ((l || []).slice(0, n)).map((p) => ({ titulo: p.titulo, detalhe: p.detalhe, link: p.link, foto: p.foto, preco: p.preco, moeda: p.moeda, sinal: p.sinal }));
  mercados.push({ id: 'importado-china', mercado: 'Brasil compra da China · Mercado Livre', fonte: 'JoomPulse, Compra Internacional (estimativas)',
    produtos: lista(intl && intl.china && intl.china.oportunidades, 8).map((p) => ({ ...p, titulo: tr(p.titulo) })),
    aviso: 'Sem marca de terceiros e sem órgão regulador no caminho. Pedidos por mês são estimativas do JoomPulse.' });
  mercados.push({ id: 'importado-eua', mercado: 'Brasil compra dos EUA · Mercado Livre', fonte: 'JoomPulse, Compra Internacional (estimativas)',
    produtos: lista(intl && intl.eua && (intl.eua.oportunidades.length ? intl.eua.oportunidades : intl.eua.referencia_de_marca), 8).map((p) => ({ ...p, titulo: tr(p.titulo) })),
    aviso: 'Dos EUA o Brasil compra sobretudo marca (games, áudio, suplementos). Marca de terceiros exige autorização para revender.' });
  mercados.push({ id: 'importado-shopee', mercado: 'Brasil compra de fora · Shopee', fonte: 'JoomPulse, lojas internacionais (estimativas)',
    produtos: lista(intl && intl.shopee && intl.shopee.oportunidades, 8) });

  const amazon = ((e.amazon && e.amazon.itens) || []).filter((i) => i.amazon && i.amazon.ranking_de_vendas).sort((a, b) => a.amazon.ranking_de_vendas - b.amazon.ranking_de_vendas)
    .slice(0, 8).map((i) => ({ titulo: i.amazon.titulo, link: i.amazon.link, foto: i.amazon.foto, preco: i.amazon.preco, moeda: i.amazon.moeda, sinal: `${i.amazon.ranking_de_vendas}º no ranking de vendas da Amazon` }));
  mercados.push({ id: 'amazon', mercado: 'Amazon', fonte: 'Creators API oficial', produtos: amazon, pendente: !e.amazon });

  // Produtos em mais de um mercado: Shopee em alta que tambem e busca no
  // Brasil, o que se vende de fora nas duas lojas e o que cresce no Paraguai.
  const cruzados = [];
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
    aviso: 'Cada sinal vem da fonte indicada. Posição em ranking não é quantidade vendida; vendas e pedidos são estimativas do JoomPulse.',
    cruzados,
    mercados,
  };
}

module.exports = { montarRadar, posicaoDaNcm, termosEmVariosPaises };
