'use strict';

/*
 * Sugestao de NCM para os produtos minerados.
 *
 * A posicao (4 digitos) vem do dicionario de ncm-posicoes.js; os codigos de 8
 * digitos e as descricoes vem da tabela oficial de nomenclatura do Portal
 * Unico Siscomex, baixada uma vez e guardada em cache no computador.
 *
 * A tabela oficial nao traz aliquotas, entao aqui nao ha calculo de imposto.
 * O resultado e ponto de partida para a classificacao, que cabe ao despachante.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { cleanEnv, log } = require('./meli');
const { POSICOES } = require('./ncm-posicoes');

const URL_TABELA = 'https://portalunico.siscomex.gov.br/classif/api/publico/nomenclatura/download/json?perfil=PUBLICO';
const VALIDADE_CACHE_MS = 30 * 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 30000;
const PALAVRAS_NO_INICIO = 8;
const AVISO = 'Sugestao automatica pela descricao do anuncio. Material e funcao mudam a classificacao; confirmar com o despachante.';

const VAZIAS = new Set(['para', 'com', 'sem', 'dos', 'das', 'por', 'kit', 'outros', 'outras', 'que', 'uma', 'tipo', 'cor', 'seus', 'suas', 'igual', 'superior', 'inferior', 'exceto']);

function norm(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function palavras(s) {
  return norm(s).split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !VAZIAS.has(w));
}

// Compara pelo radical, para "tubos" bater com "tubo" e "plasticos" com "plastico".
function radical(w) {
  return w.length > 3 ? w.replace(/(oes|aes)$/, 'ao').replace(/s$/, '') : w;
}

/* ------------------------------------------------------------------ */
/* Tabela oficial                                                      */
/* ------------------------------------------------------------------ */

function arquivoCache() {
  const base = cleanEnv(process.env.CONECTA_HUB_SAIDA);
  return path.join(base ? path.dirname(base) : path.join(os.homedir(), 'ConectaHubSourcing'), 'ncm-siscomex.json');
}

function indexar(cru) {
  const lista = cru && Array.isArray(cru.Nomenclaturas) ? cru.Nomenclaturas : null;
  if (!lista || !lista.length) throw new Error('tabela de NCM em formato inesperado');
  const porDigitos = new Map();
  for (const n of lista) {
    const digitos = String(n.Codigo || '').replace(/\D/g, '');
    if (digitos) porDigitos.set(digitos, String(n.Descricao || '').replace(/^[-\s]+/, '').replace(/:$/, '').trim());
  }
  return { vigencia: cru.Data_Ultima_Atualizacao_NCM, ato: cru.Ato, porDigitos };
}

let tabela = null;

// Le a tabela do arquivo indicado em NCM_TABELA (testes), do cache ou do
// Siscomex. Se o download falhar, um cache vencido ainda serve.
async function carregarTabela() {
  if (tabela) return tabela;
  const local = cleanEnv(process.env.NCM_TABELA);
  if (local) {
    tabela = indexar(JSON.parse(fs.readFileSync(local, 'utf8')));
    return tabela;
  }
  const cache = arquivoCache();
  const idade = fs.existsSync(cache) ? Date.now() - fs.statSync(cache).mtimeMs : Infinity;
  if (idade < VALIDADE_CACHE_MS) {
    try {
      tabela = indexar(JSON.parse(fs.readFileSync(cache, 'utf8')));
      return tabela;
    } catch (_) { /* cache corrompido: baixa de novo */ }
  }
  try {
    const res = await fetch(URL_TABELA, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const texto = await res.text();
    tabela = indexar(JSON.parse(texto));
    fs.mkdirSync(path.dirname(cache), { recursive: true });
    fs.writeFileSync(cache, texto, 'utf8');
    return tabela;
  } catch (err) {
    log(`tabela de NCM: download falhou (${err.message})`);
    if (idade !== Infinity) {
      tabela = indexar(JSON.parse(fs.readFileSync(cache, 'utf8')));
      return tabela;
    }
    throw new Error(`nao foi possivel baixar a tabela de NCM do Siscomex (${err.message})`);
  }
}

function formatar(d) {
  return d.length === 8 ? `${d.slice(0, 4)}.${d.slice(4, 6)}.${d.slice(6)}` : d;
}

function prefixo(d) {
  if (d.length <= 4) return `${d.slice(0, 2)}.${d.slice(2)}`;
  return `${d.slice(0, 4)}.${d.slice(4)}`;
}

// Algumas posicoes nao tem linha propria na tabela; vale a do primeiro codigo dela.
function descricaoDe(t, d) {
  for (let n = d.length; n >= 4; n -= 1) {
    const achou = t.porDigitos.get(d.slice(0, n));
    if (achou) return achou;
  }
  return t.porDigitos.get(`${d.slice(0, 4)}0000`) || '';
}

// Descricoes da posicao ate o codigo, da mais geral para a mais especifica.
function caminho(t, digitos) {
  const partes = [];
  for (let n = 4; n <= digitos.length; n += 1) {
    const d = t.porDigitos.get(digitos.slice(0, n));
    if (d && partes[partes.length - 1] !== d) partes.push(d);
  }
  return partes;
}

/* ------------------------------------------------------------------ */
/* Sugestao                                                            */
/* ------------------------------------------------------------------ */

function posicoesPara(nome) {
  const inicio = norm(nome).split(/\s+/).slice(0, PALAVRAS_NO_INICIO).join(' ');
  const regra = POSICOES.find(([re]) => re.test(inicio));
  return regra ? regra[1] : [];
}

function sugerirNcm(t, nome, extras) {
  const posicoes = posicoesPara(nome);
  if (!posicoes.length) return null;
  const alvo = new Set(palavras(`${nome} ${extras || ''}`).map(radical));
  const candidatos = [];
  for (const posicao of posicoes) {
    for (const [digitos] of t.porDigitos) {
      if (digitos.length !== 8 || !digitos.startsWith(posicao)) continue;
      const partes = caminho(t, digitos);
      // So o que vem abaixo da posicao distingue um codigo do outro.
      // O codigo so entra se as primeiras palavras da sua propria descricao
      // estiverem no anuncio. Uma palavra solta em comum nao basta: "espelho"
      // bateria com "espelhos retrovisores para veiculos".
      const proprias = palavras(partes[partes.length - 1]).map(radical).slice(0, 2);
      let pontos = 0;
      if (partes.length > 1 && proprias.length && proprias.every((w) => alvo.has(w))) {
        const especifico = new Set(palavras(partes.slice(1).join(' ')).map(radical));
        for (const w of especifico) if (alvo.has(w)) pontos += 1;
      }
      candidatos.push({ digitos, partes, pontos });
    }
  }
  if (!candidatos.length) return null;
  // So entra codigo de 8 digitos que tenha palavra em comum com o anuncio.
  // Sem isso a escolha seria um chute, e a sugestao fica so na posicao.
  const comPalavra = candidatos.filter((c) => c.pontos > 0)
    .sort((a, b) => b.pontos - a.pontos || a.digitos.localeCompare(b.digitos));
  // Um unico codigo na posicao nao deixa duvida.
  const escolhidos = candidatos.length === 1 ? candidatos : comPalavra.slice(0, 3);
  return {
    posicao: posicoes.map((p) => ({ codigo: prefixo(p), descricao: descricaoDe(t, p) })),
    sugestoes: escolhidos.map((c) => ({ codigo: formatar(c.digitos), descricao: c.partes.slice(1).join(' > ') || c.partes[0] })),
    codigos_na_posicao: candidatos.length,
    base: escolhidos.length ? 'posicao pelo tipo de produto; codigo pelas palavras do anuncio' : 'so a posicao, pelo tipo de produto',
    aviso: AVISO,
  };
}

// Anota a sugestao em cada produto. Nunca derruba a mineracao: sem tabela,
// devolve o motivo e os produtos ficam sem NCM.
async function anotarNcm(produtos) {
  let t;
  try {
    t = await carregarTabela();
  } catch (err) {
    return { disponivel: false, motivo: err.message };
  }
  let com = 0;
  for (const p of produtos) {
    if (!p.nome) continue;
    const material = (p.atributos || []).filter((a) => /material|composi/i.test(a.nome)).map((a) => a.valor).join(' ');
    const s = sugerirNcm(t, p.nome, material);
    if (s) { p.ncm = s; com += 1; } else delete p.ncm;
  }
  return { disponivel: true, vigencia: t.vigencia, ato: t.ato, produtos_com_sugestao: com };
}

module.exports = { anotarNcm, carregarTabela, sugerirNcm };
