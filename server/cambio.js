'use strict';

/*
 * Cotacao oficial do dolar (PTAX), do Banco Central do Brasil.
 *
 * API publica, sem chave. Serve para mostrar em reais o preco de anuncio do
 * Alibaba. E so conversao de moeda: nao vira custo de importacao, que depende
 * de frete, impostos e da cotacao do fornecedor.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { cleanEnv } = require('./meli');

const VALIDADE_MS = 6 * 3600 * 1000;
const ORIGEM = 'https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata';

function arquivoDoCambio() {
  const base = cleanEnv(process.env.CONECTA_HUB_SAIDA);
  return path.join(base ? path.dirname(base) : path.join(os.homedir(), 'ConectaHubSourcing'), 'cambio.json');
}

// A ultima cotacao guardada, ou null. Nao acessa a rede.
function cambioGuardado() {
  try {
    const c = JSON.parse(fs.readFileSync(arquivoDoCambio(), 'utf8'));
    return typeof c.venda === 'number' && c.venda > 0 ? c : null;
  } catch (_) {
    return null;
  }
}

const dataBr = (d) => `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}-${d.getFullYear()}`;

// Busca a cotacao mais recente dos ultimos dez dias (cobre fim de semana e
// feriado). Nunca derruba quem chamou: sem rede, devolve a que estiver guardada.
async function atualizarCambio(buscar) {
  const atual = cambioGuardado();
  if (atual && Date.now() - Date.parse(atual.consultado_em) < VALIDADE_MS) return atual;
  const fim = new Date();
  const inicio = new Date(fim.getTime() - 10 * 86400000);
  const url = `${ORIGEM}/CotacaoDolarPeriodo(dataInicial=@i,dataFinalCotacao=@f)?@i='${dataBr(inicio)}'&@f='${dataBr(fim)}'` +
    '&$format=json&$orderby=dataHoraCotacao%20desc&$top=1';
  try {
    const res = await (buscar || fetch)(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return atual;
    const linha = ((await res.json()).value || [])[0];
    if (!linha || typeof linha.cotacaoVenda !== 'number' || !(linha.cotacaoVenda > 0)) return atual;
    const novo = {
      moeda: 'USD',
      venda: linha.cotacaoVenda,
      compra: linha.cotacaoCompra,
      cotado_em: String(linha.dataHoraCotacao).slice(0, 16),
      fonte: 'Banco Central do Brasil, PTAX',
      consultado_em: new Date().toISOString(),
    };
    fs.mkdirSync(path.dirname(arquivoDoCambio()), { recursive: true });
    fs.writeFileSync(arquivoDoCambio(), JSON.stringify(novo, null, 2), 'utf8');
    return novo;
  } catch (_) {
    return atual;
  }
}

module.exports = { atualizarCambio, cambioGuardado };
