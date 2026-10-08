// Gera pelo Node o mesmo razao que o site baixa, lendo o backend local.
//   node scripts/razao-exemplo.mjs <tipo> <pasta de saida>
import path from 'node:path';
import ExcelJS from '../web/node_modules/exceljs/lib/exceljs.nodejs.js';
import { montarRazao } from '../web/src/razao.js';
import { montarLivro } from '../web/src/livro.js';

const [tipo = 'composto', pasta = '.'] = process.argv.slice(2);
const api = (c) => fetch(`http://127.0.0.1:4310${c}`).then((r) => r.json());
const { pacotes } = await api('/api/accio');
const cotacoes = [];
for (const p of pacotes.filter((x) => x.sourcing)) {
  cotacoes.push({ categoria: p.categoria, linhas: (await api(`/api/accio/pacote?id=${p.id}`)).linhas || [] });
}
const shopee = await api('/api/shopee');
const cambio = await api('/api/cambio');
const razao = montarRazao(tipo, {
  produtos: (await api('/api/produtos')).itens,
  shopee: shopee.itens,
  relacionados: shopee.relacionados || [],
  cotacoes,
  cambio: cambio && cambio.venda > 0 ? cambio : null,
});
const arquivo = path.join(pasta, razao.arquivo);
await montarLivro(ExcelJS, razao).xlsx.writeFile(arquivo);
console.log(arquivo, razao.linhas);
