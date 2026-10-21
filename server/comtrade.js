'use strict';

/*
 * Importacoes de um pais por tipo de produto, pela base oficial da ONU
 * (UN Comtrade, API publica de consulta, sem chave).
 *
 * E o indicador de tendencia de compra para paises sem marketplace com API,
 * como o Paraguai: o que o pais passou a importar mais de um ano para o outro.
 * O nivel e a posicao do Sistema Harmonizado (4 digitos, a mesma base da NCM),
 * nao o produto de vitrine.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { cleanEnv } = require('./meli');

const ORIGEM = 'https://comtradeapi.un.org/public/v1/preview/C/A/HS';
const PAISES = { PRY: { codigo: 600, nome: 'Paraguai' } };
// Capitulos de bens de consumo que costumam ir para marketplace.
const CAPITULOS = ['33', '34', '39', '42', '44', '46', '48', '49', '57', '58', '61', '62', '63', '64', '65', '66', '67', '69', '70', '71',
  '73', '76', '82', '83', '84', '85', '87', '90', '91', '92', '94', '95', '96'];
// Nos capitulos mistos (maquinas, metais, veiculos) so as posicoes de bens que
// o consumidor compra em marketplace; o resto do capitulo e industrial.
const POSICOES_DE_CONSUMO = new Set(('3922 3923 3924 3925 3926 4414 4419 4420 4421 4817 4818 4819 4820 4821 4823 4909 4910 6911 6912 6913 6914 ' +
  '7009 7013 7018 7113 7117 7321 7323 7324 7326 7615 8301 8302 8303 8304 8305 8306 8414 8415 8418 8421 8422 8423 8450 8451 8452 8467 8470 ' +
  '8471 8472 8473 8504 8506 8507 8508 8509 8510 8513 8516 8517 8518 8519 8521 8523 8525 8527 8528 8536 8539 8543 8544 8711 8712 8713 8714 ' +
  '8715 9004 9006 9013 9019 9025 9401 9403 9404 9405').split(' '));
const CAPITULOS_INTEIROS = new Set(['33', '34', '42', '46', '57', '61', '62', '63', '64', '65', '66', '67', '82', '91', '92', '95', '96']);
const eDeConsumo = (codigo) => CAPITULOS_INTEIROS.has(codigo.slice(0, 2)) || POSICOES_DE_CONSUMO.has(codigo);
const LOTE = 80;
const VALIDADE_MS = 30 * 86400000;
const PAUSA_MS = 4000;
const VALOR_MINIMO_USD = 200000; // abaixo disso a variacao percentual engana

function arquivo(sigla) {
  const base = cleanEnv(process.env.CONECTA_HUB_SAIDA);
  return path.join(base ? path.dirname(base) : path.join(os.homedir(), 'ConectaHubSourcing'), 'comtrade', `${sigla}.json`);
}

function lerImportacoes(sigla) {
  try {
    return JSON.parse(fs.readFileSync(arquivo(sigla), 'utf8'));
  } catch (_) {
    return null;
  }
}

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

// Posicoes de 4 digitos dos capitulos de consumo, a partir da tabela oficial de NCM.
function posicoesDeConsumo(tabela) {
  const posicoes = [];
  for (const d of tabela.porDigitos.keys()) if (d.length === 4 && CAPITULOS.includes(d.slice(0, 2))) posicoes.push(d);
  return posicoes.sort();
}

async function valoresDoAno(codigoPais, ano, posicoes, buscar, pausa) {
  const valores = new Map();
  for (let i = 0; i < posicoes.length; i += LOTE) {
    const url = `${ORIGEM}?reporterCode=${codigoPais}&period=${ano}&partnerCode=0&flowCode=M&cmdCode=${posicoes.slice(i, i + LOTE).join(',')}`;
    // A consulta publica limita o ritmo: em 429, espera e tenta de novo.
    let res;
    for (let tentativa = 0; tentativa < 5; tentativa += 1) {
      res = await buscar(url, { signal: AbortSignal.timeout(60000) });
      if (res.status !== 429) break;
      await espera(pausa ? 15000 * (tentativa + 1) : 0);
    }
    if (!res.ok) throw new Error(`UN Comtrade respondeu HTTP ${res.status}`);
    const corpo = await res.json();
    for (const linha of corpo.data || []) {
      const valor = typeof linha.primaryValue === 'number' ? linha.primaryValue : linha.cifvalue;
      if (typeof valor === 'number') valores.set(linha.cmdCode, (valores.get(linha.cmdCode) || 0) + valor);
    }
    if (pausa) await espera(pausa);
  }
  return valores;
}

// Compara os dois anos mais recentes com dados. Guarda por 30 dias.
async function atualizarImportacoes(sigla, tabela, buscar, pausa = PAUSA_MS) {
  const atual = lerImportacoes(sigla);
  if (atual && Date.now() - Date.parse(atual.consultado_em) < VALIDADE_MS) return atual;
  const pais = PAISES[sigla];
  if (!pais) throw new Error(`pais sem configuracao: ${sigla}`);
  const pegar = buscar || fetch;
  const posicoes = posicoesDeConsumo(tabela);
  // Os paises publicam com atraso: procura o ano mais recente que ja tem dados.
  let recente = null;
  let anoRecente = null;
  for (let ano = new Date().getFullYear() - 1; ano >= new Date().getFullYear() - 3 && !recente; ano -= 1) {
    const v = await valoresDoAno(pais.codigo, ano, posicoes, pegar, pausa);
    if (v.size) { recente = v; anoRecente = ano; }
  }
  if (!recente) throw new Error('UN Comtrade sem dados recentes para o pais');
  const anterior = await valoresDoAno(pais.codigo, anoRecente - 1, posicoes, pegar, pausa);
  const linhas = [];
  for (const [codigo, valor] of recente) {
    const antes = anterior.get(codigo);
    const descricao = String(tabela.porDigitos.get(codigo) || '').split(';')[0].replace(/\s+/g, ' ').trim();
    linhas.push({
      posicao: `${codigo.slice(0, 2)}.${codigo.slice(2)}`,
      descricao,
      valor_usd: Math.round(valor),
      valor_anterior_usd: antes === undefined ? undefined : Math.round(antes),
      variacao: antes > 0 ? Math.round(((valor - antes) / antes) * 1000) / 1000 : undefined,
    });
  }
  const dados = {
    pais: pais.nome,
    fonte: 'UN Comtrade (ONU), importacoes por posicao do Sistema Harmonizado',
    ano: anoRecente,
    ano_anterior: anoRecente - 1,
    consultado_em: new Date().toISOString(),
    aviso: 'Valor importado pelo pais, em dolares, por tipo de produto (4 digitos do SH). Mostra a direcao da demanda, nao o produto de vitrine nem quem vende.',
    linhas: linhas.sort((a, b) => b.valor_usd - a.valor_usd),
  };
  fs.mkdirSync(path.dirname(arquivo(sigla)), { recursive: true });
  fs.writeFileSync(arquivo(sigla), JSON.stringify(dados, null, 2), 'utf8');
  return dados;
}

// As posicoes que mais cresceram, com valor relevante.
function emAltaNasImportacoes(dados, quantas = 15) {
  if (!dados) return [];
  return dados.linhas
    .filter((l) => eDeConsumo(l.posicao.replace('.', '')) && typeof l.variacao === 'number' && l.valor_usd >= VALOR_MINIMO_USD && l.variacao > 0)
    .sort((a, b) => b.variacao - a.variacao)
    .slice(0, quantas);
}

module.exports = { PAISES, eDeConsumo, atualizarImportacoes, emAltaNasImportacoes, lerImportacoes, posicoesDeConsumo };
