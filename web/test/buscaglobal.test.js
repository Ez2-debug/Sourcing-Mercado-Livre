import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agruparResultados, casaTodas, juntarFontes } from '../src/buscaglobal.js';
import { categoriaAmpla } from '../src/categorias.js';

test('busca: todas as palavras, sem acento, plural acha singular', () => {
  assert.ok(casaTodas('Tênis De Corrida Carbon Plate', 'tenis corridas'));
  assert.ok(!casaTodas('Tênis De Corrida', 'tenis feminino'));
});

test('busca: agrupa por fonte e ordena por vendas', () => {
  const lista = juntarFontes({
    maisVendidos: { marketplaces: { shopee: { itens: [{ titulo: 'Batom Matte', vendas_mes: 10 }, { titulo: 'Batom Gloss', vendas_mes: 90 }] } } },
    produtos: { itens: [{ nome: 'Batom Líquido', posicao: 3 }] },
  });
  const g = agruparResultados(lista, 'batom');
  assert.deepEqual(g.map((x) => x.fonte), ['shopee', 'minerado']);
  assert.equal(g[0].itens[0].titulo, 'Batom Gloss');
});

test('categoria ampla pela categoria da fonte ou pelo titulo', () => {
  assert.equal(categoriaAmpla('Calçados, Roupas e Bolsas > Tênis', 'x'), 'Moda e calçados');
  assert.equal(categoriaAmpla('', 'Kit 10 Pincéis Artísticos'), 'Papelaria e escritório');
  assert.equal(categoriaAmpla('', 'Coisa sem nome'), 'Outros');
});
