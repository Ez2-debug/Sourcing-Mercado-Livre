'use strict';

/*
 * Gerador minimo de arquivos .xlsx, so com modulos do Node.
 *
 * Um .xlsx e um ZIP de XMLs. Aqui ha o suficiente para a planilha de
 * produtos: texto, numero, estilos fixos, links, filtro, paineis congelados
 * e imagens ancoradas em celulas. Nao ha formulas.
 */

const zlib = require('node:zlib');

/* ------------------------------------------------------------------ */
/* ZIP                                                                 */
/* ------------------------------------------------------------------ */

const TABELA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i += 1) c = TABELA_CRC[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// arquivos: [{ nome, dados (Buffer ou string) }]
function zip(arquivos) {
  const partes = [];
  const central = [];
  let offset = 0;
  for (const a of arquivos) {
    const nome = Buffer.from(a.nome, 'utf8');
    const dados = Buffer.isBuffer(a.dados) ? a.dados : Buffer.from(a.dados, 'utf8');
    // Imagem ja vem comprimida; guardar sem deflate e mais rapido.
    const guardar = /\.(jpe?g|png)$/i.test(a.nome);
    const corpo = guardar ? dados : zlib.deflateRawSync(dados);
    const crc = crc32(dados);
    const cab = Buffer.alloc(30);
    cab.writeUInt32LE(0x04034b50, 0);
    cab.writeUInt16LE(20, 4);
    cab.writeUInt16LE(0x0800, 6); // nomes em UTF-8
    cab.writeUInt16LE(guardar ? 0 : 8, 8);
    cab.writeUInt16LE(0, 10);
    cab.writeUInt16LE(0x21, 12); // 01/01/1980: a data nao importa para o Excel
    cab.writeUInt32LE(crc, 14);
    cab.writeUInt32LE(corpo.length, 18);
    cab.writeUInt32LE(dados.length, 22);
    cab.writeUInt16LE(nome.length, 26);
    cab.writeUInt16LE(0, 28);
    partes.push(cab, nome, corpo);

    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(0x0800, 8);
    dir.writeUInt16LE(guardar ? 0 : 8, 10);
    dir.writeUInt16LE(0, 12);
    dir.writeUInt16LE(0x21, 14);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(corpo.length, 20);
    dir.writeUInt32LE(dados.length, 24);
    dir.writeUInt16LE(nome.length, 28);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, nome);
    offset += cab.length + nome.length + corpo.length;
  }
  const dirBuf = Buffer.concat(central);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0);
  fim.writeUInt16LE(arquivos.length, 8);
  fim.writeUInt16LE(arquivos.length, 10);
  fim.writeUInt32LE(dirBuf.length, 12);
  fim.writeUInt32LE(offset, 16);
  return Buffer.concat([...partes, dirBuf, fim]);
}

/* ------------------------------------------------------------------ */
/* Imagens                                                             */
/* ------------------------------------------------------------------ */

// Tipo e tamanho de um JPEG ou PNG, lidos do cabecalho. null se nao for nenhum dos dois.
function medirImagem(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 24) return null;
  if (buf.readUInt32BE(0) === 0x89504e47) {
    return { tipo: 'png', largura: buf.readUInt32BE(16), altura: buf.readUInt32BE(20) };
  }
  if (buf[0] !== 0xFF || buf[1] !== 0xD8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xFF) return null;
    const marca = buf[i + 1];
    if (marca === 0xFF) { i += 1; continue; }
    const tamanho = buf.readUInt16BE(i + 2);
    // SOF0 a SOF15 trazem as dimensoes; C4, C8 e CC sao outras tabelas.
    if (marca >= 0xC0 && marca <= 0xCF && marca !== 0xC4 && marca !== 0xC8 && marca !== 0xCC) {
      return { tipo: 'jpeg', altura: buf.readUInt16BE(i + 5), largura: buf.readUInt16BE(i + 7) };
    }
    i += 2 + tamanho;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* XML da pasta de trabalho                                            */
/* ------------------------------------------------------------------ */

const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_PKG = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CAB = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const EMU = 9525; // unidades por pixel

function x(v) {
  return String(v === undefined || v === null ? '' : v)
    // Caracteres de controle nao sao XML valido e corrompem o arquivo.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function coluna(n) {
  let s = '';
  for (let k = n + 1; k > 0; k = Math.floor((k - 1) / 26)) s = String.fromCharCode(65 + ((k - 1) % 26)) + s;
  return s;
}

// Indices de estilo (cellXfs) usados pelas celulas.
const ESTILO = {
  padrao: 0, cabecalho: 1, texto: 2, centro: 3, dinheiro: 4, link: 5, posicao: 6,
  apto: 7, marca: 8, regulado: 9, proibido: 10, rotulo: 11, nota: 12,
};

const ESTILOS_XML = `${CAB}<styleSheet xmlns="${NS_MAIN}">
<numFmts count="1"><numFmt numFmtId="164" formatCode="0&quot;º&quot;"/></numFmts>
<fonts count="4">
<font><sz val="10"/><name val="Arial"/></font>
<font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Arial"/></font>
<font><u/><sz val="10"/><color rgb="FF0563C1"/><name val="Arial"/></font>
<font><b/><sz val="10"/><name val="Arial"/></font>
</fonts>
<fills count="7">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF1F4E78"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFE2F0D9"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFFF2CC"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFCE4D6"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFF8CBAD"/></patternFill></fill>
</fills>
<borders count="2">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left/><right/><top/><bottom style="thin"><color rgb="FFD9D9D9"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="13">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="4" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="4" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="5" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="6" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="top"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

function rels(lista) {
  return `${CAB}<Relationships xmlns="${NS_PKG}">${lista.map((r) =>
    `<Relationship Id="${r.id}" Type="${NS_REL}/${r.tipo}" Target="${x(r.alvo)}"${r.externo ? ' TargetMode="External"' : ''}/>`).join('')}</Relationships>`;
}

/*
 * planilhas: [{
 *   nome, larguras: [n...], congelar: { colunas, linhas }, filtro: true,
 *   linhas: [{ altura, celulas: [{ v, s, link }] }],
 *   imagens: [{ linha, coluna, dados, largura, altura }]   (indices a partir de 0; tamanho em pixels)
 * }]
 */
function montarXlsx(planilhas) {
  const arquivos = [];
  const tipos = [];
  let fotos = 0;
  const extensoes = new Set();

  planilhas.forEach((p, i) => {
    const n = i + 1;
    const relsDaFolha = [];
    const links = [];
    const linhasXml = p.linhas.map((linha, r) => {
      const cels = linha.celulas.map((c, col) => {
        if (!c || c.v === undefined || c.v === null || c.v === '') {
          return c && c.s ? `<c r="${coluna(col)}${r + 1}" s="${c.s}"/>` : '';
        }
        const ref = `${coluna(col)}${r + 1}`;
        if (c.link && /^https?:\/\//.test(c.link)) {
          const id = `rId${relsDaFolha.length + 1}`;
          relsDaFolha.push({ id, tipo: 'hyperlink', alvo: c.link, externo: true });
          links.push(`<hyperlink ref="${ref}" r:id="${id}"/>`);
        }
        const s = c.s ? ` s="${c.s}"` : '';
        if (typeof c.v === 'number' && Number.isFinite(c.v)) return `<c r="${ref}"${s}><v>${c.v}</v></c>`;
        return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${x(c.v)}</t></is></c>`;
      }).join('');
      const altura = linha.altura ? ` ht="${linha.altura}" customHeight="1"` : '';
      return `<row r="${r + 1}"${altura}>${cels}</row>`;
    }).join('');

    let desenho = '';
    const imagens = (p.imagens || []).filter((im) => medirImagem(im.dados));
    if (imagens.length) {
      const relsDoDesenho = [];
      const ancoras = imagens.map((im, k) => {
        const tipo = medirImagem(im.dados).tipo;
        fotos += 1;
        extensoes.add(tipo);
        arquivos.push({ nome: `xl/media/image${fotos}.${tipo}`, dados: im.dados });
        relsDoDesenho.push({ id: `rId${k + 1}`, tipo: 'image', alvo: `../media/image${fotos}.${tipo}` });
        const cx = Math.round(im.largura * EMU);
        const cy = Math.round(im.altura * EMU);
        return `<xdr:oneCellAnchor><xdr:from><xdr:col>${im.coluna}</xdr:col><xdr:colOff>${(im.margemX || 0) * EMU}</xdr:colOff><xdr:row>${im.linha}</xdr:row><xdr:rowOff>${(im.margemY || 0) * EMU}</xdr:rowOff></xdr:from>` +
          `<xdr:ext cx="${cx}" cy="${cy}"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${k + 2}" name="Foto ${k + 1}"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>` +
          `<xdr:blipFill><a:blip r:embed="rId${k + 1}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>` +
          `<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor>`;
      }).join('');
      arquivos.push({
        nome: `xl/drawings/drawing${n}.xml`,
        dados: `${CAB}<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${NS_REL}">${ancoras}</xdr:wsDr>`,
      });
      arquivos.push({ nome: `xl/drawings/_rels/drawing${n}.xml.rels`, dados: rels(relsDoDesenho) });
      tipos.push(`<Override PartName="/xl/drawings/drawing${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`);
      const id = `rId${relsDaFolha.length + 1}`;
      relsDaFolha.push({ id, tipo: 'drawing', alvo: `../drawings/drawing${n}.xml` });
      desenho = `<drawing r:id="${id}"/>`;
    }

    const maxCol = Math.max(1, ...p.linhas.map((l) => l.celulas.length));
    const cg = p.congelar;
    const painel = cg
      ? `<pane${cg.colunas ? ` xSplit="${cg.colunas}"` : ''}${cg.linhas ? ` ySplit="${cg.linhas}"` : ''} topLeftCell="${coluna(cg.colunas || 0)}${(cg.linhas || 0) + 1}" activePane="${cg.colunas && cg.linhas ? 'bottomRight' : (cg.linhas ? 'bottomLeft' : 'topRight')}" state="frozen"/>`
      : '';
    const cols = (p.larguras || []).map((w, k) => `<col min="${k + 1}" max="${k + 1}" width="${w}" customWidth="1"/>`).join('');
    arquivos.push({
      nome: `xl/worksheets/sheet${n}.xml`,
      dados: `${CAB}<worksheet xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">` +
        `<sheetViews><sheetView workbookViewId="0"${i === 0 ? ' tabSelected="1"' : ''}>${painel}</sheetView></sheetViews>` +
        '<sheetFormatPr defaultRowHeight="15"/>' +
        (cols ? `<cols>${cols}</cols>` : '') +
        `<sheetData>${linhasXml}</sheetData>` +
        (p.filtro ? `<autoFilter ref="A1:${coluna(maxCol - 1)}${p.linhas.length}"/>` : '') +
        (links.length ? `<hyperlinks>${links.join('')}</hyperlinks>` : '') +
        `${desenho}</worksheet>`,
    });
    if (relsDaFolha.length) arquivos.push({ nome: `xl/worksheets/_rels/sheet${n}.xml.rels`, dados: rels(relsDaFolha) });
    tipos.push(`<Override PartName="/xl/worksheets/sheet${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`);
  });

  const padroes = ['<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>', '<Default Extension="xml" ContentType="application/xml"/>'];
  for (const e of extensoes) padroes.push(`<Default Extension="${e}" ContentType="image/${e}"/>`);

  const fixos = [
    {
      nome: '[Content_Types].xml',
      dados: `${CAB}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${padroes.join('')}` +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        `${tipos.join('')}</Types>`,
    },
    { nome: '_rels/.rels', dados: rels([{ id: 'rId1', tipo: 'officeDocument', alvo: 'xl/workbook.xml' }]) },
    {
      nome: 'xl/workbook.xml',
      dados: `${CAB}<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}"><sheets>${planilhas.map((p, i) =>
        `<sheet name="${x(p.nome)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`,
    },
    {
      nome: 'xl/_rels/workbook.xml.rels',
      dados: rels([
        ...planilhas.map((p, i) => ({ id: `rId${i + 1}`, tipo: 'worksheet', alvo: `worksheets/sheet${i + 1}.xml` })),
        { id: `rId${planilhas.length + 1}`, tipo: 'styles', alvo: 'styles.xml' },
      ]),
    },
    { nome: 'xl/styles.xml', dados: ESTILOS_XML },
  ];
  // [Content_Types].xml precisa ser a primeira entrada do pacote.
  return zip([...fixos, ...arquivos]);
}

module.exports = { ESTILO, crc32, medirImagem, montarXlsx, zip };
