// Gera pelo Node o mesmo razao que o site baixa, lendo o backend local.
//   node scripts/razao-exemplo.mjs <tipo> <pasta de saida>
import path from 'node:path';
import ExcelJS from '../web/node_modules/exceljs/lib/exceljs.nodejs.js';
import { montarRazao } from '../web/src/razao.js';

const [tipo = 'composto', pasta = '.'] = process.argv.slice(2);
const api = (c) => fetch(`http://127.0.0.1:4310${c}`).then((r) => r.json());
const { pacotes } = await api('/api/accio');
const cotacoes = [];
for (const p of pacotes.filter((x) => x.sourcing)) {
  cotacoes.push({ categoria: p.categoria, linhas: (await api(`/api/accio/pacote?id=${p.id}`)).linhas || [] });
}
const razao = montarRazao(tipo, { produtos: (await api('/api/produtos')).itens, shopee: (await api('/api/shopee')).itens, cotacoes });

const FORMATOS = { reais: '"R$" #,##0.00', dolar: '"US$" #,##0.00', inteiro: '#,##0' };
const livro = new ExcelJS.Workbook();
for (const aba of razao.abas) {
  const folha = livro.addWorksheet(aba.nome, { views: [{ state: 'frozen', ySplit: 1 }] });
  folha.columns = aba.colunas.map(([header, width, f]) => ({ header, width, style: { numFmt: FORMATOS[f], alignment: { vertical: 'top', wrapText: true }, font: { name: 'Arial', size: 10 } } }));
  folha.getRow(1).eachCell((c) => { c.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } }; });
  for (const linha of aba.linhas) {
    const nova = folha.addRow(linha.map((v) => (v && typeof v === 'object' ? { text: String(v.texto), hyperlink: v.link } : (v ?? ''))));
    nova.eachCell((c) => { if (c.value && c.value.hyperlink) c.font = { name: 'Arial', size: 10, underline: true, color: { argb: 'FF0563C1' } }; });
  }
  if (!aba.semFiltro && aba.linhas.length) folha.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: aba.colunas.length } };
}
const arquivo = path.join(pasta, razao.arquivo);
await livro.xlsx.writeFile(arquivo);
console.log(arquivo, razao.linhas);
