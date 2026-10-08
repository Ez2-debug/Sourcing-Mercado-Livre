#!/usr/bin/env node
'use strict';

/*
 * Atalhos para o Claude Code operar as integracoes que so ele alcanca.
 *
 *   node scripts/claude.js pedidos                         lista os pedidos pendentes
 *   node scripts/claude.js concluir <id> <situacao> <texto>  situacao: concluido | falhou
 *   node scripts/claude.js shopee-consulta                 a consulta para query_cubejs_shopee
 *   node scripts/claude.js shopee-gravar <arquivo.json>    grava a resposta do JoomPulse
 *   node scripts/claude.js cotacao <id do pacote>          gera as duas planilhas da cotacao
 */

const fs = require('node:fs');
const path = require('node:path');

const servidor = (nome) => require(path.join(__dirname, '..', 'server', nome));

async function main() {
  const [comando, ...resto] = process.argv.slice(2);
  if (comando === 'pedidos') {
    return servidor('pedidos').lerPedidos().filter((p) => p.situacao === 'pendente');
  }
  if (comando === 'concluir') {
    return servidor('pedidos').concluirPedido(resto[0], resto[1], resto.slice(2).join(' '));
  }
  if (comando === 'shopee-consulta') {
    return JSON.parse(servidor('shopee').consultaShopee());
  }
  if (comando === 'shopee-gravar') {
    return servidor('shopee').gravarShopee(fs.readFileSync(resto[0], 'utf8'));
  }
  if (comando === 'cotacao') {
    return servidor('cotacao').planilhasDaCotacao(servidor('saida').carregarMineracao(resto[0]));
  }
  throw new Error('comando desconhecido; veja o cabecalho de scripts/claude.js');
}

main().then(
  (r) => { process.stdout.write(JSON.stringify(r, null, 2) + '\n'); },
  (err) => { process.stderr.write(err.message + '\n'); process.exit(1); },
);
