'use strict';

/*
 * Situacao dos pacotes enviados ao Accio Work, para a central.
 *
 * O Accio nao avisa quando termina nem diz a qual pacote um resultado
 * pertence: ele grava um sourcing.md em alguma pasta de plano. Aqui cada
 * sourcing.md e ligado ao pacote cujos produtos ele cita pelo codigo ou, na
 * falta de codigo, ao pacote com que mais candidatos casam por semelhanca.
 */

const fs = require('node:fs');
const path = require('node:path');

const { ToolError } = require('./meli');
const { pastaAccio, pastaMineracoes } = require('./saida');
const { todosOsProdutos } = require('./mineracao');
const { ncmCurto } = require('./indicadores');
const { cruzar, lerSourcingMd } = require('./sourcing');

const ID_DE_MINERACAO = /^\d{8}-\d{6}-MLB\d{1,12}$/;
// Sem codigo citado, so liga o resultado ao pacote com boa parte dos candidatos casados.
const MIN_PARES = 5;
const MIN_PROPORCAO = 0.6;

function pastaDosPacotes() {
  return path.join(pastaAccio(), 'conecta-hub-mineracao');
}

function lerJson(arquivo) {
  try {
    return JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  } catch (_) {
    return null;
  }
}

function lerPacotes() {
  let nomes;
  try {
    nomes = fs.readdirSync(pastaDosPacotes());
  } catch (_) {
    return [];
  }
  return nomes.filter((n) => ID_DE_MINERACAO.test(n)).sort().reverse().map((id) => {
    const p = lerJson(path.join(pastaDosPacotes(), id, 'produtos.json'));
    return p && Array.isArray(p.produtos) ? { id, pasta: path.join(pastaDosPacotes(), id), pacote: p } : null;
  }).filter(Boolean);
}

// Todos os sourcing.md gravados na pasta do Accio, com os candidatos lidos.
function lerResultados() {
  const achados = [];
  const andar = (dir, n) => {
    let itens;
    try { itens = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const it of itens) {
      const alvo = path.join(dir, it.name);
      if (it.isDirectory() && n < 4 && it.name !== 'node_modules') andar(alvo, n + 1);
      else if (it.isFile() && it.name === 'sourcing.md') {
        let candidatos = [];
        try { candidatos = lerSourcingMd(fs.readFileSync(alvo, 'utf8')); } catch (_) { /* ilegivel */ }
        if (candidatos.length) achados.push({ arquivo: alvo, quando: fs.statSync(alvo).mtimeMs, candidatos });
      }
    }
  };
  andar(pastaAccio(), 0);
  return achados;
}

// Liga cada resultado a no maximo um pacote, e cada pacote ao seu melhor resultado.
function ligar(pacotes, resultados) {
  const porPacote = new Map();
  for (const r of resultados) {
    let melhor = null;
    for (const p of pacotes) {
      // O resultado nao pode ser anterior ao pacote.
      if (r.quando < Date.parse(p.pacote.consultado_em)) continue;
      const { par } = cruzar(p.pacote.produtos, r.candidatos);
      const pares = Array.from(par.values());
      const exatos = pares.filter((x) => x.exato).length;
      const dentroDoPacote = r.arquivo.startsWith(p.pasta + path.sep);
      const serve = dentroDoPacote || exatos > 0 ||
        (pares.length >= MIN_PARES && pares.length / r.candidatos.length >= MIN_PROPORCAO);
      if (!serve) continue;
      const pontos = (dentroDoPacote ? 10000 : 0) + exatos * 100 + pares.length;
      if (!melhor || pontos > melhor.pontos) melhor = { id: p.id, pontos, exatos, pares: pares.length };
    }
    if (!melhor) continue;
    const atual = porPacote.get(melhor.id);
    if (!atual || melhor.pontos > atual.pontos || (melhor.pontos === atual.pontos && r.quando > atual.resultado.quando)) {
      porPacote.set(melhor.id, { ...melhor, resultado: r });
    }
  }
  return porPacote;
}

function listarPacotes() {
  const pacotes = lerPacotes();
  const ligados = ligar(pacotes, lerResultados());
  return {
    pasta: pastaDosPacotes(),
    pacotes: pacotes.map((p) => {
      const l = ligados.get(p.id);
      return {
        id: p.id,
        pasta: p.pasta,
        categoria: p.pacote.categoria_raiz ? p.pacote.categoria_raiz.caminho || p.pacote.categoria_raiz.nome : p.id,
        minerado_em: p.pacote.consultado_em,
        produtos: p.pacote.produtos.length,
        pedido: `Abra a pasta ${p.pasta} como workspace e siga o arquivo briefing-sourcing.md: ` +
          'busque fornecedores no Alibaba para cada produto listado e monte a comparacao.',
        sourcing: l
          ? {
            arquivo: l.resultado.arquivo,
            feito_em: new Date(l.resultado.quando).toISOString(),
            candidatos: l.resultado.candidatos.length,
            cruzados: l.pares,
            // Sem codigo citado, a ligacao entre resultado e pacote e por semelhanca.
            ligado_por: l.exatos > 0 || l.resultado.arquivo.startsWith(p.pasta + path.sep) ? 'codigo' : 'semelhanca',
          }
          : null,
      };
    }),
  };
}

// Produtos do pacote lado a lado com o candidato que o Accio encontrou.
function detalharPacote(id) {
  if (!ID_DE_MINERACAO.test(String(id))) throw new ToolError(`pacote invalido: "${id}".`);
  const pacotes = lerPacotes();
  const alvo = pacotes.find((p) => p.id === id);
  if (!alvo) throw new ToolError(`Nao achei o pacote ${id} na pasta do Accio Work.`);
  const l = ligar(pacotes, lerResultados()).get(id);
  if (!l) throw new ToolError(`O Accio Work ainda nao gravou resultado de sourcing para o pacote ${id}.`);
  const { par, sobraram } = cruzar(alvo.pacote.produtos, l.resultado.candidatos);
  // A mineracao tem a versao atual do produto (NCM revista, estimativas registradas depois do envio).
  const mineracao = lerJson(path.join(pastaMineracoes(), id, 'mineracao.json'));
  const atuais = new Map(mineracao ? todosOsProdutos(mineracao).map((p) => [p.id, p]) : []);
  return {
    id,
    arquivo: l.resultado.arquivo,
    pasta_do_resultado: path.dirname(l.resultado.arquivo),
    linhas: alvo.pacote.produtos.map((doPacote) => {
      const p = atuais.get(doPacote.id) || doPacote;
      const achado = par.get(p.id);
      const est = p.estimativa_externa;
      return {
        produto: {
          id: p.id,
          nome: p.nome,
          foto: p.foto,
          link: p.link,
          menor_preco: p.anuncios && p.anuncios.menor_preco ? p.anuncios.menor_preco.valor : undefined,
          categoria: p.categoria,
          posicao: p.melhor_posicao,
          ncm: p.ncm ? ncmCurto(p) : undefined,
          vendas_estimadas: est ? est.vendas : undefined,
        },
        candidato: achado ? achado.candidato : null,
        cruzamento: achado ? (achado.exato ? 'codigo' : 'semelhanca') : null,
      };
    }),
    candidatos_sem_produto: sobraram,
  };
}

module.exports = { detalharPacote, listarPacotes };
