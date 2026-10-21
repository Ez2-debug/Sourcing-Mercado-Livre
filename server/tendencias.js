'use strict';

/*
 * Termos mais buscados no Mercado Livre de cada pais (endpoint /trends).
 *
 * E o que a credencial alcanca em paises onde o ranking de produtos e
 * recusado (Argentina, Chile, Colombia). Sao termos de busca, sem volume.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { apiGet, cleanEnv } = require('./meli');

const PAISES = {
  MLB: 'Brasil',
  MLM: 'México',
  MLA: 'Argentina',
  MLC: 'Chile',
  MCO: 'Colômbia',
};
const VALIDADE_MS = 6 * 3600 * 1000;

function arquivo() {
  const base = cleanEnv(process.env.CONECTA_HUB_SAIDA);
  return path.join(base ? path.dirname(base) : path.join(os.homedir(), 'ConectaHubSourcing'), 'tendencias.json');
}

function lerTendencias() {
  try {
    return JSON.parse(fs.readFileSync(arquivo(), 'utf8'));
  } catch (_) {
    return null;
  }
}

// Atualiza no maximo a cada seis horas. Um pais que falhe fica com a lista anterior.
async function atualizarTendencias(buscar) {
  const atual = lerTendencias();
  if (atual && Date.now() - Date.parse(atual.consultado_em) < VALIDADE_MS) return atual;
  const pegar = buscar || apiGet;
  const paises = {};
  for (const [site, nome] of Object.entries(PAISES)) {
    try {
      const lista = await pegar(`/trends/${site}`);
      paises[site] = { nome, termos: (Array.isArray(lista) ? lista : []).map((t) => ({ termo: t.keyword, link: t.url })).filter((t) => t.termo).slice(0, 50) };
    } catch (_) {
      paises[site] = (atual && atual.paises && atual.paises[site]) || { nome, termos: [], erro: 'nao disponivel' };
    }
  }
  const dados = {
    fonte: 'Mercado Livre, /trends',
    consultado_em: new Date().toISOString(),
    aviso: 'Termos mais buscados no Mercado Livre de cada pais, na ordem que a API devolve. Nao ha volume de busca.',
    paises,
  };
  fs.mkdirSync(path.dirname(arquivo()), { recursive: true });
  fs.writeFileSync(arquivo(), JSON.stringify(dados, null, 2), 'utf8');
  return dados;
}

module.exports = { PAISES, atualizarTendencias, lerTendencias };
