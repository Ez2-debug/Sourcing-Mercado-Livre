'use strict';

/*
 * Material para o agente de atendimento no Suportify (WhatsApp).
 *
 * O Suportify treina o agente com um arquivo .md de perguntas e respostas.
 * Aqui esse arquivo e gerado com as regras do servico e com os produtos do
 * dia, para o agente responder a quem chega pelo botao "Cotar importacao".
 *
 * O agente fala com cliente, entao o texto so afirma o que os dados
 * sustentam: nada de numero de vendas como fato, nada de preco final de
 * importacao, e cotacao sempre encaminhada a uma pessoa.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { cleanEnv } = require('./meli');

const AGENTE = {
  nome: 'Atendimento Conecta Market Sourcing',
  descricao: 'Atende no WhatsApp quem quer importar: explica o serviço, informa os produtos em destaque do dia e encaminha pedidos de cotação à equipe.',
  comportamento: [
    'Você é o atendente da Conecta Market Sourcing, serviço que encontra produtos em alta no Mercado Livre e na Shopee e cota fornecedores para importação.',
    'Fale em português do Brasil, de forma direta e cordial, em mensagens curtas.',
    'Responda só com o que está na base de conhecimento. Se não souber, diga que vai encaminhar à equipe.',
    'Nunca informe quantidade vendida, faturamento ou lucro como fato. Posição no ranking e "em alta" são os únicos sinais de demanda que você pode citar.',
    'Preço do Alibaba é preço de anúncio, não é cotação: nunca prometa custo final, frete, impostos ou prazo.',
    'NCM é sugestão para o despachante; não dê alíquota nem garantia de classificação.',
    'Não negocie valores e não feche pedido. Quando a pessoa quiser cotar, peça o nome, o produto (ou o código MLB) e a quantidade pretendida, e avise que a equipe retorna.',
    'Não fale de produtos proibidos ou que exijam Anvisa, Anatel ou Inmetro sem avisar que dependem de documentação.',
  ].join('\n'),
};

function pastaSuportify() {
  const base = cleanEnv(process.env.CONECTA_HUB_SAIDA);
  return path.join(base ? path.dirname(base) : path.join(os.homedir(), 'ConectaHubSourcing'), 'suportify');
}

const reais = (v) => (typeof v === 'number' ? `R$ ${v.toFixed(2).replace('.', ',')}` : null);
const umaLinha = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const pergunta = (p, r) => `Pergunta: ${umaLinha(p)}\nResposta: ${umaLinha(r)}\n`;

// entrada: { sugestoes, emAlta, cotados } com os dados do dia.
function montarBase(entrada, agora) {
  const e = entrada || {};
  const quando = (agora || new Date()).toLocaleDateString('pt-BR');
  const blocos = [
    '# Base de conhecimento — Conecta Market Sourcing',
    `Atualizada em ${quando}.`,
    '## Sobre o serviço',
    pergunta('O que é a Conecta Market Sourcing?', 'É um serviço que acompanha todos os dias os produtos mais bem colocados no Mercado Livre e na Shopee, separa os que podem ser importados sem marca e levanta fornecedores na China para cotação.'),
    pergunta('Como vocês escolhem os produtos?', 'Lemos o ranking oficial de cada categoria do Mercado Livre, descartamos marcas conhecidas, produtos proibidos e os que exigem Anvisa, Anatel ou Inmetro, e acompanhamos quem sobe de posição ao longo dos dias.'),
    pergunta('Vocês informam quantas unidades um produto vende?', 'Não como fato. O Mercado Livre informa a posição no ranking, não a quantidade vendida. Quando mostramos vendas, é uma estimativa de terceiros e vem identificada como estimativa.'),
    pergunta('O preço do fornecedor já é o custo final?', 'Não. O valor que aparece é o preço de anúncio do fornecedor, em dólares. O custo final depende de quantidade, frete, impostos e da cotação formal, que a equipe faz com o fornecedor.'),
    pergunta('Vocês informam a NCM e os impostos?', 'Indicamos uma NCM sugerida como ponto de partida. A classificação fiscal e as alíquotas são confirmadas pelo despachante.'),
    pergunta('Como peço uma cotação?', 'Informe seu nome, o produto (ou o código MLB que aparece na plataforma) e a quantidade pretendida. A equipe retorna com a cotação.'),
    pergunta('Vocês fazem a importação?', 'O atendimento encaminha o seu pedido à equipe da Conecta, que explica as opções de sourcing e importação para o seu caso.'),
  ];
  const sugestoes = (e.sugestoes || []).slice(0, 10);
  if (sugestoes.length) {
    blocos.push('## Produtos em destaque hoje');
    blocos.push(pergunta('Quais produtos estão em destaque hoje?',
      `${sugestoes.map((s) => umaLinha(s.nome)).join('; ')}. São produtos sem marca conhecida e bem colocados no ranking de suas categorias.`));
    for (const s of sugestoes) {
      const partes = [`Está na categoria ${umaLinha(s.categoria)}`, reais(s.menor_preco) ? `o menor preço no Mercado Livre é ${reais(s.menor_preco)}` : null,
        s.ncm ? `a NCM sugerida é ${s.ncm}` : null, `o código é ${s.id}`];
      blocos.push(pergunta(`Fale sobre o produto ${umaLinha(s.nome)}`, `${partes.filter(Boolean).join(', ')}. Para cotar a importação, informe a quantidade pretendida.`));
    }
  }
  const subindo = (e.emAlta || []).slice(0, 8);
  if (subindo.length) {
    blocos.push('## Produtos subindo no ranking');
    blocos.push(pergunta('Quais produtos estão subindo no ranking?',
      `${subindo.map((p) => `${umaLinha(p.nome)} (foi do ${p.posicao_anterior}º para o ${p.posicao}º lugar)`).join('; ')}. A subida é de posição no ranking do Mercado Livre, não de quantidade vendida.`));
  }
  const cotados = (e.cotados || []).slice(0, 15);
  if (cotados.length) {
    blocos.push('## Produtos que já têm fornecedor levantado');
    blocos.push(pergunta('Para quais produtos vocês já têm fornecedor?',
      `${cotados.map((c) => umaLinha(c.nome)).join('; ')}. Para esses já existe um fornecedor levantado; a cotação formal é feita pela equipe.`));
  }
  return `${blocos.join('\n\n')}\n`;
}

function gravarBase(entrada) {
  const texto = montarBase(entrada);
  fs.mkdirSync(pastaSuportify(), { recursive: true });
  const arquivo = path.join(pastaSuportify(), 'base-de-conhecimento.md');
  fs.writeFileSync(arquivo, texto, 'utf8');
  return { arquivo, texto, gerado_em: new Date().toISOString(), agente: AGENTE };
}

module.exports = { AGENTE, gravarBase, montarBase };
