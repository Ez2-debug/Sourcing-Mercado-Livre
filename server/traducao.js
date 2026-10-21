'use strict';

/*
 * Traducao para o portugues dos titulos que chegam em outra lingua (Mercado
 * Libre do Mexico, em espanhol).
 *
 * Usa a API publica do MyMemory (https://mymemory.translated.net/doc/spec.php),
 * sem chave: cerca de 5 mil caracteres por dia. Cada titulo e traduzido uma
 * vez e fica guardado; o limite diario nunca e ultrapassado. Sem traducao,
 * o titulo aparece como veio.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { cleanEnv, log } = require('./meli');

const LIMITE_DIARIO = 4500; // caracteres; a API anonima aceita 5000
const MAXIMO_POR_TITULO = 400;

function arquivo() {
  const base = cleanEnv(process.env.CONECTA_HUB_SAIDA);
  return path.join(base ? path.dirname(base) : path.join(os.homedir(), 'ConectaHubSourcing'), 'traducoes.json');
}

function lerTraducoes() {
  try {
    const r = JSON.parse(fs.readFileSync(arquivo(), 'utf8'));
    return { textos: r.textos || {}, uso: r.uso || {} };
  } catch (_) {
    return { textos: {}, uso: {} };
  }
}

const chave = (texto) => String(texto || '').replace(/\s+/g, ' ').trim();

// Traducao guardada, ou o proprio texto.
function traduzido(texto, guardadas) {
  const t = (guardadas || lerTraducoes()).textos;
  return t[chave(texto)] || texto;
}

// Traduz o que ainda nao tem traducao, dentro do limite do dia. Devolve
// quantos titulos foram traduzidos agora.
async function traduzirPendentes(textos, de, buscar, agora) {
  const dados = lerTraducoes();
  const dia = (agora || new Date()).toISOString().slice(0, 10);
  let usados = dados.uso[dia] || 0;
  let feitos = 0;
  const pendentes = [...new Set((textos || []).map(chave).filter(Boolean))].filter((t) => !dados.textos[t] && t.length <= MAXIMO_POR_TITULO);
  for (const texto of pendentes) {
    if (usados + texto.length > LIMITE_DIARIO) break;
    try {
      const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(texto)}&langpair=${de || 'es'}|pt-BR`;
      const res = await (buscar || fetch)(url, { signal: AbortSignal.timeout(15000) });
      usados += texto.length;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const r = await res.json();
      const pt = r && r.responseData && r.responseData.translatedText;
      // A API avisa limite e erros no proprio texto, em maiusculas.
      if (Number(r.responseStatus) !== 200 || !pt || /MYMEMORY WARNING|QUERY LENGTH LIMIT/i.test(pt)) break;
      dados.textos[texto] = pt.trim();
      feitos += 1;
    } catch (err) {
      log(`traducao: ${err.message}`);
      break;
    }
  }
  if (feitos || usados !== (dados.uso[dia] || 0)) {
    dados.uso = { [dia]: usados };
    fs.mkdirSync(path.dirname(arquivo()), { recursive: true });
    fs.writeFileSync(arquivo(), JSON.stringify(dados), 'utf8');
  }
  return feitos;
}

module.exports = { lerTraducoes, traduzido, traduzirPendentes };
