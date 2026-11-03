// Busca de um produto em todas as fontes de uma vez: mais vendidos de cada
// marketplace, ranking minerado do Mercado Livre, Compras Paraguai e aduana.

const semAcento = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Todas as palavras precisam aparecer; o plural tambem acha o singular
// ("tenis corridas" acha "tenis de corrida").
export function casaTodas(texto, busca) {
  const alvo = semAcento(texto);
  const termos = semAcento(busca).split(/\s+/).filter(Boolean);
  if (!termos.length) return false;
  return termos.every((t) => alvo.includes(t) || (t.length > 3 && /s$/.test(t) && alvo.includes(t.slice(0, -1))));
}

const NOMES = {
  ml: 'Mercado Livre · mais vendidos',
  'ml-internacional': 'Mercado Livre · Compra Internacional',
  shopee: 'Shopee',
  'shopee-internacional': 'Shopee · lojas internacionais',
  joompro: 'China · fornecedores (JoomPro)',
  minerado: 'Mercado Livre · ranking minerado',
  'compras-paraguai': 'Paraguai · lojas (Compras Paraguai)',
  paraguai: 'Paraguai · importações (aduana)',
};

// Junta as fontes num formato so. Cada resultado guarda de onde veio.
export function juntarFontes({ maisVendidos, produtos, radar }) {
  const lista = [];
  for (const [tipo, mp] of Object.entries((maisVendidos && maisVendidos.marketplaces) || {})) {
    for (const p of mp.itens) {
      lista.push({ fonte: tipo, titulo: p.titulo, foto: p.foto, link: p.link, preco: p.preco, moeda: 'BRL', categoria: p.categoria, genero: p.genero,
        vendas: p.vendas_mes, sinal: [typeof p.vendas_mes === 'number' ? `${p.vendas_mes.toLocaleString('pt-BR')} vendas/mês (estimativa)` : '', p.origem && p.origem !== 'Não identificada' ? p.origem : '', p.categoria].filter(Boolean).join(' · ') });
    }
  }
  for (const p of (produtos && produtos.itens) || []) {
    lista.push({ fonte: 'minerado', titulo: p.nome, foto: p.foto, link: p.link, preco: p.menor_preco, moeda: p.moeda || 'BRL', categoria: p.categoria,
      vendas: p.vendas_estimadas, sinal: [`${p.posicao}º no ranking`, p.situacao, p.categoria].filter(Boolean).join(' · ') });
  }
  for (const m of (radar && radar.mercados) || []) {
    if (m.id !== 'compras-paraguai' && m.id !== 'paraguai') continue;
    for (const p of m.produtos || []) lista.push({ fonte: m.id, titulo: p.titulo, foto: p.foto, link: p.link, preco: p.preco, moeda: p.moeda, sinal: p.sinal });
  }
  return lista;
}

export function agruparResultados(lista, busca) {
  const grupos = new Map();
  for (const r of lista) {
    if (!casaTodas(`${r.titulo} ${r.categoria || ''}`, busca)) continue;
    if (!grupos.has(r.fonte)) grupos.set(r.fonte, { fonte: r.fonte, nome: NOMES[r.fonte] || r.fonte, itens: [] });
    grupos.get(r.fonte).itens.push(r);
  }
  for (const g of grupos.values()) g.itens.sort((a, b) => (b.vendas || 0) - (a.vendas || 0));
  return [...grupos.values()].sort((a, b) => b.itens.length - a.itens.length);
}
