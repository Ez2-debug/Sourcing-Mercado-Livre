// Transforma a descricao de abas do razao.js em um livro do exceljs: formatos,
// formulas, listas, formatacao condicional e celulas de entrada. E usado pelo
// navegador (planilha.js) e pelo Node (scripts/razao-exemplo.mjs).

import { letra } from './razao.js';

const FORMATOS = {
  reais: '"R$" #,##0.00', dolar: '"US$" #,##0.00', inteiro: '#,##0', percentual: '0.0%', decimal: '0.0', cambio: '"R$" 0.0000',
};
const AZUL = 'FF1F4E78';
const AMARELO = 'FFFFF2CC';
const TONS = { verde: 'FFE2F0D9', amarelo: 'FFFFF2CC', vermelho: 'FFFCE4D6' };
const FONTE = { name: 'Arial', size: 10 };

// So enderecos https viram link clicavel na planilha.
const linkSeguro = (u) => (typeof u === 'string' && /^https:\/\//i.test(u) ? u : null);

// Valor de uma celula para o exceljs. Vazio vira null: uma string vazia
// contaria como preenchida nas formulas de contagem.
function valorDe(v) {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'object') return v;
  if (v.formula) return { formula: v.formula };
  if ('texto' in v) return linkSeguro(v.link) ? { text: String(v.texto), hyperlink: v.link } : String(v.texto);
  return valorDe(v.v);
}

function abaLivre(folha, aba) {
  folha.columns = aba.larguras.map((width) => ({ width }));
  aba.linhas.forEach((linha, i) => {
    const row = folha.getRow(i + 1);
    linha.forEach((c, j) => {
      const celula = row.getCell(j + 1);
      const d = c && typeof c === 'object' ? c : { v: c };
      celula.value = valorDe(d);
      celula.font = FONTE;
      celula.alignment = { vertical: 'top', wrapText: true };
      if (d.formato) celula.numFmt = FORMATOS[d.formato];
      if (d.estilo === 'titulo') celula.font = { ...FONTE, size: 16, bold: true };
      if (d.estilo === 'secao') { celula.font = { ...FONTE, size: 11, bold: true, color: { argb: 'FFFFFFFF' } }; celula.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AZUL } }; }
      if (d.estilo === 'rotulo') celula.font = { ...FONTE, bold: true };
      if (d.estilo === 'nota') celula.font = { ...FONTE, italic: true, color: { argb: 'FF595959' } };
      if (d.estilo === 'entrada') {
        celula.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AMARELO } };
        celula.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
        celula.font = { ...FONTE, bold: true };
      }
    });
    if (linha.length && linha[0] && linha[0].estilo === 'secao') folha.mergeCells(i + 1, 1, i + 1, aba.larguras.length);
    if (linha.length && linha[0] && linha[0].estilo === 'titulo') { folha.mergeCells(i + 1, 1, i + 1, aba.larguras.length); row.height = 26; }
  });
}

function abaDeTabela(folha, aba) {
  folha.columns = aba.colunas.map(([titulo, largura, formato]) => ({
    header: titulo,
    width: largura,
    style: { numFmt: FORMATOS[formato], alignment: { vertical: 'top', wrapText: true }, font: FONTE },
  }));
  const cabecalho = folha.getRow(1);
  cabecalho.height = 34;
  cabecalho.eachCell((celula) => {
    celula.font = { ...FONTE, bold: true, color: { argb: 'FFFFFFFF' } };
    celula.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AZUL } };
    celula.alignment = { vertical: 'middle', wrapText: true };
    celula.numFmt = 'General';
  });
  const entradas = new Set(aba.entradas || []);
  for (const linha of aba.linhas) {
    const nova = folha.addRow(linha.map(valorDe));
    nova.eachCell({ includeEmpty: true }, (celula, n) => {
      if (celula.value && typeof celula.value === 'object' && celula.value.hyperlink) {
        celula.font = { ...FONTE, underline: true, color: { argb: 'FF0563C1' } };
      }
      if (entradas.has(n - 1)) celula.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AMARELO } };
    });
  }
  const ultima = aba.linhas.length + 1;
  if (ultima < 2) return;
  if (!aba.semFiltro) folha.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: aba.colunas.length } };
  for (const lista of aba.listas || []) {
    const col = letra(lista.coluna);
    for (let r = 2; r <= ultima; r += 1) {
      folha.getCell(`${col}${r}`).dataValidation = {
        type: 'list', allowBlank: true, formulae: [`"${lista.opcoes.join(',')}"`],
        showErrorMessage: true, errorTitle: 'Valor fora da lista', error: `Escolha: ${lista.opcoes.join(', ')}.`,
      };
    }
  }
  for (const f of aba.formatacoes || []) {
    const ref = `${letra(f.coluna)}2:${letra(f.coluna)}${ultima}`;
    let regra;
    if (f.tipo === 'escala') {
      regra = { type: 'colorScale', priority: 1, cfvo: [{ type: 'min' }, { type: 'percentile', value: 50 }, { type: 'max' }], color: [{ argb: 'FFF8696B' }, { argb: 'FFFFEB84' }, { argb: 'FF63BE7B' }] };
    } else if (f.tipo === 'barra') {
      regra = { type: 'dataBar', priority: 1, minLength: 0, maxLength: 100, gradient: false, cfvo: [{ type: 'min' }, { type: 'max' }], color: { argb: 'FF9DC3E6' } };
    } else {
      regra = { type: 'containsText', operator: 'containsText', priority: 1, text: f.texto, style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: TONS[f.tom] } } } };
    }
    folha.addConditionalFormatting({ ref, rules: [regra] });
  }
}

export function montarLivro(ExcelJS, razao) {
  const livro = new ExcelJS.Workbook();
  livro.creator = 'Conecta Market Sourcing';
  livro.created = new Date();
  // As formulas saem sem valor guardado: o Excel calcula tudo ao abrir.
  livro.calcProperties.fullCalcOnLoad = true;
  for (const aba of razao.abas) {
    const vista = aba.livre ? [{ showGridLines: false }] : [{ state: 'frozen', ySplit: 1, xSplit: aba.congelar || 0 }];
    const folha = livro.addWorksheet(aba.nome, { views: vista });
    if (aba.livre) abaLivre(folha, aba); else abaDeTabela(folha, aba);
  }
  return livro;
}
