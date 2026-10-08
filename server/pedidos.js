'use strict';

/*
 * Fila de pedidos para o Claude.
 *
 * Algumas integracoes so o Claude alcanca: o JoomPulse (dados da Shopee e
 * estimativas de venda) e o Accio Work (cotacao no Alibaba, pelo controle de
 * tela). A interface grava aqui o que o usuario quer; o Claude le os pedidos
 * pendentes, executa e marca como concluidos com o resultado.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { ToolError, cleanEnv } = require('./meli');

const TIPOS = {
  cotacao: 'Cotar no Alibaba (Accio) os produtos de um pacote',
  shopee: 'Atualizar os produtos da Shopee (JoomPulse)',
  vendas: 'Buscar estimativas de venda do dia no Mercado Livre (JoomPulse)',
  livre: 'Pedido em texto livre',
};
const MAX_PEDIDOS = 200;
const MAX_TEXTO = 1000;

function arquivoDePedidos() {
  const base = cleanEnv(process.env.CONECTA_HUB_SAIDA);
  return path.join(base ? path.dirname(base) : path.join(os.homedir(), 'ConectaHubSourcing'), 'pedidos.json');
}

function lerPedidos() {
  try {
    const p = JSON.parse(fs.readFileSync(arquivoDePedidos(), 'utf8'));
    return Array.isArray(p) ? p : [];
  } catch (_) {
    return [];
  }
}

function gravar(pedidos) {
  fs.mkdirSync(path.dirname(arquivoDePedidos()), { recursive: true });
  fs.writeFileSync(arquivoDePedidos(), JSON.stringify(pedidos.slice(0, MAX_PEDIDOS), null, 2), 'utf8');
}

function texto(v) {
  return String(v === undefined || v === null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, MAX_TEXTO);
}

function criarPedido(entrada) {
  const e = entrada || {};
  if (!Object.prototype.hasOwnProperty.call(TIPOS, e.tipo)) throw new ToolError(`tipo de pedido invalido: "${e.tipo}".`);
  const alvo = texto(e.alvo);
  const detalhe = texto(e.texto);
  if (e.tipo === 'cotacao' && !/^\d{8}-\d{6}-MLB\d{1,12}$/.test(alvo)) throw new ToolError('Para cotacao, informe em "alvo" o id do pacote.');
  if (e.tipo === 'livre' && !detalhe) throw new ToolError('Escreva o pedido em "texto".');
  const pedidos = lerPedidos();
  // O mesmo pedido pendente nao entra duas vezes.
  const repetido = pedidos.find((p) => p.situacao === 'pendente' && p.tipo === e.tipo && p.alvo === alvo && p.texto === detalhe);
  if (repetido) return repetido;
  const agora = new Date().toISOString();
  const pedido = { id: `p${Date.now().toString(36)}`, tipo: e.tipo, alvo, texto: detalhe, situacao: 'pendente', criado_em: agora };
  pedidos.unshift(pedido);
  gravar(pedidos);
  return pedido;
}

// O Claude chama ao terminar: situacao "concluido" ou "falhou", com um resumo.
function concluirPedido(id, situacao, resultado) {
  if (!['concluido', 'falhou'].includes(situacao)) throw new ToolError('situacao deve ser "concluido" ou "falhou".');
  const pedidos = lerPedidos();
  const pedido = pedidos.find((p) => p.id === id);
  if (!pedido) throw new ToolError(`pedido nao encontrado: "${id}".`);
  pedido.situacao = situacao;
  pedido.resultado = texto(resultado);
  pedido.concluido_em = new Date().toISOString();
  gravar(pedidos);
  return pedido;
}

module.exports = { TIPOS, concluirPedido, criarPedido, lerPedidos };
