'use strict';

/*
 * Cliente da API do Mercado Livre: credenciais, token e chamadas GET.
 *
 * O Client ID e o Client Secret chegam por variaveis de ambiente, preenchidas
 * pela tela de configuracao da extensao. O access token e gerado pelo fluxo
 * client_credentials e renovado sozinho.
 */

const SERVER_NAME = 'conecta-hub-sourcing';
const SITE = 'MLB';
const DEFAULT_API = 'https://api.mercadolibre.com';
const TIMEOUT_MS = 15000;
const ESPERA_429_MS = 1500;

function log(msg) {
  process.stderr.write(`[${SERVER_NAME}] ${msg}\n`);
}

function cleanEnv(value) {
  const v = (value || '').trim();
  // Se a extensao ainda nao foi configurada, o Claude Desktop pode repassar
  // o marcador literal "${user_config...}"; isso conta como vazio.
  return v.startsWith('${') ? '' : v;
}

function resolveApiBase() {
  const override = cleanEnv(process.env.MELI_API_BASE);
  if (!override) return DEFAULT_API;
  // A troca de endereco existe so para testes locais. Qualquer outro destino
  // e ignorado, para o Client Secret nunca sair para um servidor de terceiros.
  try {
    const u = new URL(override);
    if (u.hostname === '127.0.0.1' || u.hostname === 'localhost') {
      return override.replace(/\/+$/, '');
    }
  } catch (_) { /* cai no padrao */ }
  log('MELI_API_BASE ignorado: so e aceito endereco local.');
  return DEFAULT_API;
}

const API = resolveApiBase();
// O Client ID da aplicacao Conecta Hub Sourcing nao e segredo e vai embutido,
// para que a tela de configuracao tenha um unico campo (o Client Secret).
// MELI_CLIENT_ID so substitui o padrao se for numerico.
const DEFAULT_CLIENT_ID = '8315929148272725';
const ENV_CLIENT_ID = cleanEnv(process.env.MELI_CLIENT_ID);
const CLIENT_ID = /^\d+$/.test(ENV_CLIENT_ID) ? ENV_CLIENT_ID : DEFAULT_CLIENT_ID;
const CLIENT_SECRET = cleanEnv(process.env.MELI_CLIENT_SECRET);

class ToolError extends Error {}

function credentialsConfigured() {
  return Boolean(CLIENT_ID && CLIENT_SECRET);
}

/* ------------------------------------------------------------------ */
/* Autenticacao                                                        */
/* ------------------------------------------------------------------ */

let token = null;
let tokenExpiresAt = 0;
let tokenInFlight = null;

async function fetchToken() {
  if (!credentialsConfigured()) {
    throw new ToolError(
      'O Client Secret nao esta configurado. No Claude Desktop, abra ' +
      'Settings > Extensions > Conecta Hub Sourcing > Configure e cole a chave no campo Client Secret.'
    );
  }
  let res;
  try {
    res = await fetch(`${API}/oauth/token`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
      }).toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new ToolError(`Nao consegui falar com a API do Mercado Livre para gerar o token (${describeNetworkError(err)}).`);
  }
  const body = await readJson(res);
  if (!res.ok || !body || !body.access_token) {
    const detail = (body && (body.error_description || body.message || body.error)) || `HTTP ${res.status}`;
    throw new ToolError(
      `O Mercado Livre recusou as credenciais (${detail}). Confira o Client Secret ` +
      'na configuracao da extensao; se ele foi renovado no DevCenter, atualize-o aqui. ' +
      describeCredentials()
    );
  }
  token = body.access_token;
  const ttl = Number(body.expires_in) > 0 ? Number(body.expires_in) : 21600;
  // Renova 5 minutos antes do vencimento.
  tokenExpiresAt = Date.now() + Math.max(60, ttl - 300) * 1000;
  return token;
}

// Descreve o que a extensao recebeu, sem revelar a chave: so o tamanho e o
// formato. O Client ID nao e segredo, mas so e mostrado se for numerico, para
// o caso de a chave ter sido colada no campo errado.
function describeCredentials() {
  const idPart = /^\d+$/.test(CLIENT_ID)
    ? `Client ID "${CLIENT_ID}" (${CLIENT_ID.length} digitos)`
    : `Client ID com ${CLIENT_ID.length} caracteres e que nao e so numeros (o Client ID tem apenas digitos)`;
  const odd = /[^A-Za-z0-9]/.test(CLIENT_SECRET) ? ', com espaco ou simbolo no meio' : '';
  return `Recebido pela extensao: ${idPart}; Client Secret com ${CLIENT_SECRET.length} caracteres${odd}. ` +
    'A chave do Mercado Livre costuma ter 32 letras e numeros.';
}

function getToken(force) {
  if (!force && token && Date.now() < tokenExpiresAt) return Promise.resolve(token);
  if (!tokenInFlight) {
    tokenInFlight = fetchToken().finally(() => { tokenInFlight = null; });
  }
  return tokenInFlight;
}

/* ------------------------------------------------------------------ */
/* Chamadas a API                                                      */
/* ------------------------------------------------------------------ */

function describeNetworkError(err) {
  if (err && (err.name === 'TimeoutError' || err.name === 'AbortError')) return 'tempo esgotado';
  const cause = err && err.cause && (err.cause.code || err.cause.message);
  return cause || (err && err.message) || 'erro de rede';
}

async function readJson(res) {
  const text = await res.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch (_) { return { message: text.slice(0, 300) }; }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function apiGet(path) {
  let lastStatus = 0;
  let renovou = false;
  let esperas = 0;
  for (;;) {
    const bearer = await getToken(renovou && lastStatus === 401);
    let res;
    try {
      res = await fetch(`${API}${path}`, {
        headers: { authorization: `Bearer ${bearer}`, accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      throw new ToolError(`Falha de rede ao consultar ${path} (${describeNetworkError(err)}).`);
    }
    lastStatus = res.status;
    // Token vencido ou revogado: gera outro e tenta uma unica vez.
    if (res.status === 401 && !renovou) { renovou = true; continue; }
    // Limite de chamadas: a mineracao faz muitas consultas seguidas, entao
    // espera um pouco e repete ate duas vezes antes de desistir.
    if (res.status === 429 && esperas < 2) {
      esperas += 1;
      await sleep(ESPERA_429_MS * esperas);
      continue;
    }
    const body = await readJson(res);
    if (res.ok) return body;
    const detail = res.status === 401
      ? 'token recusado mesmo apos renovar'
      : (body && (body.message || body.error_description || body.error)) || 'sem detalhe';
    const err = new ToolError(explainStatus(res.status, path, detail));
    err.status = res.status;
    throw err;
  }
}

function explainStatus(status, path, detail) {
  const base = `A API respondeu HTTP ${status} em ${path} (${detail}).`;
  if (status === 403) return `${base} Este recurso nao esta liberado para esta aplicacao ou para este tipo de token.`;
  if (status === 404) return `${base} O identificador nao existe ou nao tem dados para o Brasil.`;
  if (status === 429) return `${base} Limite de chamadas atingido; aguarde alguns minutos antes de repetir.`;
  return base;
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next;
      next += 1;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

module.exports = {
  SERVER_NAME,
  SITE,
  ToolError,
  apiGet,
  cleanEnv,
  credentialsConfigured,
  log,
  mapLimit,
};
