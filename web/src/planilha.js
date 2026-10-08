// Grava no navegador o .xlsx montado por razao.js e entrega o download.
// A biblioteca so e carregada quando o usuario pede a planilha.

import { montarLivro } from './livro.js';

export async function baixarPlanilha(razao) {
  const { default: ExcelJS } = await import('exceljs');
  const dados = await montarLivro(ExcelJS, razao).xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([dados], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = razao.arquivo;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
