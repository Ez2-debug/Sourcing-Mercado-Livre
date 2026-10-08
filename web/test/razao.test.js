import test from 'node:test';
import assert from 'node:assert/strict';
import { faixaDePreco, montarRazao, parecidoNaShopee } from '../src/razao.js';

const entrada = {
  produtos: [{ id: 'MLB1', nome: 'Relogio De Parede Analogico 30cm Redondo', link: 'https://ml/p/MLB1', posicao: 4, menor_preco: 34.99, situacao: 'apto', ncm: 'posição 91.05', vendas_estimadas: 52 }],
  shopee: [
    { id: '9', nome: 'Relogio Parede Redondo Analogico Silencioso', link: 'https://shopee.com.br/product/1/9', preco: 21.5, vendas_30_dias: 3000 },
    { id: '8', nome: 'Capa De Celular', preco: 9.9 },
  ],
  cotacoes: [{ categoria: 'Joias e Relógios', linhas: [
    { produto: { id: 'MLB1', nome: 'Relogio De Parede Analogico 30cm Redondo', link: 'https://ml/p/MLB1', menor_preco: 34.99 }, cruzamento: 'codigo',
      candidato: { titulo: 'Silent Quartz Wall Clock', link: 'https://www.alibaba.com/x', fornecedor: 'Putian Huayang', preco: 'US$ 2.95-3.40', moq: '2 pieces', local: 'Putian, China', aderencia: '88' } },
    { produto: { id: 'MLB2', nome: 'Testador De Diamante' }, candidato: null, cruzamento: null },
  ] }],
};

test('le a faixa de preco do anuncio', () => {
  assert.deepEqual(faixaDePreco('US$ 2,99 – 6,45'), { min: 2.99, max: 6.45 });
  assert.deepEqual(faixaDePreco('sob consulta'), {});
});

test('so aponta item parecido na Shopee com tres palavras em comum', () => {
  assert.equal(parecidoNaShopee('Relogio De Parede Analogico 30cm Redondo', entrada.shopee).id, '9');
  assert.equal(parecidoNaShopee('Testador De Diamante', entrada.shopee), null);
});

test('o composto junta os tres marketplaces em uma linha e traz as abas completas', () => {
  const r = montarRazao('composto', entrada);
  assert.deepEqual(r.abas.map((a) => a.nome), ['Razão composto', 'Mercado Livre', 'Alibaba', 'Shopee', 'Sobre']);
  const [primeira, segunda] = r.abas[0].linhas;
  const titulos = r.abas[0].colunas.map(([t]) => t);
  const de = (linha, t) => linha[titulos.indexOf(t)];
  assert.equal(de(primeira, 'Código'), 'MLB1');
  assert.equal(de(primeira, 'ML: posição'), 4);
  assert.equal(de(primeira, 'NCM sugerida'), 'posição 91.05');
  assert.equal(de(primeira, 'Alibaba: preço mín. (US$)'), 2.95);
  assert.equal(de(primeira, 'Alibaba: preço máx. (US$)'), 3.4);
  assert.equal(de(primeira, 'Alibaba: preço mín. (R$, PTAX)'), undefined, 'sem cambio a coluna fica vazia');
  const comCambio = montarRazao('composto', { ...entrada, cambio: { venda: 5, fonte: 'PTAX', cotado_em: '2026-10-08 13:08' } });
  assert.equal(de(comCambio.abas[0].linhas[0], 'Alibaba: preço mín. (R$, PTAX)'), 14.75);
  assert.equal(de(primeira, 'Shopee: preço (R$)'), 21.5);
  assert.equal(de(primeira, 'Shopee: cruzamento'), 'Por semelhança; conferir');
  assert.equal(de(segunda, 'Alibaba: anúncio'), 'Sem candidato');
  assert.equal(de(segunda, 'Shopee: produto parecido'), '');
  assert.equal(r.abas[0].linhas.length, r.linhas);
});

test('o razao de um marketplace traz so a aba dele', () => {
  assert.deepEqual(montarRazao('shopee', entrada).abas.map((a) => a.nome), ['Shopee', 'Sobre']);
  assert.deepEqual(montarRazao('alibaba', entrada).abas.map((a) => a.nome), ['Alibaba', 'Sobre']);
  assert.match(montarRazao('mercado-livre', entrada).arquivo, /^Razao Mercado Livre \d{4}-\d{2}-\d{2}\.xlsx$/);
  assert.throws(() => montarRazao('outro', entrada), /desconhecido/);
});
