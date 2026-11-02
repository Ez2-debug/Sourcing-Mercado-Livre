'use strict';

/*
 * Compras Paraguai (https://www.comprasparaguai.com.br): comparador de precos
 * das lojas do Paraguai, feito para o comprador brasileiro.
 *
 * Nao ha API. O robots.txt do site libera paginas publicas a robos, com 10 s
 * entre pedidos, e os termos de uso nao proibem a leitura. Por isso a leitura
 * e minima: so a pagina inicial, uma vez por dia, de onde saem as listas
 * "Mais buscados" e "Destaques". Cada produto volta com o link para o site.
 *
 * O preco e o "a partir de" publicado (menor oferta), em dolares e em reais.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { cleanEnv } = require('./meli');

const ORIGEM = 'https://www.comprasparaguai.com.br';
const AGENTE = 'ConectaMarketSourcing/1.0 (leitura diaria da pagina inicial)';
const DIAS_DE_HISTORICO = 30;

function arquivo() {
  const base = cleanEnv(process.env.CONECTA_HUB_SAIDA);
  return path.join(base ? path.dirname(base) : path.join(os.homedir(), 'ConectaHubSourcing'), 'compras-paraguai.json');
}

function lerComprasParaguai() {
  try {
    return JSON.parse(fs.readFileSync(arquivo(), 'utf8'));
  } catch (_) {
    return null;
  }
}

const texto = (s) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
const valor = (s) => { const n = Number(String(s || '').replace(/[^\d,]/g, '').replace(',', '.')); return Number.isFinite(n) && n > 0 ? n : undefined; };

// Os cartoes de produto de um trecho da pagina.
function cartoes(html) {
  const itens = [];
  for (const bloco of String(html).split('class="promocao-produtos-item"').slice(1)) {
    const link = (bloco.match(/<a href="(\/[^"]+_\d+\/)"/) || [])[1];
    const nome = texto((bloco.match(/class="promocao-item-nome">([\s\S]*?)<\/div>/) || [])[1]);
    if (!link || !nome) continue;
    const foto = (bloco.match(/<img src="(https:\/\/[^"]+)"/) || [])[1];
    const usd = (bloco.match(/US\$\s*([\d.,]+)/) || [])[1];
    const brl = (bloco.match(/R\$\s*([\d.,]+)/) || [])[1];
    const ofertas = (bloco.match(/(\d+)\s*OFERTAS?/i) || [])[1];
    const lojas = (bloco.match(/em\s*(\d+)\s*lojas?/i) || [])[1];
    const item = {
      id: (link.match(/_(\d+)\/$/) || [])[1],
      nome,
      link: ORIGEM + link,
      foto,
      preco_usd: valor(usd),
      preco_brl: valor(brl),
      ofertas: ofertas ? Number(ofertas) : undefined,
      lojas: lojas ? Number(lojas) : undefined,
    };
    for (const k of Object.keys(item)) if (item[k] === undefined) delete item[k];
    itens.push(item);
  }
  return itens;
}

function trecho(html, inicio, fim) {
  const i = html.indexOf(inicio);
  if (i < 0) return '';
  const f = html.indexOf(fim, i + inicio.length);
  return html.slice(i, f < 0 ? undefined : f);
}

// Le as duas listas da pagina inicial. Patrocinados ficam de fora.
function lerPagina(html) {
  const maisBuscados = cartoes(trecho(html, '<!-- Begin: Mais buscados -->', '<!-- End: Mais buscados -->'));
  const destaques = cartoes(trecho(html, '<span>Destaques</span>', '<span>Patrocinado</span>'))
    .filter((d) => !maisBuscados.some((m) => m.id === d.id));
  return { mais_buscados: maisBuscados.map((x, i) => ({ ...x, posicao: i + 1 })), destaques };
}

const dia = (d) => d.toISOString().slice(0, 10);

// Uma leitura por dia. Guarda 30 dias de historico dos "mais buscados" para
// dizer ha quantos dias cada produto esta na lista e o que entrou hoje.
async function atualizarComprasParaguai(buscar, agora) {
  const quando = agora || new Date();
  const atual = lerComprasParaguai();
  if (atual && atual.consultado_em && dia(new Date(atual.consultado_em)) === dia(quando)) return atual;
  const res = await (buscar || fetch)(`${ORIGEM}/`, { headers: { 'user-agent': AGENTE, accept: 'text/html' }, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`Compras Paraguai respondeu HTTP ${res.status}`);
  const pagina = lerPagina(await res.text());
  if (!pagina.mais_buscados.length) throw new Error('lista "Mais buscados" nao encontrada; o formato da pagina pode ter mudado');
  const historico = (atual && atual.historico) || {};
  const ontem = Object.keys(historico).sort().pop();
  historico[dia(quando)] = pagina.mais_buscados.map((x) => x.id);
  for (const d of Object.keys(historico)) if ((quando - Date.parse(d)) / 86400000 > DIAS_DE_HISTORICO) delete historico[d];
  const dias = (id) => Object.values(historico).filter((l) => l.includes(id)).length;
  const dados = {
    fonte: 'Compras Paraguai, página inicial (Mais buscados e Destaques)',
    consultado_em: quando.toISOString(),
    aviso: 'Lista dos produtos mais buscados pelos brasileiros no comparador de preços das lojas do Paraguai. Preço "a partir de" é a menor oferta publicada no dia.',
    mais_buscados: pagina.mais_buscados.map((x) => ({
      ...x,
      dias_na_lista: dias(x.id),
      entrou_hoje: ontem && ontem !== dia(quando) ? !historico[ontem].includes(x.id) : undefined,
    })),
    destaques: pagina.destaques,
    historico,
  };
  fs.mkdirSync(path.dirname(arquivo()), { recursive: true });
  fs.writeFileSync(arquivo(), JSON.stringify(dados), 'utf8');
  return dados;
}

module.exports = { atualizarComprasParaguai, lerComprasParaguai, lerPagina };
