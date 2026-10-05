'use strict';

// Utilitarios de texto usados pelas paginas HTML geradas (catalogo e painel).

function esc(v) {
  return String(v === undefined || v === null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// So aceita enderecos http(s) em src e href, para o HTML nao executar nada
// que venha da API.
function url(v) {
  return typeof v === 'string' && /^https?:\/\//.test(v) ? esc(v) : '';
}

function preco(valor, moeda) {
  if (typeof valor !== 'number') return '';
  const n = valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${moeda === 'BRL' || !moeda ? 'R$' : esc(moeda)} ${n}`;
}

module.exports = { esc, preco, url };
