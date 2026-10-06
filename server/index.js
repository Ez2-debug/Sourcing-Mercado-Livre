#!/usr/bin/env node
'use strict';

/*
 * Conecta Hub Sourcing - servidor MCP (stdio) para a API do Mercado Livre.
 *
 * Sem dependencias externas: usa apenas o Node.js (>= 18) que ja vem com o
 * Claude Desktop. As credenciais e as chamadas a API ficam em meli.js, a
 * mineracao por categoria em mineracao.js e a gravacao em disco (catalogo e
 * pacote para o Accio Work) em saida.js.
 *
 * Nada e escrito em stdout alem das mensagens do protocolo; logs vao em stderr.
 */

const readline = require('node:readline');

const {
  SERVER_NAME, SITE, ToolError, apiGet, credentialsConfigured, log, mapLimit,
} = require('./meli');
const {
  SEM_VENDAS, categoryId, dropEmpty, findSalesFields, listingsOf, pathForProduct,
  productId, publicLink, summarizeListings, summarizeProduct,
} = require('./catalogo');
const { LIMITES, minerarCategoria, todosOsProdutos } = require('./mineracao');
const { anotarNcm, carregarTabela, sugerirNcm } = require('./ncm');
const { registrarEstimativas } = require('./estimativas');
const { salvarNoSupabase, salvarSeConfigurado } = require('./supabase');
const { exportarExcel } = require('./planilha');
const {
  carregarMineracao, dataLocal, enviarParaAccio, gerarPainel, mineracoesDoDia, regravarMineracao, resumirMineracoes, salvarMineracao,
} = require('./saida');

const SERVER_VERSION = '0.9.0';
const SUPPORTED_PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];

/* ------------------------------------------------------------------ */
/* Ferramentas                                                         */
/* ------------------------------------------------------------------ */

const AVISO_USO =
  'Dado exibido como fornecido pela API do Mercado Livre. A API nao informa volume de buscas, ' +
  'unidades vendidas nem faturamento; nao estimar esses numeros a partir da posicao.';

const AVISO_MINERACAO =
  `${AVISO_USO} A prioridade e uma regra de triagem com os componentes expostos, nao uma medida de demanda. ` +
  'Os alertas regulatorios vem de palavras-chave e precisam ser conferidos pelo NCM.';

// Versao enxuta da mineracao para a resposta da ferramenta; o resultado
// completo fica nos arquivos gravados.
function resumoDaMineracao(m, porCategoria) {
  return m.categorias.filter((c) => c.produtos.length).map((c) => dropEmpty({
    id: c.id,
    categoria: c.caminho,
    foto: c.foto,
    link: c.link,
    termos_em_alta: c.termos_em_alta.slice(0, 8),
    total_de_produtos: c.produtos.length,
    produtos: c.produtos.slice(0, porCategoria).map((p) => dropEmpty({
      id: p.id,
      nome: p.nome,
      marca: p.marca,
      foto: p.foto,
      link: p.link,
      posicao: p.melhor_posicao,
      menor_preco: p.anuncios && p.anuncios.menor_preco ? p.anuncios.menor_preco.valor : undefined,
      quantidade_anuncios: p.anuncios ? p.anuncios.quantidade_anuncios : undefined,
      prioridade: p.prioridade.pontos,
      sem_marca: p.sinais.sem_marca || undefined,
      marca_conhecida: p.sinais.marca_conhecida || undefined,
      ncm_sugerida: p.ncm ? (p.ncm.sugestoes.length ? p.ncm.sugestoes[0].codigo : `posicao ${p.ncm.posicao[0].codigo}`) : undefined,
      alertas: p.sinais.regulatorio.length ? p.sinais.regulatorio.map((r) => r.orgao) : undefined,
      em_alta: p.tendencias_relacionadas.length ? p.tendencias_relacionadas : undefined,
      detalhe_indisponivel: p.detalhe_indisponivel,
    })),
  }));
}

const FILTROS_ACCIO = {
  limite: { type: 'integer', minimum: 1, maximum: 100, description: 'Padrao 20. Quantos produtos enviar, por ordem de prioridade.' },
  incluir_marcas: { type: 'boolean', description: 'Padrao false. Com true envia tambem produtos de marca conhecida (Samsung, Tramontina etc.). Marcas de vendedor ja seguem por padrao.' },
  incluir_regulados: { type: 'boolean', description: 'Padrao false. Com true envia tambem produtos com alerta de Anatel, Anvisa ou Inmetro. Proibidos nunca sao enviados.' },
};

function filtrosAccio(args) {
  return { limite: args.limite, incluir_marcas: args.incluir_marcas, incluir_regulados: args.incluir_regulados };
}

const TOOLS = [
  {
    name: 'listar_categorias',
    description:
      'Lista as categorias principais do Mercado Livre Brasil com seus codigos (MLB...). ' +
      'Use primeiro para descobrir o categoria_id das outras ferramentas.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    async run() {
      const data = await apiGet(`/sites/${SITE}/categories`);
      const list = Array.isArray(data) ? data : [];
      return { total: list.length, categorias: list.map((c) => ({ id: c.id, nome: c.name })) };
    },
  },
  {
    name: 'detalhar_categoria',
    description:
      'Mostra o nome, a foto, o link, o caminho de uma categoria e suas subcategorias com codigos. ' +
      'Use para descer de uma categoria ampla ate um nicho antes de pedir tendencias ou mais vendidos.',
    inputSchema: {
      type: 'object',
      properties: { categoria_id: { type: 'string', description: 'Codigo da categoria, por exemplo MLB1051.' } },
      required: ['categoria_id'],
      additionalProperties: false,
    },
    async run(args) {
      const id = categoryId(args.categoria_id, true);
      const c = await apiGet(`/categories/${id}`);
      return dropEmpty({
        id: c.id,
        nome: c.name,
        foto: c.picture || undefined,
        link: c.permalink || undefined,
        total_anuncios: c.total_items_in_this_category,
        caminho: Array.isArray(c.path_from_root) ? c.path_from_root.map((p) => ({ id: p.id, nome: p.name })) : [],
        subcategorias: Array.isArray(c.children_categories)
          ? c.children_categories.map((s) => ({ id: s.id, nome: s.name, total_anuncios: s.total_items_in_this_category }))
          : [],
      });
    },
  },
  {
    name: 'tendencias',
    description:
      'Termos de busca em alta no Mercado Livre Brasil na ultima semana (ate 50), em ordem de relevancia. ' +
      'Sem categoria_id traz o ranking nacional; com categoria_id traz o da categoria. ' +
      'Devolve apenas o termo e o link da listagem: nao ha volume nem percentual de crescimento.',
    inputSchema: {
      type: 'object',
      properties: {
        categoria_id: { type: 'string', description: 'Opcional. Codigo da categoria, por exemplo MLB1051.' },
      },
      additionalProperties: false,
    },
    async run(args) {
      const id = categoryId(args.categoria_id, false);
      const data = await apiGet(id ? `/trends/${SITE}/${id}` : `/trends/${SITE}`);
      const list = Array.isArray(data) ? data : [];
      return {
        escopo: id ? `categoria ${id}` : 'Brasil (todas as categorias)',
        atualizacao: 'semanal',
        total: list.length,
        termos: list.map((t, i) => ({ posicao: i + 1, termo: t.keyword, link: t.url })),
        aviso: AVISO_USO,
      };
    },
  },
  {
    name: 'mais_vendidos',
    description:
      'Ranking dos 20 produtos mais vendidos de uma categoria do Mercado Livre Brasil. ' +
      'Cada item vem com o link da pagina do produto. Por padrao busca tambem nome, marca, foto, menor preco e ' +
      'quantidade de anuncios (duas chamadas extras por item). Devolve a posicao no ranking, nunca a quantidade vendida.',
    inputSchema: {
      type: 'object',
      properties: {
        categoria_id: { type: 'string', description: 'Codigo da categoria, por exemplo MLB1051.' },
        detalhar: {
          type: 'boolean',
          description: 'Padrao true. Com false devolve so id, posicao e tipo, mais rapido.',
        },
      },
      required: ['categoria_id'],
      additionalProperties: false,
    },
    async run(args) {
      const id = categoryId(args.categoria_id, true);
      const detalhar = args.detalhar !== false;
      const data = await apiGet(`/highlights/${SITE}/category/${id}`);
      const content = data && Array.isArray(data.content) ? data.content : [];
      // O link vai em todos os itens, mesmo quando o detalhe nao e buscado ou falha.
      let itens = content.map((c) => ({ posicao: c.position, id: c.id, tipo: c.type, ...publicLink(c.id, c.type) }));
      let semDetalhe = 0;
      if (detalhar && itens.length) {
        itens = await mapLimit(itens, 4, async (item) => {
          try {
            const p = await apiGet(pathForProduct(item.id, item.tipo));
            const s = summarizeProduct(p || {}, false, item.id, item.tipo);
            delete s.id;
            const out = { posicao: item.posicao, id: item.id, tipo: item.tipo, ...s };
            // O preco de um produto de catalogo esta nos anuncios dele.
            if (String(item.tipo).toUpperCase() === 'PRODUCT') {
              try {
                const an = summarizeListings(await apiGet(`/products/${item.id}/items`));
                out.quantidade_anuncios = an.quantidade_anuncios;
                if (an.menor_preco) out.menor_preco = an.menor_preco;
              } catch (_) { /* segue sem preco */ }
            }
            return out;
          } catch (err) {
            semDetalhe += 1;
            return { ...item, detalhe_indisponivel: err.status ? `HTTP ${err.status}` : err.message };
          }
        });
      }
      const out = { categoria_id: id, total: itens.length, itens, aviso: AVISO_USO };
      if (semDetalhe) {
        out.observacao = `${semDetalhe} de ${itens.length} itens vieram sem nome e marca porque a consulta de detalhe falhou.`;
      }
      return out;
    },
  },
  {
    name: 'detalhar_produto',
    description:
      'Dados de um produto do catalogo do Mercado Livre a partir do id devolvido por mais_vendidos: ' +
      'link, nome, marca, fotos, preco de referencia, categoria, destaques e atributos. Informa se a API devolveu algum campo de vendas.',
    inputSchema: {
      type: 'object',
      properties: {
        produto_id: { type: 'string', description: 'Id do produto, por exemplo MLB54982411.' },
        tipo: {
          type: 'string',
          enum: ['PRODUCT', 'USER_PRODUCT', 'ITEM'],
          description: 'Opcional. O campo tipo devolvido por mais_vendidos; padrao PRODUCT.',
        },
      },
      required: ['produto_id'],
      additionalProperties: false,
    },
    async run(args) {
      const id = productId(args.produto_id);
      const p = await apiGet(pathForProduct(id, args.tipo));
      return summarizeProduct(p || {}, true, id, args.tipo);
    },
  },
  {
    name: 'anuncios_do_produto',
    description:
      'Lista os anuncios (ofertas de vendedores) de um produto do catalogo, com preco, vendedor e link de cada anuncio. ' +
      'Mostra tambem qualquer campo de vendas que a API devolver; se nao houver, informa que nao veio.',
    inputSchema: {
      type: 'object',
      properties: {
        produto_id: { type: 'string', description: 'Id do produto de catalogo, por exemplo MLB54982411.' },
      },
      required: ['produto_id'],
      additionalProperties: false,
    },
    async run(args) {
      const id = productId(args.produto_id);
      const data = await apiGet(`/products/${id}/items`);
      const list = listingsOf(data);
      const anuncios = list.slice(0, 30).map((it) => {
        const itemId = it.item_id || it.id;
        const row = {
          anuncio_id: itemId,
          preco: it.price,
          moeda: it.currency_id,
          vendedor_id: it.seller_id,
          loja_oficial_id: it.official_store_id || undefined,
          frete_gratis: it.shipping ? it.shipping.free_shipping : undefined,
          condicao: it.condition,
          ...(itemId ? publicLink(itemId, 'ITEM', it.permalink) : {}),
        };
        const vendas = findSalesFields(it);
        if (Object.keys(vendas).length) row.campos_de_venda = vendas;
        return dropEmpty(row);
      });
      const out = {
        produto_id: id,
        ...publicLink(id, 'PRODUCT'),
        total_devolvido: list.length,
        anuncios,
      };
      if (!anuncios.some((a) => a.campos_de_venda)) out.vendas = SEM_VENDAS;
      if (!list.length && data && typeof data === 'object') out.campos_disponiveis = Object.keys(data).slice(0, 40);
      return out;
    },
  },
  {
    name: 'minerar_categoria',
    description:
      'Mineracao de produtos por categoria. Parte de uma categoria, desce pelas subcategorias, cruza o ranking de mais ' +
      'vendidos de cada uma com os termos em alta e com os anuncios de cada produto, e devolve os produtos agrupados pela ' +
      'categoria mais especifica em que aparecem, com o nome que o site usa, foto, menor preco, concorrencia, alertas ' +
      'regulatorios, uma prioridade de triagem e sugestoes de produto. Grava em disco o resultado completo, um catalogo ' +
      'HTML com fotos e um painel HTML de indicadores. ' +
      'Faz muitas chamadas a API e pode levar de um a tres minutos. Com enviar_para_accio=true ja entrega o pacote ao Accio Work.',
    inputSchema: {
      type: 'object',
      properties: {
        categoria_id: { type: 'string', description: 'Codigo da categoria de partida, por exemplo MLB1051.' },
        profundidade: {
          type: 'integer', minimum: LIMITES.profundidade.min, maximum: LIMITES.profundidade.max,
          description: 'Padrao 1. Quantos niveis de subcategoria descer; 0 minera so a categoria informada.',
        },
        max_subcategorias: {
          type: 'integer', minimum: LIMITES.max_subcategorias.min, maximum: LIMITES.max_subcategorias.max,
          description: 'Padrao 8. Quantas subcategorias ler por categoria, das que tem mais anuncios.',
        },
        max_produtos: {
          type: 'integer', minimum: LIMITES.max_produtos.min, maximum: LIMITES.max_produtos.max,
          description: 'Padrao 40. Quantos produtos detalhar, dos mais bem colocados.',
        },
        enviar_para_accio: { type: 'boolean', description: 'Padrao false. Com true grava tambem o pacote na pasta do Accio Work.' },
        ...FILTROS_ACCIO,
      },
      required: ['categoria_id'],
      additionalProperties: false,
    },
    async run(args) {
      const id = categoryId(args.categoria_id, true);
      const m = await minerarCategoria(id, args);
      m.ncm = await anotarNcm(todosOsProdutos(m));
      const arquivos = salvarMineracao(m);
      const out = {
        mineracao_id: arquivos.id,
        categoria_raiz: m.categoria_raiz,
        consultado_em: m.consultado_em,
        resumo: m.resumo,
        arquivos: { painel_html: arquivos.painel, catalogo_html: arquivos.catalogo, dados_json: arquivos.dados },
        sugestoes: arquivos.indicadores.sugestoes,
        vendas: arquivos.indicadores.vendas.observacao,
        ncm: arquivos.indicadores.ncm,
        supabase: await salvarSeConfigurado(m),
        categorias: resumoDaMineracao(m, 8),
        aviso: AVISO_MINERACAO,
      };
      if (args.enviar_para_accio === true) {
        try {
          out.accio = enviarParaAccio(m, filtrosAccio(args));
        } catch (err) {
          if (!(err instanceof ToolError)) throw err;
          out.accio = { erro: err.message };
        }
      }
      return out;
    },
  },
  {
    name: 'listar_mineracoes',
    description: 'Lista as mineracoes ja gravadas neste computador, da mais recente para a mais antiga.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    async run() {
      const mineracoes = resumirMineracoes();
      return { total: mineracoes.length, mineracoes };
    },
  },
  {
    name: 'painel_indicadores',
    description:
      'Indicadores de uma mineracao ja gravada: triagem para cotacao, produtos por categoria, faixas de preco, concorrencia, ' +
      'variacao de posicao em relacao a mineracao anterior da mesma categoria e sugestoes de produto com os motivos. ' +
      'Regrava o painel HTML e devolve o caminho dele. Informa o que a API devolveu sobre vendas, sem estimar.',
    inputSchema: {
      type: 'object',
      properties: {
        mineracao_id: { type: 'string', description: 'Opcional. Id devolvido por minerar_categoria; sem ele usa a mineracao mais recente.' },
      },
      additionalProperties: false,
    },
    async run(args) {
      const m = carregarMineracao(args.mineracao_id);
      const { painel, indicadores } = gerarPainel(m);
      return { painel_html: painel, ...indicadores, aviso: AVISO_MINERACAO };
    },
  },
  {
    name: 'registrar_vendas_estimadas',
    description:
      'Registra em uma mineracao as estimativas de venda de uma fonte externa de inteligencia de mercado (por exemplo o conector JoomPulse), ' +
      'produto a produto, e regrava o painel com elas. Use depois de consultar a fonte para os produtos minerados. ' +
      'Os numeros entram como a fonte informou e saem sempre rotulados como estimativa de terceiros, nunca como dado do Mercado Livre.',
    inputSchema: {
      type: 'object',
      properties: {
        mineracao_id: { type: 'string', description: 'Opcional. Id devolvido por minerar_categoria; sem ele usa a mineracao mais recente.' },
        fonte: { type: 'string', description: 'Nome da fonte das estimativas, por exemplo JoomPulse.' },
        periodo: { type: 'string', enum: ['semanal', 'mensal'], description: 'Padrao semanal. Periodo a que os numeros se referem.' },
        estimativas: {
          type: 'array',
          minItems: 1,
          description: 'Uma entrada por produto da mineracao.',
          items: {
            type: 'object',
            properties: {
              produto_id: { type: 'string', description: 'Id do produto na mineracao, por exemplo MLB54982411.' },
              vendas: { type: 'number', minimum: 0, description: 'Unidades vendidas estimadas no periodo.' },
              faturamento: { type: 'number', minimum: 0, description: 'Faturamento estimado no periodo, em reais.' },
              avaliacao: { type: 'number', minimum: 0, description: 'Nota media do produto.' },
              avaliacoes: { type: 'number', minimum: 0, description: 'Quantidade de avaliacoes.' },
            },
            required: ['produto_id'],
            additionalProperties: false,
          },
        },
      },
      required: ['fonte', 'estimativas'],
      additionalProperties: false,
    },
    async run(args) {
      const m = carregarMineracao(args.mineracao_id);
      const registro = registrarEstimativas(m, args);
      const { painel, indicadores } = regravarMineracao(m);
      return {
        mineracao_id: m.id,
        ...registro,
        painel_html: painel,
        estimativas_externas: indicadores.estimativas_externas,
        supabase: await salvarSeConfigurado(m),
      };
    },
  },
  {
    name: 'sugerir_ncm',
    description:
      'Sugere a posicao da NCM e ate tres codigos de 8 digitos para um produto, a partir da descricao, usando a tabela oficial ' +
      'de nomenclatura do Portal Unico Siscomex. E ponto de partida para a classificacao, nao classificacao fiscal: nao informa ' +
      'aliquotas e precisa ser confirmada com o despachante.',
    inputSchema: {
      type: 'object',
      properties: {
        descricao: { type: 'string', description: 'Nome do produto como no anuncio, comecando pelo tipo do produto.' },
        material: { type: 'string', description: 'Opcional. Material principal, por exemplo algodao, vidro, aco inox.' },
      },
      required: ['descricao'],
      additionalProperties: false,
    },
    async run(args) {
      const descricao = String(args.descricao === undefined || args.descricao === null ? '' : args.descricao).trim();
      if (descricao.length < 3) throw new ToolError('Informe a descricao do produto.');
      let t;
      try { t = await carregarTabela(); } catch (err) { throw new ToolError(err.message); }
      const s = sugerirNcm(t, descricao, args.material);
      const tabela = { vigencia: t.vigencia, ato: t.ato, fonte: 'Portal Unico Siscomex' };
      if (!s) {
        return { descricao, sugestao: null, motivo: 'O tipo de produto nao esta no dicionario de posicoes (server/ncm-posicoes.js).', tabela };
      }
      return { descricao, ...s, tabela };
    },
  },
  {
    name: 'salvar_no_supabase',
    description:
      'Grava uma mineracao no banco do projeto Supabase configurado na extensao: a mineracao com os indicadores, as categorias e ' +
      'os produtos com triagem, NCM sugerida e estimativas de terceiros. Rodar de novo atualiza as mesmas linhas. ' +
      'Com o Supabase configurado, minerar_categoria e registrar_vendas_estimadas ja gravam sozinhas.',
    inputSchema: {
      type: 'object',
      properties: {
        mineracao_id: { type: 'string', description: 'Opcional. Id devolvido por minerar_categoria; sem ele usa a mineracao mais recente.' },
      },
      additionalProperties: false,
    },
    async run(args) {
      return salvarNoSupabase(carregarMineracao(args.mineracao_id));
    },
  },
  {
    name: 'exportar_excel',
    description:
      'Gera uma planilha Excel (.xlsx) com os produtos minerados: foto na celula, nome com link, categoria, posicao, menor preco, ' +
      'marca, situacao na triagem, alertas, NCM sugerida, prioridade e os links do produto, do menor preco e da foto. ' +
      'Exporta uma mineracao (mineracao_id) ou todas as de um dia (data); sem nenhum dos dois, a mineracao mais recente. ' +
      'Baixa as fotos do Mercado Livre, entao pode levar alguns segundos.',
    inputSchema: {
      type: 'object',
      properties: {
        mineracao_id: { type: 'string', description: 'Opcional. Id devolvido por minerar_categoria.' },
        data: { type: 'string', description: 'Opcional. Dia das mineracoes, no formato AAAA-MM-DD, ou "hoje". Se a mesma categoria foi minerada mais de uma vez no dia, entra a mais recente.' },
      },
      additionalProperties: false,
    },
    async run(args) {
      if (args.data !== undefined && args.data !== null && args.data !== '') {
        const bruto = String(args.data).trim().toLowerCase();
        const data = bruto === 'hoje' ? dataLocal(new Date().toISOString()) : bruto;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) throw new ToolError(`data invalida: "${args.data}". Use AAAA-MM-DD ou "hoje".`);
        const lista = mineracoesDoDia(data);
        if (!lista.length) throw new ToolError(`Nenhuma mineracao gravada em ${data}. Use listar_mineracoes para ver as datas.`);
        return exportarExcel(lista, data);
      }
      const m = carregarMineracao(args.mineracao_id);
      return exportarExcel([m], m.id);
    },
  },
  {
    name: 'enviar_para_accio',
    description:
      'Envia os produtos de uma mineracao ja gravada para o Accio Work: grava na pasta do Accio um briefing de sourcing ' +
      'com fotos, o JSON dos produtos e o catalogo HTML, e devolve o pedido pronto para colar no Accio. ' +
      'Por padrao deixa de fora marcas conhecidas e produtos com alerta regulatorio.',
    inputSchema: {
      type: 'object',
      properties: {
        mineracao_id: { type: 'string', description: 'Opcional. Id devolvido por minerar_categoria; sem ele usa a mineracao mais recente.' },
        ...FILTROS_ACCIO,
      },
      additionalProperties: false,
    },
    async run(args) {
      const m = carregarMineracao(args.mineracao_id);
      return { mineracao_id: m.id, categoria_raiz: m.categoria_raiz, ...enviarParaAccio(m, filtrosAccio(args)) };
    },
  },
  {
    name: 'consulta_api',
    description:
      'Consulta de diagnostico: faz um GET em um caminho da API do Mercado Livre e devolve a resposta crua (cortada se for longa). ' +
      'Use para conferir quais campos um recurso realmente traz. So aceita recursos de catalogo e mercado: ' +
      '/products, /items, /user-products, /sites/MLB, /categories, /trends, /highlights, /domains.',
    inputSchema: {
      type: 'object',
      properties: {
        caminho: { type: 'string', description: 'Caminho comecando com /, por exemplo /products/MLB54982411.' },
      },
      required: ['caminho'],
      additionalProperties: false,
    },
    async run(args) {
      const caminho = String(args.caminho === undefined || args.caminho === null ? '' : args.caminho).trim();
      const allowed = ['/products', '/items', '/user-products', `/sites/${SITE}`, '/categories', '/trends', '/highlights', '/domains'];
      const pathOnly = caminho.split('?')[0];
      const okShape = /^\/[A-Za-z0-9_\-/.,:%?=&$]*$/.test(caminho) && !caminho.includes('..') && !caminho.includes('//');
      const okPrefix = allowed.some((p) => pathOnly === p || pathOnly.startsWith(`${p}/`));
      if (!okShape || !okPrefix) {
        throw new ToolError(`Caminho nao permitido: "${caminho}". Use um destes inicios: ${allowed.join(', ')}.`);
      }
      const data = await apiGet(caminho);
      const text = JSON.stringify(data, null, 1);
      const LIMITE = 15000;
      if (text.length <= LIMITE) return { caminho, resposta: data };
      return { caminho, truncado: true, tamanho_total: text.length, resposta_texto: text.slice(0, LIMITE) };
    },
  },
];

const INSTRUCTIONS = [
  'Ferramentas de consulta ao Mercado Livre Brasil para apoiar sourcing e importacao (Conecta Hub).',
  'Fluxo usual: listar_categorias -> detalhar_categoria -> minerar_categoria -> painel_indicadores -> enviar_para_accio.',
  'A NCM sugerida e ponto de partida para o despachante: apresentar sempre como sugestao, sem aliquota.',
  'Estimativas de venda: se houver um conector de inteligencia de mercado nesta conversa (por exemplo JoomPulse), consultar nele os produtos sugeridos pela mineracao e gravar o resultado com registrar_vendas_estimadas. Apresentar esses numeros sempre como estimativa da fonte, nunca como venda real nem como dado do Mercado Livre.',
  'As sugestoes de produto vem com motivos e ressalvas; apresentar os dois. Minerar a mesma categoria de novo, dias depois, mostra quem subiu e quem desceu no ranking.',
  'Para uma consulta rapida: tendencias e mais_vendidos -> detalhar_produto -> anuncios_do_produto.',
  'Ao apresentar uma mineracao, agrupar por categoria com o nome exatamente como veio (campo categoria) e mostrar a foto de cada categoria e de cada produto.',
  'Sempre mostrar o link de cada produto ou anuncio citado. Links com link_montado=true foram montados pelo padrao do site e podem nao abrir.',
  'Regras ao apresentar os dados:',
  '1. A API devolve ordem (posicao), nao quantidade. Nao inventar nem estimar unidades vendidas, faturamento, conversao ou giro. Se o usuario pedir dados de vendas, mostrar apenas o que vier em campos_de_venda; se nao vier nada, dizer que a API nao informa.',
  '2. Os termos de uso do Mercado Livre exigem autorizacao para publicar estatisticas derivadas (vendas, preco medio por categoria, taxas de conversao). Exibir o ranking como veio e indicar a data da consulta.',
  '3. Ao sugerir produtos para importacao, sinalizar termos que sao marca registrada e produtos regulados ou proibidos no Brasil (por exemplo cigarros eletronicos, medicamentos, anabolizantes, peptideos), em vez de recomenda-los.',
  '4. A prioridade da mineracao e uma regra de triagem; apresentar como ordem de analise, nunca como previsao de venda.',
].join('\n');

/* ------------------------------------------------------------------ */
/* Protocolo MCP sobre stdio (JSON-RPC, uma mensagem por linha)        */
/* ------------------------------------------------------------------ */

function send(msg) {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

function reply(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function replyError(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

async function handle(msg) {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg) || msg.jsonrpc !== '2.0') return;
  const hasId = msg.id !== undefined && msg.id !== null;
  if (typeof msg.method !== 'string') return; // resposta a algo que nao pedimos

  switch (msg.method) {
    case 'initialize': {
      const asked = msg.params && msg.params.protocolVersion;
      reply(msg.id, {
        protocolVersion: SUPPORTED_PROTOCOLS.includes(asked) ? asked : SUPPORTED_PROTOCOLS[0],
        capabilities: { tools: {} },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
        instructions: INSTRUCTIONS,
      });
      return;
    }
    case 'ping':
      if (hasId) reply(msg.id, {});
      return;
    case 'tools/list':
      reply(msg.id, {
        tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
      });
      return;
    case 'tools/call': {
      const params = msg.params || {};
      const tool = TOOLS.find((t) => t.name === params.name);
      if (!tool) {
        replyError(msg.id, -32602, `Ferramenta desconhecida: ${params.name}`);
        return;
      }
      try {
        const args = params.arguments && typeof params.arguments === 'object' ? params.arguments : {};
        const result = await tool.run(args);
        reply(msg.id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
      } catch (err) {
        const text = err instanceof ToolError ? err.message : `Erro inesperado: ${err && err.message}`;
        if (!(err instanceof ToolError)) log(err && err.stack ? err.stack : String(err));
        reply(msg.id, { content: [{ type: 'text', text }], isError: true });
      }
      return;
    }
    case 'resources/list':
      if (hasId) reply(msg.id, { resources: [] });
      return;
    case 'prompts/list':
      if (hasId) reply(msg.id, { prompts: [] });
      return;
    default:
      // Notificacoes (sem id) sao ignoradas; pedidos desconhecidos recebem erro.
      if (hasId) replyError(msg.id, -32601, `Metodo nao suportado: ${msg.method}`);
  }
}

function main() {
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  let pending = 0;
  let closed = false;
  const maybeExit = () => { if (closed && pending === 0) process.exit(0); };

  rl.on('line', (line) => {
    const text = line.trim();
    if (!text) return;
    let msg;
    try {
      msg = JSON.parse(text);
    } catch (_) {
      replyError(null, -32700, 'JSON invalido');
      return;
    }
    pending += 1;
    handle(msg)
      .catch((err) => log(`falha ao tratar mensagem: ${err && err.message}`))
      .finally(() => { pending -= 1; maybeExit(); });
  });
  rl.on('close', () => { closed = true; maybeExit(); });

  log(`iniciado (credenciais ${credentialsConfigured() ? 'configuradas' : 'ausentes'})`);
}

main();
