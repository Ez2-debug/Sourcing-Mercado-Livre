// Grava no navegador o .xlsx montado por razao.js e entrega o download.
// A biblioteca so e carregada quando o usuario pede a planilha.

const FORMATOS = { reais: '"R$" #,##0.00', dolar: '"US$" #,##0.00', inteiro: '#,##0' };
const AZUL = 'FF1F4E78';

// So enderecos https viram link clicavel na planilha.
const linkSeguro = (u) => (typeof u === 'string' && /^https:\/\//i.test(u) ? u : null);

export async function baixarPlanilha(razao) {
  const { default: ExcelJS } = await import('exceljs');
  const livro = new ExcelJS.Workbook();
  livro.creator = 'Conecta Hub Sourcing';
  livro.created = new Date();

  for (const aba of razao.abas) {
    const folha = livro.addWorksheet(aba.nome, { views: [{ state: 'frozen', ySplit: 1 }] });
    folha.columns = aba.colunas.map(([titulo, largura, formato]) => ({
      header: titulo,
      width: largura,
      style: { numFmt: FORMATOS[formato], alignment: { vertical: 'top', wrapText: true }, font: { name: 'Arial', size: 10 } },
    }));
    const cabecalho = folha.getRow(1);
    cabecalho.height = 32;
    cabecalho.eachCell((celula) => {
      celula.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
      celula.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AZUL } };
      celula.alignment = { vertical: 'middle', wrapText: true };
      celula.numFmt = undefined;
    });
    for (const linha of aba.linhas) {
      const nova = folha.addRow(linha.map((v) => {
        if (v && typeof v === 'object') return linkSeguro(v.link) ? { text: String(v.texto), hyperlink: v.link } : String(v.texto);
        return v === undefined || v === null ? '' : v;
      }));
      nova.eachCell((celula) => {
        if (celula.value && typeof celula.value === 'object' && celula.value.hyperlink) {
          celula.font = { name: 'Arial', size: 10, underline: true, color: { argb: 'FF0563C1' } };
        }
      });
    }
    if (!aba.semFiltro && aba.linhas.length) {
      folha.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: aba.colunas.length } };
    }
  }

  const dados = await livro.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([dados], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = razao.arquivo;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
