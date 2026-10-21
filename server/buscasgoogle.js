'use strict';

/*
 * Buscas em alta no Google por pais, pelo feed RSS publico do Google Trends
 * (https://trends.google.com/trending/rss?geo=XX). E o feed que o proprio
 * Google oferece para acompanhar as buscas do dia; nao e a API de Trends.
 *
 * Sao assuntos do dia (noticia, esporte, evento, produto), com trafego
 * aproximado. Servem como termometro diario: datas comemorativas, lancamentos
 * e modas aparecem aqui antes de chegar ao ranking das lojas.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { cleanEnv } = require('./meli');

const PAISES = { PY: 'Paraguai', BR: 'Brasil', MX: 'México', AR: 'Argentina', CL: 'Chile', CO: 'Colômbia' };
const VALIDADE_MS = 3 * 3600 * 1000;
const DIAS_DE_HISTORICO = 30;

function arquivo() {
  const base = cleanEnv(process.env.CONECTA_HUB_SAIDA);
  return path.join(base ? path.dirname(base) : path.join(os.homedir(), 'ConectaHubSourcing'), 'buscas-google.json');
}

function lerBuscas() {
  try {
    return JSON.parse(fs.readFileSync(arquivo(), 'utf8'));
  } catch (_) {
    return null;
  }
}

const desfazer = (s) => String(s || '').replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
const tag = (bloco, nome) => { const m = bloco.match(new RegExp(`<${nome}>([\\s\\S]*?)</${nome}>`)); return m ? desfazer(m[1]) : ''; };

function lerFeed(xml) {
  const itens = [];
  for (const bloco of String(xml).split('<item>').slice(1)) {
    const termo = tag(bloco, 'title');
    if (!termo) continue;
    const noticia = bloco.split('<ht:news_item>')[1] || '';
    const url = tag(noticia, 'ht:news_item_url');
    itens.push({
      termo,
      trafego: tag(bloco, 'ht:approx_traffic'),
      quando: tag(bloco, 'pubDate'),
      noticia: tag(noticia, 'ht:news_item_title') || undefined,
      link: /^https:\/\//.test(url) ? url : undefined,
    });
  }
  return itens;
}

const dia = (d) => d.toISOString().slice(0, 10);

// Le os feeds de todos os paises no maximo a cada tres horas e guarda um
// historico de 30 dias, para dizer ha quantos dias um assunto aparece.
async function atualizarBuscas(buscar, agora) {
  const atual = lerBuscas();
  const quando = agora || new Date();
  if (atual && quando - Date.parse(atual.consultado_em) < VALIDADE_MS) return atual;
  const historico = (atual && atual.historico) || {};
  const paises = {};
  for (const [geo, nome] of Object.entries(PAISES)) {
    try {
      const res = await (buscar || fetch)(`https://trends.google.com/trending/rss?geo=${geo}`, { headers: { 'user-agent': 'Mozilla/5.0 (Conecta Market Sourcing)' }, signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const itens = lerFeed(await res.text());
      const doPais = historico[geo] || {};
      doPais[dia(quando)] = itens.map((i) => i.termo.toLowerCase());
      for (const d of Object.keys(doPais)) if ((quando - Date.parse(d)) / 86400000 > DIAS_DE_HISTORICO) delete doPais[d];
      historico[geo] = doPais;
      const diasCom = (termo) => Object.values(doPais).filter((lista) => lista.includes(termo.toLowerCase())).length;
      paises[geo] = { nome, itens: itens.map((i) => ({ ...i, dias_em_alta: diasCom(i.termo) })) };
    } catch (_) {
      paises[geo] = (atual && atual.paises && atual.paises[geo]) || { nome, itens: [], erro: 'nao disponivel' };
    }
  }
  const dados = {
    fonte: 'Google Trends, feed publico de buscas em alta',
    consultado_em: quando.toISOString(),
    aviso: 'Assuntos mais buscados no Google no dia, com trafego aproximado. Mostra o que o publico procura, nao o que compra.',
    paises,
    historico,
  };
  fs.mkdirSync(path.dirname(arquivo()), { recursive: true });
  fs.writeFileSync(arquivo(), JSON.stringify(dados), 'utf8');
  return dados;
}

module.exports = { PAISES, atualizarBuscas, lerBuscas, lerFeed };
