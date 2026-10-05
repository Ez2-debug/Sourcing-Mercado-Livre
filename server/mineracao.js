'use strict';

/*
 * Mineracao de produtos por categoria.
 *
 * Parte de uma categoria, desce pelas subcategorias, cruza o ranking de mais
 * vendidos de cada uma com os termos em alta e com os anuncios de cada produto,
 * e devolve os produtos agrupados pela categoria mais especifica em que
 * aparecem, com o nome que o site usa e com foto.
 *
 * Nada aqui estima vendas: a API so informa a posicao no ranking. A
 * `prioridade` e uma regra de ordenacao para a triagem, com os componentes
 * expostos, e nao uma medida de demanda.
 */

const { SITE, ToolError, apiGet, mapLimit } = require('./meli');
const {
  brandOf, dropEmpty, findSalesFields, pathForProduct, photosOf, publicLink, summarizeListings,
} = require('./catalogo');

const LIMITES = {
  profundidade: { padrao: 1, min: 0, max: 2 },
  max_subcategorias: { padrao: 8, min: 1, max: 30 },
  max_produtos: { padrao: 40, min: 5, max: 120 },
};
const PARALELO = 4;

function inteiro(valor, nome) {
  const lim = LIMITES[nome];
  if (valor === undefined || valor === null || valor === '') return lim.padrao;
  const n = Number(valor);
  if (!Number.isInteger(n) || n < lim.min || n > lim.max) {
    throw new ToolError(`${nome} invalido: "${valor}". Use um inteiro de ${lim.min} a ${lim.max}.`);
  }
  return n;
}

function norm(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/* ------------------------------------------------------------------ */
/* Sinais de triagem                                                   */
/* ------------------------------------------------------------------ */

// Sinalizacao por palavra-chave no nome do produto. Serve para
// chamar atencao na triagem; a exigencia real depende do NCM e precisa ser
// conferida antes de qualquer cotacao.
const REGRAS_REGULATORIAS = [
  {
    orgao: 'Proibido',
    motivo: 'importacao e venda proibidas ou restritas no Brasil',
    re: /cigarro eletronico|\bvape\b|\bpod descartavel|narguile eletronico|anabolizante|peptideo|esteroide|\bsarms?\b/,
  },
  {
    orgao: 'Anatel',
    motivo: 'emite radiofrequencia ou carrega bateria de celular; exige homologacao',
    // "celular" sozinho fica de fora: capa, suporte e ferramenta "para
    // celular" nao sao produtos de telecomunicacao.
    re: /bluetooth|wi-?fi|wireless|sem fio|^celular\b|smartphone|\btelefone\b|carregador|power ?bank|roteador|repetidor|radios? comunicador|walkie|smartwatch|relogio inteligente|drone|\btws\b|baba eletronica/,
  },
  {
    orgao: 'Anvisa',
    motivo: 'produto de saude, cosmetico, suplemento ou alimento; exige regularizacao',
    re: /suplemento|vitamina|whey|creatina|cosmetic|creme|serum|protetor solar|medicamento|shampoo|condicionador|perfume|maquiagem|esmalte|termometro|oximetro|medidor de pressao|glicosimetro|massageador|lente de contato|preservativo|repelente/,
  },
  {
    orgao: 'Inmetro',
    motivo: 'certificacao compulsoria provavel',
    re: /brinquedo|boneca|capacete|cadeirinha|berco|carrinho de bebe|chupeta|mamadeira|panela de pressao|ventilador|air ?fryer|fritadeira|liquidificador|ferro de passar|secador de cabelo|chapinha|lampada|extensao eletrica|filtro de linha|isqueiro|pneu|colchao/,
  },
];

const SEM_MARCA = /^(generic[ao]|sem marca|n\/?a|outros?|oem|importad[ao]|nao se aplica|unbranded)$/;

function sinaisRegulatorios(texto) {
  const t = norm(texto);
  return REGRAS_REGULATORIAS.filter((r) => r.re.test(t)).map((r) => ({ orgao: r.orgao, motivo: r.motivo }));
}

const PALAVRAS_VAZIAS = new Set(['a', 'o', 'e', 'de', 'do', 'da', 'em', 'com', 'para', 'por', 'sem']);

// Um termo em alta "bate" com o produto quando todas as suas palavras
// aparecem inteiras no nome. Numeros e siglas curtas contam: "iphone 11" nao
// pode bater com qualquer acessorio "para iPhone", nem "radio px" com
// qualquer radio.
function termosRelacionados(nome, termos) {
  const alvo = new Set(norm(nome).split(/[^a-z0-9]+/).filter(Boolean));
  const achados = [];
  for (const termo of termos) {
    const palavras = norm(termo).split(/[^a-z0-9]+/).filter((w) => w && !PALAVRAS_VAZIAS.has(w));
    if (palavras.length && palavras.every((w) => alvo.has(w))) achados.push(termo);
    if (achados.length >= 5) break;
  }
  return achados;
}

function calcularPrioridade(p) {
  const comp = {};
  comp.posicao_no_ranking = Math.max(0, 21 - (p.melhor_posicao || 21)) * 2;
  comp.presenca_em_varias_categorias = Math.min(3, p.aparicoes.length - 1) * 5;
  comp.termo_em_alta = p.tendencias_relacionadas && p.tendencias_relacionadas.length ? 15 : 0;
  comp.sem_marca_registrada = p.sinais.sem_marca ? 15 : 0;
  const n = p.anuncios && p.anuncios.quantidade_anuncios;
  comp.poucos_anuncios_concorrentes = n === undefined ? 0 : (n <= 3 ? 10 : (n <= 10 ? 5 : 0));
  comp.alerta_regulatorio = -15 * p.sinais.regulatorio.filter((r) => r.orgao !== 'Proibido').length;
  let pontos = Object.values(comp).reduce((a, b) => a + b, 0);
  if (p.sinais.regulatorio.some((r) => r.orgao === 'Proibido')) {
    comp.proibido = -pontos;
    pontos = 0;
  }
  return { pontos: Math.max(0, Math.min(100, pontos)), componentes: comp };
}

/* ------------------------------------------------------------------ */
/* Coleta                                                              */
/* ------------------------------------------------------------------ */

// Le uma categoria e devolve o no com nome, caminho, foto e filhas.
async function lerCategoria(id) {
  const c = await apiGet(`/categories/${id}`);
  const caminho = Array.isArray(c.path_from_root) && c.path_from_root.length
    ? c.path_from_root.map((p) => p.name)
    : [c.name];
  return {
    id: c.id || id,
    nome: c.name,
    caminho: caminho.join(' > '),
    nivel: caminho.length,
    foto: c.picture || undefined,
    link: c.permalink || undefined,
    total_anuncios: c.total_items_in_this_category,
    filhas: Array.isArray(c.children_categories) ? c.children_categories : [],
  };
}

// Desce a arvore ate a profundidade pedida. Em cada nivel fica com as
// subcategorias que tem mais anuncios, que e a ordem de relevancia que a
// propria API oferece.
async function montarArvore(raizId, profundidade, maxSub) {
  const raiz = await lerCategoria(raizId);
  const nos = [raiz];
  let fronteira = [raiz];
  for (let nivel = 0; nivel < profundidade; nivel += 1) {
    const escolhidas = [];
    for (const pai of fronteira) {
      const filhas = pai.filhas
        .filter((f) => f && f.id && norm(f.name) !== 'outros')
        .sort((a, b) => (b.total_items_in_this_category || 0) - (a.total_items_in_this_category || 0))
        .slice(0, maxSub);
      for (const f of filhas) escolhidas.push({ id: f.id, pai: pai.id });
    }
    if (!escolhidas.length) break;
    const lidas = await mapLimit(escolhidas, PARALELO, async (f) => {
      try {
        const no = await lerCategoria(f.id);
        no.pai = f.pai;
        return no;
      } catch (_) {
        return null;
      }
    });
    fronteira = lidas.filter(Boolean);
    nos.push(...fronteira);
  }
  return nos;
}

// Ranking e termos em alta de uma categoria. Categorias sem dados respondem
// 404; isso e normal em nichos pequenos e conta como lista vazia.
async function lerSinaisDaCategoria(no) {
  const tolerante = async (path) => {
    try { return await apiGet(path); } catch (err) {
      if (err.status === 404 || err.status === 403) return null;
      throw err;
    }
  };
  const [destaques, tendencias] = await Promise.all([
    tolerante(`/highlights/${SITE}/category/${no.id}`),
    tolerante(`/trends/${SITE}/${no.id}`),
  ]);
  no.ranking = destaques && Array.isArray(destaques.content) ? destaques.content : [];
  no.termos_em_alta = Array.isArray(tendencias) ? tendencias.map((t) => t.keyword).filter(Boolean) : [];
}

async function detalharProduto(p) {
  let cru;
  try {
    cru = await apiGet(pathForProduct(p.id, p.tipo));
  } catch (err) {
    p.detalhe_indisponivel = err.status ? `HTTP ${err.status}` : err.message;
    return;
  }
  cru = cru || {};
  // Guarda qualquer campo de vendas que a API mandar, sem interpretar.
  const vendas = findSalesFields(cru);
  const fotos = photosOf(cru, 4);
  Object.assign(p, dropEmpty({
    nome: cru.name || cru.title,
    marca: brandOf(cru.attributes),
    familia: cru.family_name,
    dominio: cru.domain_id,
    foto: fotos[0],
    fotos: fotos.length > 1 ? fotos : undefined,
    destaques: Array.isArray(cru.main_features)
      ? cru.main_features.slice(0, 6).map((f) => f && (f.text || f)).filter(Boolean)
      : undefined,
    atributos: Array.isArray(cru.attributes)
      ? cru.attributes.slice(0, 15).map((a) => ({ nome: a.name || a.id, valor: a.value_name })).filter((a) => a.valor)
      : undefined,
  }));
  Object.assign(p, publicLink(p.id, p.tipo, cru.permalink));
  if (Object.keys(vendas).length) p.campos_de_venda = vendas;
  if (String(p.tipo).toUpperCase() !== 'PRODUCT') {
    if (typeof cru.price === 'number') p.anuncios = { quantidade_anuncios: 1, menor_preco: { valor: cru.price, moeda: cru.currency_id } };
    return;
  }
  try {
    const anuncios = await apiGet(`/products/${p.id}/items`);
    p.anuncios = summarizeListings(anuncios);
    const vendasDosAnuncios = findSalesFields(anuncios);
    if (Object.keys(vendasDosAnuncios).length) p.campos_de_venda = { ...vendas, ...vendasDosAnuncios };
  } catch (err) {
    p.anuncios_indisponiveis = err.status ? `HTTP ${err.status}` : err.message;
  }
}

/* ------------------------------------------------------------------ */
/* Mineracao                                                           */
/* ------------------------------------------------------------------ */

async function minerarCategoria(raizId, opcoes) {
  const profundidade = inteiro(opcoes.profundidade, 'profundidade');
  const maxSub = inteiro(opcoes.max_subcategorias, 'max_subcategorias');
  const maxProdutos = inteiro(opcoes.max_produtos, 'max_produtos');

  const nos = await montarArvore(raizId, profundidade, maxSub);
  await mapLimit(nos, PARALELO, lerSinaisDaCategoria);
  const porId = new Map(nos.map((n) => [n.id, n]));

  // Junta as aparicoes de cada produto em todos os rankings lidos.
  const produtos = new Map();
  for (const no of nos) {
    for (const item of no.ranking) {
      if (!item || !item.id) continue;
      let p = produtos.get(item.id);
      if (!p) {
        p = { id: item.id, tipo: item.type || 'PRODUCT', aparicoes: [] };
        produtos.set(item.id, p);
      }
      p.aparicoes.push({ categoria_id: no.id, categoria: no.caminho, posicao: item.position });
    }
  }

  for (const p of produtos.values()) {
    p.melhor_posicao = Math.min(...p.aparicoes.map((a) => a.posicao || 99));
    // A categoria do produto e a mais especifica em que ele aparece; em caso
    // de empate, a de melhor posicao.
    const casa = p.aparicoes.slice().sort((a, b) => {
      const dn = porId.get(b.categoria_id).nivel - porId.get(a.categoria_id).nivel;
      return dn || (a.posicao || 99) - (b.posicao || 99);
    })[0];
    p.categoria_id = casa.categoria_id;
    p.categoria = casa.categoria;
  }

  // Detalha primeiro quem esta melhor colocado e em mais rankings.
  const fila = Array.from(produtos.values()).sort((a, b) =>
    a.melhor_posicao - b.melhor_posicao || b.aparicoes.length - a.aparicoes.length);
  const escolhidos = fila.slice(0, maxProdutos);
  await mapLimit(escolhidos, PARALELO, detalharProduto);

  for (const p of escolhidos) {
    const no = porId.get(p.categoria_id);
    const termos = new Set();
    for (const a of p.aparicoes) for (const t of porId.get(a.categoria_id).termos_em_alta) termos.add(t);
    p.tendencias_relacionadas = p.nome ? termosRelacionados(p.nome, termos) : [];
    const marca = norm(p.marca).trim();
    p.sinais = {
      sem_marca: Boolean(p.nome) && (!marca || SEM_MARCA.test(marca)),
      // So o nome do produto entra: o nome da categoria marcaria tudo dentro
      // de "Celulares e Telefones", ate um jogo de chaves de precisao.
      regulatorio: sinaisRegulatorios(p.nome),
    };
    p.prioridade = calcularPrioridade(p);
  }

  const categorias = nos.map((no) => {
    const itens = escolhidos
      .filter((p) => p.categoria_id === no.id)
      .sort((a, b) => b.prioridade.pontos - a.prioridade.pontos || a.melhor_posicao - b.melhor_posicao);
    return dropEmpty({
      id: no.id,
      nome: no.nome,
      caminho: no.caminho,
      nivel: no.nivel,
      pai: no.pai,
      // Subcategorias raramente tem imagem propria; nesse caso a capa e a
      // foto do produto mais bem colocado dela.
      foto: no.foto || (itens.find((p) => p.foto) || {}).foto,
      foto_e_de_produto: !no.foto && itens.some((p) => p.foto) ? true : undefined,
      link: no.link,
      total_anuncios: no.total_anuncios,
      itens_no_ranking: no.ranking.length,
      termos_em_alta: no.termos_em_alta.slice(0, 15),
      produtos: itens,
    });
  });

  const semDetalhe = escolhidos.filter((p) => p.detalhe_indisponivel).length;
  return {
    categoria_raiz: { id: nos[0].id, nome: nos[0].nome, caminho: nos[0].caminho },
    consultado_em: new Date().toISOString(),
    parametros: { profundidade, max_subcategorias: maxSub, max_produtos: maxProdutos },
    resumo: {
      categorias_lidas: nos.length,
      categorias_com_ranking: nos.filter((n) => n.ranking.length).length,
      produtos_encontrados: produtos.size,
      produtos_detalhados: escolhidos.length - semDetalhe,
      produtos_sem_detalhe: semDetalhe,
      produtos_fora_do_limite: Math.max(0, produtos.size - escolhidos.length),
    },
    categorias,
  };
}

function todosOsProdutos(mineracao) {
  return mineracao.categorias.flatMap((c) => c.produtos);
}

module.exports = { LIMITES, minerarCategoria, norm, sinaisRegulatorios, termosRelacionados, todosOsProdutos };
