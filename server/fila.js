'use strict';

/*
 * Fila de categorias para a mineracao automatica.
 *
 * A fila e uma lista de categorias gravada no computador. Cada execucao de
 * minerar_proxima pega a categoria que esta ha mais tempo sem ser minerada,
 * de modo que uma tarefa agendada simples ("minere a proxima") percorre a
 * lista inteira em rodizio, sem precisar lembrar onde parou.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { ToolError, apiGet, cleanEnv, mapLimit } = require('./meli');
const { categoryId } = require('./catalogo');

const MAX_CATEGORIAS = 60;

function arquivoDaFila() {
  const base = cleanEnv(process.env.CONECTA_HUB_SAIDA);
  return path.join(base ? path.dirname(base) : path.join(os.homedir(), 'ConectaHubSourcing'), 'fila.json');
}

function lerFila() {
  try {
    const f = JSON.parse(fs.readFileSync(arquivoDaFila(), 'utf8'));
    if (f && Array.isArray(f.categorias)) return f;
  } catch (_) { /* sem fila ainda */ }
  return { categorias: [], enviar_para_accio: false };
}

// Confere cada categoria na API e guarda o nome e o caminho oficiais.
async function definirFila(entrada) {
  const lista = Array.isArray(entrada.categorias) ? entrada.categorias : [];
  if (!lista.length) throw new ToolError('Informe ao menos uma categoria em "categorias".');
  if (lista.length > MAX_CATEGORIAS) throw new ToolError(`A fila aceita ate ${MAX_CATEGORIAS} categorias; vieram ${lista.length}.`);
  const vistos = new Set();
  const pedidos = [];
  for (const c of lista) {
    const id = categoryId(c && c.categoria_id, true);
    if (vistos.has(id)) continue;
    vistos.add(id);
    const origem = String((c && c.origem) || '').trim().slice(0, 200);
    pedidos.push({ id, origem });
  }
  const invalidas = [];
  const categorias = (await mapLimit(pedidos, 4, async (p) => {
    try {
      const c = await apiGet(`/categories/${p.id}`);
      const caminho = Array.isArray(c.path_from_root) && c.path_from_root.length ? c.path_from_root.map((x) => x.name).join(' > ') : c.name;
      return { id: p.id, nome: c.name, caminho, origem: p.origem || undefined };
    } catch (err) {
      if (err.status !== 404 && err.status !== 400) throw err;
      invalidas.push(p.id);
      return null;
    }
  })).filter(Boolean);
  if (!categorias.length) throw new ToolError(`Nenhuma das categorias existe no Mercado Livre: ${invalidas.join(', ')}.`);
  const fila = {
    categorias,
    enviar_para_accio: entrada.enviar_para_accio === true,
    atualizado_em: new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(arquivoDaFila()), { recursive: true });
  fs.writeFileSync(arquivoDaFila(), JSON.stringify(fila, null, 2), 'utf8');
  return { ...fila, total: categorias.length, categorias_inexistentes: invalidas };
}

// Ultima mineracao de cada categoria, a partir dos ids gravados
// (AAAAMMDD-HHMMSS-<categoria>, do mais recente para o mais antigo).
function ultimaPorCategoria(idsDasMineracoes) {
  const ultima = new Map();
  for (const id of idsDasMineracoes) {
    const cat = id.slice(16);
    if (!ultima.has(cat)) ultima.set(cat, id);
  }
  return ultima;
}

// A fila com a ultima mineracao de cada categoria, na ordem em que serao
// mineradas: primeiro as que nunca foram, depois as mais antigas.
function ordenarFila(fila, idsDasMineracoes) {
  const ultima = ultimaPorCategoria(idsDasMineracoes);
  return fila.categorias
    .map((c, i) => ({ ...c, ultima_mineracao: ultima.get(c.id) || null, ordem: i }))
    .sort((a, b) => {
      if (!a.ultima_mineracao || !b.ultima_mineracao) {
        return (a.ultima_mineracao ? 1 : 0) - (b.ultima_mineracao ? 1 : 0) || a.ordem - b.ordem;
      }
      return a.ultima_mineracao.localeCompare(b.ultima_mineracao) || a.ordem - b.ordem;
    })
    .map(({ ordem, ...c }) => c);
}

module.exports = { definirFila, lerFila, ordenarFila };
