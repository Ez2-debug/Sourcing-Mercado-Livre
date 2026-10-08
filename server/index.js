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
const { LIMITES, completarDatasDeCatalogo, minerarCategoria, todosOsProdutos } = require('./mineracao');
const { anotarNcm, carregarTabela, sugerirNcm } = require('./ncm');
const { MAX_POR_CONSULTA, consultaJoomPulse, estimativasDoJoomPulse, registrarEstimativas } = require('./estimativas');
const { salvarNoSupabase, salvarSeConfigurado } = require('./supabase');
const { exportarExcel } = require('./planilha');
const { definirFila, lerFila, ordenarFila } = require('./fila');
const { planilhaDoSourcing } = require('./sourcing');
const { calcularIndicadores, situacao } = require('./indicadores');
const { executarMineracao, minerarProximaDaFila, tolerante } = require('./automacao');
const {
  carregarMineracao, dataLocal, enviarParaAccio, gerarPainel, listarMineracoes, mineracoesDoDia, regravarMineracao,
  resumirMineracoes, salvarMineracao,
} = require('./saida');

const SERVER_VERSION = '0.24.0';
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

// Mineracoes gravadas antes da versao 0.12 nao tem a data de catalogo. Busca
// o que falta e regrava, para a planilha sair completa.
async function comDatasDeCatalogo(mineracoes) {
  for (const m of mineracoes) {
    const feitos = await completarDatasDeCatalogo(todosOsProdutos(m));
    if (feitos) regravarMineracao(m);
  }
  return mineracoes;
}

// "hoje" (padrao) ou AAAA-MM-DD, no horario deste computador.
function resolverData(valor) {
  const bruto = String(valor === undefined || valor === null || valor === '' ? 'hoje' : valor).trim().toLowerCase();
  const data = bruto === 'hoje' ? dataLocal(new Date().toISOString()) : bruto;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) throw new ToolError(`data invalida: "${valor}". Use AAAA-MM-DD ou "hoje".`);
  return data;
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
      const { m, arquivos, supabase } = await executarMineracao(id, args);
      const out = {
        mineracao_id: arquivos.id,
        categoria_raiz: m.categoria_raiz,
        consultado_em: m.consultado_em,
        resumo: m.resumo,
        arquivos: { painel_html: arquivos.painel, catalogo_html: arquivos.catalogo, dados_json: arquivos.dados },
        sugestoes: arquivos.indicadores.sugestoes,
        vendas: arquivos.indicadores.vendas.observacao,
        ncm: arquivos.indicadores.ncm,
        supabase,
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
      'Registra em uma mineracao as estimativas de venda e a tendencia de uma fonte externa de inteligencia de mercado (por exemplo o conector JoomPulse), ' +
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
              crescimento_percentual: { type: 'number', description: 'Variacao das vendas no periodo informada pela fonte, em porcento; negativo se caiu.' },
              tendencia: { type: 'string', description: 'Tendencia informada pela fonte, em poucas palavras: por exemplo subindo, estavel, caindo.' },
              dias_de_anuncio: { type: 'number', minimum: 0, description: 'Ha quantos dias o anuncio esta no ar, segundo a fonte. Sem tendencia informada, anuncio de ate 180 dias com vendas sai marcado como novo ou recente.' },
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
    name: 'preparar_consulta_joompulse',
    description:
      'Monta a consulta para o conector JoomPulse (ferramenta query_cubejs_meli) com os produtos de catalogo minerados em um dia que ainda nao ' +
      'tem estimativa de venda: primeiro os aptos para cotacao, depois os demais, ate 100. Uma consulta cobre todos; a cota do JoomPulse e mensal ' +
      'e pequena, entao faca no maximo uma por dia. Depois passe a resposta, como veio, para registrar_resposta_joompulse.',
    inputSchema: {
      type: 'object',
      properties: { data: { type: 'string', description: 'Opcional. Dia no formato AAAA-MM-DD, ou "hoje" (padrao).' } },
      additionalProperties: false,
    },
    async run(args) {
      const data = resolverData(args.data);
      const pendentes = [];
      const vistos = new Set();
      for (const m of mineracoesDoDia(data)) {
        for (const p of todosOsProdutos(m)) {
          if (!p.nome || p.estimativa_externa || vistos.has(p.id) || String(p.tipo).toUpperCase() !== 'PRODUCT') continue;
          vistos.add(p.id);
          pendentes.push(p);
        }
      }
      pendentes.sort((a, b) => Number(situacao(b) === 'apto') - Number(situacao(a) === 'apto') || b.prioridade.pontos - a.prioridade.pontos);
      const ids = pendentes.slice(0, MAX_POR_CONSULTA).map((p) => p.id);
      if (!ids.length) return { data, produtos: 0, observacao: 'Nenhum produto de catalogo sem estimativa neste dia. Nao consulte o JoomPulse.' };
      return {
        data,
        produtos: ids.length,
        fora_desta_consulta: pendentes.length - ids.length,
        ferramenta: 'query_cubejs_meli',
        consulta: consultaJoomPulse(ids),
        proximo_passo: 'Chame query_cubejs_meli com o campo "query" igual a "consulta" e passe o resultado inteiro para registrar_resposta_joompulse.',
      };
    },
  },
  {
    name: 'registrar_resposta_joompulse',
    description:
      'Registra a resposta de query_cubejs_meli (JoomPulse) nos produtos minerados em um dia: venda e faturamento semanais estimados, avaliacoes e, ' +
      'pela idade do anuncio, a tendencia. Regrava paineis e grava no Supabase. Passe a resposta exatamente como veio (JSON com "columns" e "data"). ' +
      'Os numeros sao estimativas do JoomPulse, nao vendas reais.',
    inputSchema: {
      type: 'object',
      properties: {
        resposta: { type: 'string', description: 'O JSON devolvido por query_cubejs_meli, sem alterar.' },
        data: { type: 'string', description: 'Opcional. Dia das mineracoes, AAAA-MM-DD ou "hoje" (padrao).' },
      },
      required: ['resposta'],
      additionalProperties: false,
    },
    async run(args) {
      const data = resolverData(args.data);
      const estimativas = estimativasDoJoomPulse(args.resposta);
      const lista = mineracoesDoDia(data);
      if (!lista.length) throw new ToolError(`Nenhuma mineracao gravada em ${data}.`);
      const usados = new Set();
      const porMineracao = [];
      for (const m of lista) {
        const ids = new Set(todosOsProdutos(m).map((p) => p.id));
        const doCaso = estimativas.filter((e) => ids.has(e.produto_id));
        if (!doCaso.length) continue;
        const r = registrarEstimativas(m, { fonte: 'JoomPulse', periodo: 'semanal', estimativas: doCaso });
        regravarMineracao(m);
        for (const e of doCaso) usados.add(e.produto_id);
        porMineracao.push({ mineracao_id: m.id, categoria: m.categoria_raiz.caminho, registrados: r.registrados, supabase: await salvarSeConfigurado(m) });
      }
      if (!porMineracao.length) throw new ToolError(`Nenhum produto da resposta pertence as mineracoes de ${data}.`);
      return {
        data,
        fonte: 'JoomPulse',
        periodo: 'semanal',
        produtos_na_resposta: estimativas.length,
        registrados: usados.size,
        fora_das_mineracoes_do_dia: estimativas.length - usados.size,
        mineracoes: porMineracao,
        aviso: 'Vendas e faturamento sao estimativas do JoomPulse, calculadas por ele a partir do historico dos anuncios; nao sao vendas reais nem dado do Mercado Livre.',
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
      'marca, situacao na triagem, alertas, NCM sugerida, prioridade, desde quando esta no catalogo e os links do produto, do menor preco e da foto. ' +
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
        const data = resolverData(args.data);
        const lista = mineracoesDoDia(data);
        if (!lista.length) throw new ToolError(`Nenhuma mineracao gravada em ${data}. Use listar_mineracoes para ver as datas.`);
        return exportarExcel(await comDatasDeCatalogo(lista), data);
      }
      const m = carregarMineracao(args.mineracao_id);
      return exportarExcel(await comDatasDeCatalogo([m]), m.id);
    },
  },
  {
    name: 'planilha_do_sourcing',
    description:
      'Gera a planilha Excel do sourcing feito pelo Accio Work para uma mineracao: cada produto minerado ao lado do candidato que o Accio ' +
      'encontrou no Alibaba, com as duas fotos, fornecedor, preco e MOQ do anuncio, aderencia e links. Le o sourcing.md que o Accio grava; ' +
      'use depois que o Accio terminar a busca. Preco de anuncio nao e cotacao FOB.',
    inputSchema: {
      type: 'object',
      properties: {
        mineracao_id: { type: 'string', description: 'Opcional. Id da mineracao cujo pacote foi para o Accio; sem ele usa a mais recente.' },
        pasta: { type: 'string', description: 'Opcional. Pasta do plano do Accio (dentro da pasta do Accio Work) onde esta o sourcing.md. Sem ela, procura na pasta do pacote e depois no plano mais recente.' },
      },
      additionalProperties: false,
    },
    async run(args) {
      const pasta = args.pasta === undefined || args.pasta === null ? '' : String(args.pasta).trim();
      return planilhaDoSourcing(carregarMineracao(args.mineracao_id), pasta || undefined);
    },
  },
  {
    name: 'definir_fila',
    description:
      'Define a fila de categorias da mineracao automatica, substituindo a anterior. Cada categoria e conferida na API e guardada ' +
      'com o nome oficial. Use depois de escolher as categorias (por exemplo a partir de uma lista de CNAEs); "origem" guarda de onde cada uma veio.',
    inputSchema: {
      type: 'object',
      properties: {
        categorias: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            properties: {
              categoria_id: { type: 'string', description: 'Codigo da categoria, por exemplo MLB1574.' },
              origem: { type: 'string', description: 'Opcional. De onde veio a escolha, por exemplo o CNAE e sua descricao.' },
            },
            required: ['categoria_id'],
            additionalProperties: false,
          },
        },
        enviar_para_accio: { type: 'boolean', description: 'Padrao false. Com true, minerar_proxima tambem grava o pacote na pasta do Accio Work.' },
      },
      required: ['categorias'],
      additionalProperties: false,
    },
    async run(args) {
      return definirFila(args);
    },
  },
  {
    name: 'ver_fila',
    description: 'Mostra a fila de categorias da mineracao automatica, na ordem em que serao mineradas, com a ultima mineracao de cada uma.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    async run() {
      const fila = lerFila();
      const ordem = ordenarFila(fila, listarMineracoes());
      return { total: ordem.length, enviar_para_accio: fila.enviar_para_accio, atualizado_em: fila.atualizado_em, proxima: ordem[0] || null, categorias: ordem };
    },
  },
  {
    name: 'minerar_proxima',
    description:
      'Passo da mineracao automatica: minera a categoria da fila que esta ha mais tempo sem ser minerada, grava no Supabase (se configurado), ' +
      'atualiza a planilha Excel do dia e, se a fila pedir, grava o pacote do Accio Work. Feita para tarefas agendadas: basta chamar a cada execucao ' +
      'que a fila roda inteira. Devolve um resumo curto; o detalhe fica no painel. Pode levar de um a tres minutos.',
    inputSchema: {
      type: 'object',
      properties: {
        profundidade: { type: 'integer', minimum: LIMITES.profundidade.min, maximum: LIMITES.profundidade.max, description: 'Padrao 1.' },
        max_produtos: { type: 'integer', minimum: LIMITES.max_produtos.min, maximum: LIMITES.max_produtos.max, description: 'Padrao 40.' },
      },
      additionalProperties: false,
    },
    async run(args) {
      const { alvo, ordem, m, arquivos, supabase, planilha, accio } =
        await minerarProximaDaFila({ profundidade: args.profundidade, max_produtos: args.max_produtos });
      const out = {
        mineracao_id: m.id,
        categoria: alvo.caminho,
        origem: alvo.origem,
        resumo: m.resumo,
        triagem: arquivos.indicadores.triagem,
        sugestoes: arquivos.indicadores.sugestoes.slice(0, 5).map((s) => ({ nome: s.nome, link: s.link, menor_preco: s.menor_preco, apto: s.apto, ncm: s.ncm })),
        variacao: arquivos.indicadores.variacao
          ? {
            desde: arquivos.indicadores.variacao.consultado_em,
            subiram: arquivos.indicadores.variacao.subiram.length,
            desceram: arquivos.indicadores.variacao.desceram.length,
            entraram: arquivos.indicadores.variacao.novos.length,
            sairam: arquivos.indicadores.variacao.sairam.length,
          }
          : null,
        painel_html: arquivos.painel,
        supabase,
        planilha_do_dia: planilha,
        proxima_da_fila: (ordem[1] || alvo).caminho,
        categorias_na_fila: ordem.length,
        aviso: AVISO_MINERACAO,
      };
      if (accio) out.accio = accio;
      return out;
    },
  },
  {
    name: 'resumo_do_dia',
    description:
      'Resumo das mineracoes de um dia, para relatorios: categorias mineradas, triagem somada, os produtos aptos mais bem priorizados e o ' +
      'caminho da planilha Excel do dia (que e regravada). Quando a mesma categoria foi minerada mais de uma vez, conta a mais recente.',
    inputSchema: {
      type: 'object',
      properties: {
        data: { type: 'string', description: 'Opcional. Dia no formato AAAA-MM-DD, ou "hoje" (padrao).' },
        sugestoes: { type: 'integer', minimum: 1, maximum: 30, description: 'Padrao 10. Quantos produtos aptos listar.' },
      },
      additionalProperties: false,
    },
    async run(args) {
      const data = resolverData(args.data);
      const lista = mineracoesDoDia(data);
      if (!lista.length) return { data, mineracoes: [], observacao: 'Nenhuma mineracao gravada neste dia.' };
      const triagem = { apto: 0, marca_registrada: 0, regulado: 0, proibido: 0, sem_detalhe: 0 };
      const aptos = [];
      const mineracoes = lista.map((m) => {
        const ind = calcularIndicadores(m, null);
        for (const k of Object.keys(triagem)) triagem[k] += ind.triagem[k];
        for (const p of todosOsProdutos(m)) if (situacao(p) === 'apto') aptos.push(p);
        return { id: m.id, categoria: m.categoria_raiz.caminho, consultado_em: m.consultado_em, produtos: ind.totais.produtos, aptos: ind.triagem.apto };
      });
      aptos.sort((a, b) => b.prioridade.pontos - a.prioridade.pontos || a.melhor_posicao - b.melhor_posicao);
      const n = Number.isInteger(args.sugestoes) ? args.sugestoes : 10;
      return {
        data,
        mineracoes,
        triagem,
        produtos_aptos_em_destaque: aptos.slice(0, n).map((p) => dropEmpty({
          nome: p.nome,
          categoria: p.categoria,
          link: p.link,
          posicao: p.melhor_posicao,
          menor_preco: p.anuncios && p.anuncios.menor_preco ? p.anuncios.menor_preco.valor : undefined,
          marca: p.marca,
          ncm: p.ncm ? (p.ncm.sugestoes.length ? p.ncm.sugestoes[0].codigo : `posicao ${p.ncm.posicao[0].codigo}`) : undefined,
          prioridade: p.prioridade.pontos,
          vendas_estimadas_por_semana: p.estimativa_externa ? p.estimativa_externa.vendas : undefined,
          faturamento_estimado_por_semana: p.estimativa_externa ? p.estimativa_externa.faturamento : undefined,
          fonte_da_estimativa: p.estimativa_externa ? p.estimativa_externa.fonte : undefined,
          tendencia: p.estimativa_externa ? p.estimativa_externa.tendencia : undefined,
        })),
        planilha: await tolerante(() => exportarExcel(lista, data)),
        aviso: AVISO_MINERACAO,
      };
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
  'Mineracao automatica: definir_fila guarda as categorias, minerar_proxima minera a que esta ha mais tempo parada e resumo_do_dia consolida o dia. Tarefas agendadas devem chamar minerar_proxima, uma categoria por execucao.',
  'A NCM sugerida e ponto de partida para o despachante: apresentar sempre como sugestao, sem aliquota.',
  'Estimativas de venda pelo JoomPulse: preparar_consulta_joompulse monta a consulta do dia, query_cubejs_meli (conector JoomPulse) a executa e registrar_resposta_joompulse grava o resultado. A cota do JoomPulse e mensal e pequena: no maximo uma consulta por dia.',
  'Estimativas de venda de outra fonte: gravar com registrar_vendas_estimadas. Apresentar esses numeros sempre como estimativa da fonte, nunca como venda real nem como dado do Mercado Livre.',
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
