'use strict';

/*
 * Importacoes do Paraguai pelos dados abertos da aduana (DNIT, Gerencia
 * General de Aduanas): https://datosabiertos.aduana.gov.py
 *
 * O portal publica um arquivo por mes, item a item, com a NCM de 8 digitos,
 * a descricao da mercadoria, a marca, o pais de origem e o valor FOB. E dado
 * oficial e aberto, feito para download. Aqui o arquivo e lido em fluxo (tem
 * centenas de MB) e so os totais por NCM e por marca ficam gravados.
 *
 * Sao despachos liberados no mes (data de cancelacao): compra que ja entrou
 * no pais, com cerca de um mes de atraso.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');

const { cleanEnv, log } = require('./meli');
const { eDeConsumo } = require('./comtrade');
const { nomeDaNcm } = require('./ncm');

const ORIGEM = 'https://datosabiertos.aduana.gov.py/all_data';
const MESES = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];
const FOB_MINIMO_TENDENCIA = 20000; // US$ no mes; abaixo disso a variacao engana
const BASE_MINIMA = 10000; // US$ no mes de comparacao; sobre base menor a porcentagem explode
// Subposicoes industriais ou de partes dentro das posicoes de consumo: a aduana
// traz a NCM de 8 digitos, entao da para tirar o que nao vai para marketplace.
const SUBPOSICOES_INDUSTRIAIS = new Set(['340490', '482340', '841430', '841440', '841480', '841590', '841891', '841899', '842129', '842139',
  '842191', '842199', '842220', '842230', '842240', '842290', '847290', '850490', '853610', '853620', '853630', '853650', '853690', '901920',
  '852990', '851790', '847330', '847989', '340311', '340319', '340391', '340399', '330210', '330290', '841869', '841582', '841583']);
const eIndustrial = (ncm) => SUBPOSICOES_INDUSTRIAIS.has(String(ncm).replace(/[^0-9]/g, '').slice(0, 6));

function pasta() {
  const base = cleanEnv(process.env.CONECTA_HUB_SAIDA);
  return path.join(base ? path.dirname(base) : path.join(os.homedir(), 'ConectaHubSourcing'), 'aduana-py');
}

const chave = (ano, mes) => `${ano}-${String(mes).padStart(2, '0')}`;
const urlDoMes = (ano, mes) => `${ORIGEM}/${ano}/${MESES[mes - 1]}/${ano}_${MESES[mes - 1]}_Nivel_Item.csv`;
const numero = (s) => { const n = Number(String(s || '').replace(/\./g, '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };
const limpar = (s) => String(s || '').replace(/[¿�]/g, '').replace(/\s+/g, ' ').trim();

function lerMes(ano, mes) {
  try {
    return JSON.parse(fs.readFileSync(path.join(pasta(), `${chave(ano, mes)}.json`), 'utf8'));
  } catch (_) {
    return null;
  }
}

// Le um CSV com aspas em fluxo, chamando aoLer(campos) a cada linha.
async function lerCsv(fluxo, aoLer) {
  let campos = [];
  let campo = '';
  let aspas = false;
  let anterior = '';
  const decoder = new TextDecoder('utf-8');
  for await (const pedaco of fluxo) {
    const texto = decoder.decode(pedaco, { stream: true });
    for (let i = 0; i < texto.length; i += 1) {
      const c = texto[i];
      if (aspas) {
        if (c === '"') {
          if (texto[i + 1] === '"') { campo += '"'; i += 1; } else aspas = false;
        } else campo += c;
      } else if (c === '"') aspas = true;
      else if (c === ',') { campos.push(campo); campo = ''; }
      else if (c === '\n') { campos.push(campo); aoLer(campos); campos = []; campo = ''; }
      else if (c !== '\r') campo += c;
      anterior = c;
    }
  }
  if (campo || campos.length) { campos.push(campo); aoLer(campos); }
  void anterior;
}

// Baixa e resume um mes. Devolve null se o portal ainda nao publicou o arquivo.
async function processarMes(ano, mes, buscar) {
  const res = await (buscar || fetch)(urlDoMes(ano, mes), { signal: AbortSignal.timeout(30 * 60000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`aduana do Paraguai respondeu HTTP ${res.status}`);
  const fluxo = res.body && typeof res.body.getReader === 'function' ? Readable.fromWeb(res.body) : res.body;
  let indice = null;
  const porNcm = new Map();
  const porMarca = new Map();
  let linhas = 0;
  let total = 0;
  await lerCsv(fluxo, (c) => {
    if (!indice) {
      indice = {};
      c.forEach((nome, i) => { indice[limpar(nome).replace(/^﻿/, '').toUpperCase()] = i; });
      return;
    }
    const v = (nome) => c[indice[nome]];
    // O codigo da operacao (IC04 = importacao a consumo) vem em DESTINACION; REGIMEN traz o texto.
    const codigo = String(v('DESTINACION') || v('REGIMEN') || '').trim();
    if (v('OPERACION') !== 'IMPORTACION' || !codigo.startsWith('IC')) return;
    const ncm = String(v('POSICION') || '').replace(/[^0-9]/g, '').slice(0, 8);
    if (ncm.length < 4 || !eDeConsumo(ncm.slice(0, 4))) return;
    const fob = numero(v('FOB DOLAR'));
    linhas += 1;
    total += fob;
    const n = porNcm.get(ncm) || { fob: 0, itens: 0, descricao: limpar(v('DESC PARTIDA')), mercadorias: new Map(), origens: new Map() };
    n.fob += fob;
    n.itens += 1;
    const mercadoria = limpar(v('MERCADERIA')).slice(0, 120);
    if (mercadoria) n.mercadorias.set(mercadoria, (n.mercadorias.get(mercadoria) || 0) + fob);
    const origem = limpar(v('PAIS ORIGEN')).replace(/^[A-Z]{2} - /, '');
    if (origem) n.origens.set(origem, (n.origens.get(origem) || 0) + fob);
    porNcm.set(ncm, n);
    const marca = limpar(v('MARCA ITEM')).toUpperCase();
    if (marca && !/^(SIN MARCA|S\/M|SM|NO TIENE|GENERICO|GENERICA|VARIAS|VARIOS)$/.test(marca)) {
      const m = porMarca.get(marca) || { fob: 0, itens: 0 };
      m.fob += fob;
      m.itens += 1;
      porMarca.set(marca, m);
    }
  });
  const topo = (mapa, n) => [...mapa.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
  const resumo = {
    ano, mes, fonte: 'Aduana do Paraguai (DNIT), dados abertos', arquivo: urlDoMes(ano, mes), processado_em: new Date().toISOString(),
    importacoes_de_consumo: linhas, fob_total_usd: Math.round(total),
    ncm: [...porNcm.entries()].map(([codigo, n]) => ({
      ncm: `${codigo.slice(0, 4)}.${codigo.slice(4, 6)}.${codigo.slice(6, 8)}`,
      descricao: n.descricao,
      fob_usd: Math.round(n.fob),
      itens: n.itens,
      mercadorias: topo(n.mercadorias, 3).map(([texto]) => texto),
      origens: topo(n.origens, 3).map(([pais, fob]) => ({ pais, participacao: n.fob ? Math.round((fob / n.fob) * 100) / 100 : 0 })),
    })).sort((a, b) => b.fob_usd - a.fob_usd),
    marcas: [...porMarca.entries()].map(([marca, m]) => ({ marca, fob_usd: Math.round(m.fob), itens: m.itens })).sort((a, b) => b.fob_usd - a.fob_usd).slice(0, 300),
  };
  // Arquivo sem nenhuma importacao de consumo indica leitura errada: nao grava, para tentar de novo.
  if (!linhas) throw new Error(`nenhuma importacao de consumo lida em ${chave(ano, mes)}; o formato do arquivo pode ter mudado`);
  fs.mkdirSync(pasta(), { recursive: true });
  fs.writeFileSync(path.join(pasta(), `${chave(ano, mes)}.json`), JSON.stringify(resumo), 'utf8');
  log(`aduana do Paraguai ${chave(ano, mes)}: ${linhas} itens de consumo, US$ ${Math.round(total)}`);
  return resumo;
}

// Meses que interessam para comparar: o mais recente publicado, o anterior e
// o mesmo mes do ano anterior.
function mesesAlvo(hoje) {
  const d = hoje || new Date();
  const lista = [];
  for (let k = 1; k <= 3; k += 1) {
    const x = new Date(d.getFullYear(), d.getMonth() - k, 1);
    lista.push([x.getFullYear(), x.getMonth() + 1]);
  }
  return lista;
}

// Chamado todo dia: processa o que ainda nao foi processado. Para no primeiro
// mes publicado e garante o mes anterior e o do ano anterior para a comparacao.
async function atualizarAduana(buscar, hoje) {
  let recente = null;
  for (const [ano, mes] of mesesAlvo(hoje)) {
    recente = lerMes(ano, mes) || await processarMes(ano, mes, buscar);
    if (recente) break;
  }
  if (!recente) return null;
  const anterior = new Date(recente.ano, recente.mes - 2, 1);
  for (const [ano, mes] of [[anterior.getFullYear(), anterior.getMonth() + 1], [recente.ano - 1, recente.mes]]) {
    if (!lerMes(ano, mes)) {
      try { await processarMes(ano, mes, buscar); } catch (err) { log(`aduana do Paraguai ${chave(ano, mes)}: ${err.message}`); }
    }
  }
  return tendenciasDaAduana(hoje);
}

// O mes mais recente processado comparado com o anterior e com o do ano anterior.
function tendenciasDaAduana(hoje) {
  let atual = null;
  for (const [ano, mes] of mesesAlvo(hoje)) { atual = lerMes(ano, mes); if (atual) break; }
  if (!atual) return null;
  const d = new Date(atual.ano, atual.mes - 2, 1);
  const anterior = lerMes(d.getFullYear(), d.getMonth() + 1);
  const anoAnterior = lerMes(atual.ano - 1, atual.mes);
  const mapa = (r) => new Map(((r && r.ncm) || []).map((n) => [n.ncm, n]));
  const antes = mapa(anterior);
  const ano = mapa(anoAnterior);
  const variacao = (agora, base) => (base && base.fob_usd > 0 ? Math.round(((agora - base.fob_usd) / base.fob_usd) * 1000) / 1000 : undefined);
  const comBase = (mapa, ncm) => { const b = mapa.get(ncm); return b && b.fob_usd >= BASE_MINIMA ? b : undefined; };
  const linhas = atual.ncm.filter((n) => n.fob_usd >= FOB_MINIMO_TENDENCIA && !eIndustrial(n.ncm)).map((n) => ({
    ...n,
    nome_pt: nomeDaNcm(n.ncm) || undefined,
    variacao_mes: variacao(n.fob_usd, comBase(antes, n.ncm)),
    variacao_ano: variacao(n.fob_usd, comBase(ano, n.ncm)),
    aumento_usd: comBase(antes, n.ncm) ? n.fob_usd - antes.get(n.ncm).fob_usd : undefined,
    novo: anterior ? !antes.has(n.ncm) : undefined,
  }));
  // Ordem pelo aumento em dolares: crescimento que pesa, nao so porcentagem alta.
  const subindo = linhas.filter((n) => typeof n.variacao_mes === 'number' && n.variacao_mes > 0.2)
    .sort((a, b) => b.aumento_usd - a.aumento_usd);
  const marcasAntes = new Map(((anterior && anterior.marcas) || []).map((m) => [m.marca, m.fob_usd]));
  const marcas = atual.marcas.filter((m) => m.fob_usd >= FOB_MINIMO_TENDENCIA)
    .map((m) => ({ ...m, variacao_mes: marcasAntes.get(m.marca) ? Math.round(((m.fob_usd - marcasAntes.get(m.marca)) / marcasAntes.get(m.marca)) * 1000) / 1000 : undefined }))
    .filter((m) => m.variacao_mes === undefined || m.variacao_mes > 0.2).slice(0, 30);
  return {
    fonte: atual.fonte,
    mes: chave(atual.ano, atual.mes),
    comparado_com: anterior ? chave(anterior.ano, anterior.mes) : null,
    ano_anterior: anoAnterior ? chave(anoAnterior.ano, anoAnterior.mes) : null,
    fob_total_usd: atual.fob_total_usd,
    aviso: 'Importacoes de bens de consumo liberadas pela aduana do Paraguai no mes, por NCM. E compra que entrou no pais, com cerca de um mes de atraso.',
    subindo: subindo.slice(0, 40),
    maiores: linhas.slice(0, 40),
    marcas,
  };
}

module.exports = { MESES, atualizarAduana, lerCsv, lerMes, processarMes, tendenciasDaAduana, urlDoMes };
