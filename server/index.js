#!/usr/bin/env node
'use strict';

/*
 * Conecta Hub Sourcing - servidor MCP (stdio) para a API do Mercado Livre.
 *
 * Sem dependencias externas: usa apenas o Node.js (>= 18) que ja vem com o
 * Claude Desktop. O Client ID e o Client Secret chegam por variaveis de
 * ambiente, preenchidas pela tela de configuracao da extensao. O access token
 * e gerado pelo fluxo client_credentials e renovado sozinho.
 *
 * Nada e escrito em stdout alem das mensagens do protocolo; logs vao em stderr.
 */

const readline = require('node:readline');

const SERVER_NAME = 'conecta-hub-sourcing';
const SERVER_VERSION = '0.3.0';
const SITE = 'MLB';
const DEFAULT_API = 'https://api.mercadolibre.com';
const TIMEOUT_MS = 15000;
const SUPPORTED_PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];

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

function log(msg) {
  process.stderr.write(`[${SERVER_NAME}] ${msg}\n`);
}

class ToolError extends Error {}

/* ------------------------------------------------------------------ */
/* Autenticacao                                                        */
/* ------------------------------------------------------------------ */

let token = null;
let tokenExpiresAt = 0;
let tokenInFlight = null;

async function fetchToken() {
  if (!CLIENT_ID || !CLIENT_SECRET) {
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

async function apiGet(path) {
  let lastStatus = 0;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const bearer = await getToken(attempt > 0);
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
    if (res.status === 401 && attempt === 0) continue;
    const body = await readJson(res);
    if (res.ok) return body;
    const detail = (body && (body.message || body.error_description || body.error)) || 'sem detalhe';
    const err = new ToolError(explainStatus(res.status, path, detail));
    err.status = res.status;
    throw err;
  }
  const err = new ToolError(explainStatus(lastStatus, path, 'token recusado mesmo apos renovar'));
  err.status = lastStatus;
  throw err;
}

function explainStatus(status, path, detail) {
  const base = `A API respondeu HTTP ${status} em ${path} (${detail}).`;
  if (status === 403) return `${base} Este recurso nao esta liberado para esta aplicacao ou para este tipo de token.`;
  if (status === 404) return `${base} O identificador nao existe ou nao tem dados para o Brasil.`;
  if (status === 429) return `${base} Limite de chamadas atingido; aguarde alguns minutos antes de repetir.`;
  return base;
}

/* ------------------------------------------------------------------ */
/* Validacao e formatacao                                              */
/* ------------------------------------------------------------------ */

function categoryId(value, required) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new ToolError('Informe categoria_id (exemplo: MLB1051). Use listar_categorias para ver os codigos.');
    return null;
  }
  const id = String(value).trim().toUpperCase();
  if (!/^MLB\d{1,12}$/.test(id)) {
    throw new ToolError(`categoria_id invalido: "${value}". O formato e MLB seguido de numeros, como MLB1051.`);
  }
  return id;
}

function productId(value) {
  const id = String(value === undefined || value === null ? '' : value).trim().toUpperCase();
  if (!/^MLB[A-Z]{0,2}\d{1,15}$/.test(id)) {
    throw new ToolError(`produto_id invalido: "${value}". Use o id devolvido por mais_vendidos, como MLB54982411.`);
  }
  return id;
}

function pathForProduct(id, type) {
  const t = String(type || '').toUpperCase();
  if (t === 'USER_PRODUCT' || (!t && /^MLBU/.test(id))) return `/user-products/${id}`;
  if (t === 'ITEM') return `/items/${id}`;
  return `/products/${id}`;
}

// Link da pagina publica. Usa o permalink quando a API manda; senao monta
// pelo padrao de enderecos do site (marcado como link_montado).
function publicLink(id, type, permalink) {
  if (permalink) return { link: permalink };
  const t = String(type || '').toUpperCase();
  const digits = String(id).replace(/^MLB[A-Z]*/, '');
  if (t === 'USER_PRODUCT' || (!t && /^MLBU/.test(id))) {
    return { link: `https://www.mercadolivre.com.br/up/${id}`, link_montado: true };
  }
  if (t === 'ITEM') {
    return { link: `https://produto.mercadolivre.com.br/MLB-${digits}-_JM`, link_montado: true };
  }
  return { link: `https://www.mercadolivre.com.br/p/${id}`, link_montado: true };
}

// Procura, na resposta crua, qualquer campo que fale de vendas. Serve para
// mostrar exatamente o que a API entrega, sem estimar nada.
function findSalesFields(obj) {
  const found = {};
  const walk = (value, path, depth) => {
    if (Object.keys(found).length >= 12 || depth > 5 || value === null || typeof value !== 'object') return;
    const entries = Array.isArray(value) ? value.slice(0, 5).map((v, i) => [String(i), v]) : Object.entries(value);
    for (const [k, v] of entries) {
      const p = path ? `${path}.${k}` : k;
      if (/sold|sales|sell_count|vendid|vendas/i.test(k) && (v === null || typeof v !== 'object')) {
        found[p] = v;
      } else {
        walk(v, p, depth + 1);
      }
      if (Object.keys(found).length >= 12) return;
    }
  };
  walk(obj, '', 0);
  return found;
}

const SEM_VENDAS = 'A API nao devolveu nenhum campo de vendas para este registro.';

function brandOf(attributes) {
  if (!Array.isArray(attributes)) return undefined;
  const a = attributes.find((x) => x && x.id === 'BRAND');
  return a ? (a.value_name || (a.values && a.values[0] && a.values[0].name)) : undefined;
}

function summarizeProduct(p, full, id, type) {
  const bb = p.buy_box_winner || {};
  const out = {
    id: p.id || id,
    nome: p.name || p.title,
    marca: brandOf(p.attributes),
    preco: bb.price !== undefined ? bb.price : p.price,
    moeda: bb.currency_id || p.currency_id,
    categoria_id: p.category_id || bb.category_id,
    status: p.status,
    ...publicLink(p.id || id, type, p.permalink),
  };
  const vendas = findSalesFields(p);
  if (Object.keys(vendas).length) out.campos_de_venda = vendas;
  else if (full) out.vendas = SEM_VENDAS;
  if (full) {
    out.familia = p.family_name;
    out.descricao_curta = p.short_description && (p.short_description.content || p.short_description);
    out.imagem = Array.isArray(p.pictures) && p.pictures[0] ? (p.pictures[0].url || p.pictures[0].secure_url) : undefined;
    out.destaques = Array.isArray(p.main_features)
      ? p.main_features.slice(0, 8).map((f) => f && (f.text || f)).filter(Boolean)
      : undefined;
    out.atributos = Array.isArray(p.attributes)
      ? p.attributes.slice(0, 20).map((a) => ({ nome: a.name || a.id, valor: a.value_name })).filter((a) => a.valor)
      : undefined;
  }
  // Se a resposta veio em formato inesperado, mostra quais campos existem
  // para que o formato real possa ser mapeado.
  if (!out.nome) out.campos_disponiveis = Object.keys(p).slice(0, 40);
  for (const k of Object.keys(out)) if (out[k] === undefined || out[k] === null) delete out[k];
  return out;
}

// Le os anuncios de um produto pagina por pagina (paging.total, offset, limit)
// e devolve a quantidade informada pela API e o menor preco entre os lidos.
// Se qualquer pagina falhar, o erro sobe: um minimo parcial nao e informado.
const ANUNCIOS_POR_PAGINA = 100;
const MAX_PAGINAS_ANUNCIOS = 20;

async function resumoDeAnuncios(id) {
  let total = null;
  let lidos = 0;
  let menor = null;
  for (let pagina = 0; pagina < MAX_PAGINAS_ANUNCIOS; pagina += 1) {
    const data = await apiGet(`/products/${id}/items?limit=${ANUNCIOS_POR_PAGINA}&offset=${lidos}`);
    const paged = data && !Array.isArray(data) && data.paging && Number.isFinite(Number(data.paging.total));
    const list = Array.isArray(data) ? data : (data && Array.isArray(data.results) ? data.results : []);
    if (paged) total = Number(data.paging.total);
    lidos += list.length;
    for (const it of list) {
      const preco = it && it.price;
      if (typeof preco !== 'number' || !Number.isFinite(preco) || preco <= 0) continue;
      if (!menor || preco < menor.price) menor = it;
    }
    // Sem paging, a resposta e a lista inteira; com paging, para no total ou numa pagina vazia.
    if (!paged || !list.length || lidos >= total) break;
  }
  const out = { quantidade_anuncios: total === null ? lidos : total };
  if (lidos < out.quantidade_anuncios) out.anuncios_lidos = lidos;
  if (menor) {
    const itemId = menor.item_id || menor.id;
    out.menor_preco = {
      valor: menor.price,
      moeda: menor.currency_id,
      anuncio_id: itemId,
      ...(itemId ? publicLink(itemId, 'ITEM', menor.permalink) : {}),
    };
    for (const k of Object.keys(out.menor_preco)) if (out.menor_preco[k] === undefined) delete out.menor_preco[k];
  }
  return out;
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

/* ------------------------------------------------------------------ */
/* Ferramentas                                                         */
/* ------------------------------------------------------------------ */

const AVISO_USO =
  'Dado exibido como fornecido pela API do Mercado Livre. A API nao informa volume de buscas, ' +
  'unidades vendidas nem faturamento; nao estimar esses numeros a partir da posicao.';

const TOOLS = [
  {
    name: 'listar_categorias',
    description:
      'Lista as categorias principais do Mercado Livre Brasil com seus codigos (MLB...). ' +
      'Use primeiro para descobrir o categoria_id das outras ferramentas.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    async run() {
      const data = await apiGet(`/sites/${SITE}/categories`);
      const list = Array.isArray(data) ? data : [];
      return { total: list.length, categorias: list.map((c) => ({ id: c.id, nome: c.name })) };
    },
  },
  {
    name: 'detalhar_categoria',
    description:
      'Mostra o caminho de uma categoria e suas subcategorias com codigos. ' +
      'Use para descer de uma categoria ampla ate um nicho antes de pedir tendencias ou mais vendidos.',
    inputSchema: {
      type: 'object',
      properties: { categoria_id: { type: 'string', description: 'Codigo da categoria, por exemplo MLB1051.' } },
      required: ['categoria_id'],
      additionalProperties: false,
    },
    async run(args) {
      const id = categoryId(args.categoria_id, true);
      const c = await apiGet(`/categories/${id}`);
      return {
        id: c.id,
        nome: c.name,
        caminho: Array.isArray(c.path_from_root) ? c.path_from_root.map((p) => ({ id: p.id, nome: p.name })) : [],
        subcategorias: Array.isArray(c.children_categories)
          ? c.children_categories.map((s) => ({ id: s.id, nome: s.name }))
          : [],
      };
    },
  },
  {
    name: 'tendencias',
    description:
      'Termos de busca em alta no Mercado Livre Brasil na ultima semana (ate 50), em ordem de relevancia. ' +
      'Sem categoria_id traz o ranking nacional; com categoria_id traz o da categoria. ' +
      'Devolve apenas o termo e o link da listagem: nao ha volume nem percentual de crescimento.',
    inputSchema: {
      type: 'object',
      properties: {
        categoria_id: { type: 'string', description: 'Opcional. Codigo da categoria, por exemplo MLB1051.' },
      },
      additionalProperties: false,
    },
    async run(args) {
      const id = categoryId(args.categoria_id, false);
      const data = await apiGet(id ? `/trends/${SITE}/${id}` : `/trends/${SITE}`);
      const list = Array.isArray(data) ? data : [];
      return {
        escopo: id ? `categoria ${id}` : 'Brasil (todas as categorias)',
        atualizacao: 'semanal',
        total: list.length,
        termos: list.map((t, i) => ({ posicao: i + 1, termo: t.keyword, link: t.url })),
        aviso: AVISO_USO,
      };
    },
  },
  {
    name: 'mais_vendidos',
    description:
      'Ranking dos 20 produtos mais vendidos de uma categoria do Mercado Livre Brasil. ' +
      'Cada item vem com o link da pagina do produto. Por padrao busca tambem nome e marca e, nos itens do tipo PRODUCT, ' +
      'a quantidade de anuncios e o menor preco entre todos os anuncios (com o anuncio e o link). ' +
      'Devolve a posicao no ranking, nunca a quantidade vendida.',
    inputSchema: {
      type: 'object',
      properties: {
        categoria_id: { type: 'string', description: 'Codigo da categoria, por exemplo MLB1051.' },
        detalhar: {
          type: 'boolean',
          description: 'Padrao true. Com false devolve so id, posicao e tipo, mais rapido.',
        },
      },
      required: ['categoria_id'],
      additionalProperties: false,
    },
    async run(args) {
      const id = categoryId(args.categoria_id, true);
      const detalhar = args.detalhar !== false;
      const data = await apiGet(`/highlights/${SITE}/category/${id}`);
      const content = data && Array.isArray(data.content) ? data.content : [];
      // O link vai em todos os itens, mesmo quando o detalhe nao e buscado ou falha.
      let itens = content.map((c) => ({ posicao: c.position, id: c.id, tipo: c.type, ...publicLink(c.id, c.type) }));
      let semDetalhe = 0;
      let produtos = 0;
      let semAnuncios = 0;
      const motivo = (err) => (err && err.status ? `HTTP ${err.status}` : (err && err.message) || 'erro desconhecido');
      if (detalhar && itens.length) {
        // Cada item faz suas chamadas em sequencia (detalhe e paginas de anuncios),
        // entao o total de chamadas simultaneas fica limitado a 4.
        itens = await mapLimit(itens, 4, async (item) => {
          let row;
          try {
            const p = await apiGet(pathForProduct(item.id, item.tipo));
            const s = summarizeProduct(p || {}, false, item.id, item.tipo);
            delete s.id;
            row = { posicao: item.posicao, id: item.id, tipo: item.tipo, ...s };
          } catch (err) {
            semDetalhe += 1;
            row = { ...item, detalhe_indisponivel: motivo(err) };
          }
          if (String(item.tipo || '').toUpperCase() === 'PRODUCT') {
            produtos += 1;
            try {
              Object.assign(row, await resumoDeAnuncios(item.id));
            } catch (err) {
              semAnuncios += 1;
              row.anuncios_indisponivel = motivo(err);
            }
          }
          return row;
        });
      }
      const out = { categoria_id: id, total: itens.length, itens, aviso: AVISO_USO };
      const obs = [];
      if (semDetalhe) {
        obs.push(`${semDetalhe} de ${itens.length} itens vieram sem nome e marca porque a consulta de detalhe falhou.`);
      }
      if (semAnuncios) {
        obs.push(`${semAnuncios} de ${produtos} itens do tipo PRODUCT vieram sem quantidade e menor preco porque a consulta de anuncios falhou.`);
      }
      if (itens.some((i) => i.anuncios_lidos !== undefined)) {
        obs.push(`Em itens com anuncios_lidos, a API informou mais anuncios do que o limite de ${MAX_PAGINAS_ANUNCIOS * ANUNCIOS_POR_PAGINA} lidos; o menor preco considera so os lidos.`);
      }
      if (obs.length) out.observacao = obs.join(' ');
      return out;
    },
  },
  {
    name: 'detalhar_produto',
    description:
      'Dados de um produto do catalogo do Mercado Livre a partir do id devolvido por mais_vendidos: ' +
      'link, nome, marca, preco de referencia, categoria, destaques e atributos. Informa se a API devolveu algum campo de vendas.',
    inputSchema: {
      type: 'object',
      properties: {
        produto_id: { type: 'string', description: 'Id do produto, por exemplo MLB54982411.' },
        tipo: {
          type: 'string',
          enum: ['PRODUCT', 'USER_PRODUCT', 'ITEM'],
          description: 'Opcional. O campo tipo devolvido por mais_vendidos; padrao PRODUCT.',
        },
      },
      required: ['produto_id'],
      additionalProperties: false,
    },
    async run(args) {
      const id = productId(args.produto_id);
      const p = await apiGet(pathForProduct(id, args.tipo));
      return summarizeProduct(p || {}, true, id, args.tipo);
    },
  },
  {
    name: 'anuncios_do_produto',
    description:
      'Lista os anuncios (ofertas de vendedores) de um produto do catalogo, com preco, vendedor e link de cada anuncio. ' +
      'Mostra tambem qualquer campo de vendas que a API devolver; se nao houver, informa que nao veio.',
    inputSchema: {
      type: 'object',
      properties: {
        produto_id: { type: 'string', description: 'Id do produto de catalogo, por exemplo MLB54982411.' },
      },
      required: ['produto_id'],
      additionalProperties: false,
    },
    async run(args) {
      const id = productId(args.produto_id);
      const data = await apiGet(`/products/${id}/items`);
      const list = Array.isArray(data) ? data : (data && Array.isArray(data.results) ? data.results : []);
      const anuncios = list.slice(0, 30).map((it) => {
        const itemId = it.item_id || it.id;
        const row = {
          anuncio_id: itemId,
          preco: it.price,
          moeda: it.currency_id,
          vendedor_id: it.seller_id,
          loja_oficial_id: it.official_store_id || undefined,
          frete_gratis: it.shipping ? it.shipping.free_shipping : undefined,
          condicao: it.condition,
          ...(itemId ? publicLink(itemId, 'ITEM', it.permalink) : {}),
        };
        const vendas = findSalesFields(it);
        if (Object.keys(vendas).length) row.campos_de_venda = vendas;
        for (const k of Object.keys(row)) if (row[k] === undefined || row[k] === null) delete row[k];
        return row;
      });
      const out = {
        produto_id: id,
        ...publicLink(id, 'PRODUCT'),
        total_devolvido: list.length,
        anuncios,
      };
      if (!anuncios.some((a) => a.campos_de_venda)) out.vendas = SEM_VENDAS;
      if (!list.length && data && typeof data === 'object') out.campos_disponiveis = Object.keys(data).slice(0, 40);
      return out;
    },
  },
  {
    name: 'consulta_api',
    description:
      'Consulta de diagnostico: faz um GET em um caminho da API do Mercado Livre e devolve a resposta crua (cortada se for longa). ' +
      'Use para conferir quais campos um recurso realmente traz. So aceita recursos de catalogo e mercado: ' +
      '/products, /items, /user-products, /sites/MLB, /categories, /trends, /highlights, /domains.',
    inputSchema: {
      type: 'object',
      properties: {
        caminho: { type: 'string', description: 'Caminho comecando com /, por exemplo /products/MLB54982411.' },
      },
      required: ['caminho'],
      additionalProperties: false,
    },
    async run(args) {
      const caminho = String(args.caminho === undefined || args.caminho === null ? '' : args.caminho).trim();
      const allowed = ['/products', '/items', '/user-products', `/sites/${SITE}`, '/categories', '/trends', '/highlights', '/domains'];
      const pathOnly = caminho.split('?')[0];
      const okShape = /^\/[A-Za-z0-9_\-/.,:%?=&$]*$/.test(caminho) && !caminho.includes('..') && !caminho.includes('//');
      const okPrefix = allowed.some((p) => pathOnly === p || pathOnly.startsWith(`${p}/`));
      if (!okShape || !okPrefix) {
        throw new ToolError(`Caminho nao permitido: "${caminho}". Use um destes inicios: ${allowed.join(', ')}.`);
      }
      const data = await apiGet(caminho);
      const text = JSON.stringify(data, null, 1);
      const LIMITE = 15000;
      if (text.length <= LIMITE) return { caminho, resposta: data };
      return { caminho, truncado: true, tamanho_total: text.length, resposta_texto: text.slice(0, LIMITE) };
    },
  },
];

const INSTRUCTIONS = [
  'Ferramentas de consulta ao Mercado Livre Brasil para apoiar sourcing e importacao (Conecta Hub).',
  'Fluxo usual: listar_categorias -> detalhar_categoria -> tendencias e mais_vendidos -> detalhar_produto -> anuncios_do_produto.',
  'Sempre mostrar o link de cada produto ou anuncio citado. Links com link_montado=true foram montados pelo padrao do site e podem nao abrir.',
  'Regras ao apresentar os dados:',
  '1. A API devolve ordem (posicao), nao quantidade. Nao inventar nem estimar unidades vendidas, faturamento, conversao ou giro. Se o usuario pedir dados de vendas, mostrar apenas o que vier em campos_de_venda; se nao vier nada, dizer que a API nao informa.',
  '2. Os termos de uso do Mercado Livre exigem autorizacao para publicar estatisticas derivadas (vendas, preco medio por categoria, taxas de conversao). Exibir o ranking como veio e indicar a data da consulta.',
  '3. Ao sugerir produtos para importacao, sinalizar termos que sao marca registrada e produtos regulados ou proibidos no Brasil (por exemplo cigarros eletronicos, medicamentos, anabolizantes, peptideos), em vez de recomenda-los.',
].join('\n');

/* ------------------------------------------------------------------ */
/* Protocolo MCP sobre stdio (JSON-RPC, uma mensagem por linha)        */
/* ------------------------------------------------------------------ */

function send(msg) {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

function reply(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function replyError(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

async function handle(msg) {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg) || msg.jsonrpc !== '2.0') return;
  const hasId = msg.id !== undefined && msg.id !== null;
  if (typeof msg.method !== 'string') return; // resposta a algo que nao pedimos

  switch (msg.method) {
    case 'initialize': {
      const asked = msg.params && msg.params.protocolVersion;
      reply(msg.id, {
        protocolVersion: SUPPORTED_PROTOCOLS.includes(asked) ? asked : SUPPORTED_PROTOCOLS[0],
        capabilities: { tools: {} },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
        instructions: INSTRUCTIONS,
      });
      return;
    }
    case 'ping':
      if (hasId) reply(msg.id, {});
      return;
    case 'tools/list':
      reply(msg.id, {
        tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
      });
      return;
    case 'tools/call': {
      const params = msg.params || {};
      const tool = TOOLS.find((t) => t.name === params.name);
      if (!tool) {
        replyError(msg.id, -32602, `Ferramenta desconhecida: ${params.name}`);
        return;
      }
      try {
        const args = params.arguments && typeof params.arguments === 'object' ? params.arguments : {};
        const result = await tool.run(args);
        reply(msg.id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
      } catch (err) {
        const text = err instanceof ToolError ? err.message : `Erro inesperado: ${err && err.message}`;
        if (!(err instanceof ToolError)) log(err && err.stack ? err.stack : String(err));
        reply(msg.id, { content: [{ type: 'text', text }], isError: true });
      }
      return;
    }
    case 'resources/list':
      if (hasId) reply(msg.id, { resources: [] });
      return;
    case 'prompts/list':
      if (hasId) reply(msg.id, { prompts: [] });
      return;
    default:
      // Notificacoes (sem id) sao ignoradas; pedidos desconhecidos recebem erro.
      if (hasId) replyError(msg.id, -32601, `Metodo nao suportado: ${msg.method}`);
  }
}

function main() {
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

  rl.on('line', (line) => {
    const text = line.trim();
    if (!text) return;
    let msg;
    try {
      msg = JSON.parse(text);
    } catch (_) {
      replyError(null, -32700, 'JSON invalido');
      return;
    }
    handle(msg).catch((err) => log(`falha ao tratar mensagem: ${err && err.message}`));
  });
  // Quando o stdin fecha, o processo termina sozinho depois que as respostas
  // pendentes saem. Nao usar process.exit: no Windows (Node 24), sair a forca
  // com conexoes HTTP abertas aborta o processo com 0xC0000409.

  log(`iniciado (credenciais ${CLIENT_ID && CLIENT_SECRET ? 'configuradas' : 'ausentes'})`);
}

main();
