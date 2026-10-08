import test from 'node:test';
import assert from 'node:assert/strict';
import { faixaDePreco, letra, montarRazao, parecidoNaShopee, quantidadeDoMoq } from '../src/razao.js';

const entrada = {
  produtos: [{ id: 'MLB1', nome: 'Relogio De Parede Analogico 30cm Redondo', link: 'https://ml/p/MLB1', posicao: 4, menor_preco: 34.99, situacao: 'apto', ncm: 'posição 91.05', vendas_estimadas: 52 }],
  shopee: [{ id: '8', nome: 'Capa De Celular', preco: 9.9 }],
  relacionados: [{ id: '9', nome: 'Relógio De Parede Led Digital Grande', link: 'https://shopee.com.br/product/1/9', preco: 21.5, vendas_30_dias: 3000 }],
  cotacoes: [{ categoria: 'Joias e Relógios', linhas: [
    { produto: { id: 'MLB1', nome: 'Relogio De Parede Analogico 30cm Redondo', link: 'https://ml/p/MLB1', menor_preco: 34.99 }, cruzamento: 'codigo',
      candidato: { titulo: 'Silent Quartz Wall Clock', link: 'https://www.alibaba.com/x', fornecedor: 'Putian Huayang', preco: 'US$ 2.95-3.40', moq: '1,000 pieces', local: 'Putian, China', aderencia: '88' } },
    { produto: { id: 'MLB2', nome: 'Testador De Diamante', posicao: 7, ncm: 'posição 90.31' }, candidato: null, cruzamento: null },
  ] }],
};

test('le preco, quantidade e letra de coluna', () => {
  assert.deepEqual(faixaDePreco('US$ 2,99 – 6,45'), { min: 2.99, max: 6.45 });
  assert.deepEqual(faixaDePreco('sob consulta'), {});
  assert.equal(quantidadeDoMoq('500 pieces'), 500);
  assert.equal(quantidadeDoMoq('1,000 pieces'), 1000);
  assert.equal(quantidadeDoMoq(''), undefined);
  assert.deepEqual([letra(0), letra(25), letra(26)], ['A', 'Z', 'AA']);
});

test('acha o parecido na Shopee pelo tipo do produto e mais uma palavra', () => {
  assert.equal(parecidoNaShopee('Relogio De Parede Analogico 30cm Redondo', entrada.relacionados).id, '9');
  assert.equal(parecidoNaShopee('Testador De Diamante', entrada.relacionados), null);
});

test('o composto abre no painel e liga custo e margem as premissas', () => {
  const r = montarRazao('composto', { ...entrada, cambio: { venda: 5, fonte: 'PTAX', cotado_em: '2026-10-08 13:08' } });
  assert.deepEqual(r.abas.map((a) => a.nome), ['Painel', 'Razão composto', 'Mercado Livre', 'Alibaba', 'Shopee', 'Sobre']);
  const composto = r.abas[1];
  const titulos = composto.colunas.map(([t]) => t);
  const de = (linha, t) => linha[titulos.indexOf(t)];
  const [primeira, segunda] = composto.linhas;
  assert.equal(de(primeira, 'ML: posição'), 4, 'completa com o produto minerado quando a cotacao nao traz');
  assert.equal(de(segunda, 'ML: posição'), 7, 'usa o dado que veio na propria cotacao');
  assert.equal(de(segunda, 'NCM sugerida'), 'posição 90.31');
  assert.equal(de(primeira, 'Alibaba: preço mín. (US$)'), 2.95);
  assert.equal(de(primeira, 'MOQ (quantidade)'), 1000);
  assert.equal(de(primeira, 'Alibaba: aderência'), 88, 'aderencia sai como numero');
  assert.match(de(primeira, 'Custo estimado un. (R$)').formula, /Painel!\$C\$5\*\(1\+Painel!\$C\$6\)/);
  assert.match(de(primeira, 'Margem bruta un. (R$)').formula, /Painel!\$C\$7/);
  assert.equal(de(primeira, 'Shopee: preço (R$)'), 21.5);
  assert.equal(de(segunda, 'Alibaba: anúncio'), 'Sem candidato');
  assert.deepEqual(composto.listas[0].opcoes, ['Cotar', 'Aguardar', 'Descartar']);
  assert.equal(r.linhas, 2);

  const painel = r.abas[0];
  const premissas = painel.linhas.filter((l) => l[2] && l[2].estilo === 'entrada');
  assert.deepEqual(premissas.map((l) => l[2].v), [5, 0, 0], 'so o dolar vem preenchido; custos e comissao comecam em zero');
  assert.equal(painel.linhas[4][2].estilo, 'entrada', 'o dolar fica em C5, onde as formulas apontam');
  assert.ok(painel.linhas.some((l) => l[2] && /SUMIF\(.*"Cotar"/.test(l[2].formula || '')));
});

test('o razao de um marketplace traz so a aba dele', () => {
  assert.deepEqual(montarRazao('shopee', entrada).abas.map((a) => a.nome), ['Shopee', 'Sobre']);
  assert.deepEqual(montarRazao('alibaba', entrada).abas.map((a) => a.nome), ['Alibaba', 'Sobre']);
  assert.match(montarRazao('mercado-livre', entrada).arquivo, /^Razao Mercado Livre \d{4}-\d{2}-\d{2}\.xlsx$/);
  assert.throws(() => montarRazao('outro', entrada), /desconhecido/);
});
