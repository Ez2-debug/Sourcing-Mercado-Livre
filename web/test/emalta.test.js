import test from 'node:test';
import assert from 'node:assert/strict';
import { calcularEmAlta, paresPorCategoria } from '../src/emalta.js';

const mineracao = (id, dia) => ({ id, categoria_id: 'MLB1', consultado_em: `2026-05-${dia}T10:00:00.000Z` });
const produto = (mineracao_id, produto_id, posicao, extra) => ({
  mineracao_id, produto_id, nome: produto_id, categoria: 'Teste', melhor_posicao: posicao, menor_preco: '19.90',
  situacao: 'apto', ncm_posicao: '39.24 ou 39.26', ncm_codigos: [], ...extra,
});

test('escolhe como base a mineracao com a idade pedida, ou a mais antiga', () => {
  const lista = [mineracao('a', '01'), mineracao('b', '10'), mineracao('c', '12'), { id: 'x', categoria_id: 'MLB2', consultado_em: '2026-05-12T10:00:00.000Z' }];
  const semana = paresPorCategoria(lista, 7);
  assert.deepEqual(semana.pares.map((p) => [p.atual.id, p.base.id]), [['c', 'a']]);
  assert.equal(semana.semHistorico, 1);
  assert.equal(paresPorCategoria(lista, 1).pares[0].base.id, 'b');
});

test('lista so os aptos que subiram ou entraram', () => {
  const { pares, semHistorico } = paresPorCategoria([mineracao('a', '01'), mineracao('c', '12')], 7);
  const r = calcularEmAlta(pares, semHistorico, [
    produto('a', 'P1', 9), produto('a', 'P2', 1),
    produto('c', 'P1', 2), produto('c', 'P2', 3), produto('c', 'P3', 4),
    produto('c', 'P4', 1, { situacao: 'marca_registrada' }),
  ], 7);
  assert.deepEqual(r.subindo.map((p) => [p.id, p.posicao_anterior, p.posicao, p.subiu]), [['P1', 9, 2, 7]]);
  assert.deepEqual(r.entraram.map((p) => p.id), ['P3']);
  assert.equal(r.subindo[0].menor_preco, 19.9);
  assert.equal(r.subindo[0].ncm, 'posição 39.24');
  assert.equal(r.menor_periodo_em_dias, 11);
});
