# Conecta Hub Sourcing

Servidor MCP local que minera produtos do Mercado Livre Brasil por categoria e entrega o resultado ao Accio Work, para apoiar decisões de sourcing e importação da Conecta Hub.

Roda como extensão do Claude Desktop (formato MCPB) e não tem dependências além do Node.js 18 ou mais novo.

## Ferramentas

| Ferramenta | O que faz |
| --- | --- |
| `listar_categorias` | Categorias principais do site e seus códigos. |
| `detalhar_categoria` | Nome, foto, link, caminho e subcategorias de uma categoria. |
| `tendencias` | Termos de busca em alta na semana, no Brasil ou em uma categoria. |
| `mais_vendidos` | Ranking dos 20 mais vendidos de uma categoria, com foto e menor preço. |
| `detalhar_produto` | Dados de um produto do catálogo, com fotos e atributos. |
| `anuncios_do_produto` | Anúncios de um produto, com preço e vendedor. |
| `minerar_categoria` | Mineração por categoria (ver abaixo). |
| `listar_mineracoes` | Minerações já gravadas neste computador. |
| `painel_indicadores` | Indicadores, variação no ranking e sugestões de produto de uma mineração. |
| `enviar_para_accio` | Envia os produtos de uma mineração para o Accio Work. |
| `consulta_api` | Diagnóstico: resposta crua de um recurso de catálogo. |

## Mineração por categoria

`minerar_categoria` parte de uma categoria e:

1. desce pelas subcategorias (parâmetro `profundidade`, de 0 a 2), ficando com as que têm mais anúncios;
2. lê o ranking de mais vendidos e os termos em alta de cada uma;
3. junta as aparições de cada produto e o coloca na categoria mais específica em que ele aparece;
4. busca nome, marca, fotos, atributos e anúncios (menor preço, vendedores, lojas oficiais, Full) dos mais bem colocados;
5. marca os sinais de triagem: tipo de marca (sem marca, marca de vendedor ou marca conhecida), termo em alta relacionado e alerta regulatório (Anatel, Anvisa, Inmetro, proibido);
6. calcula uma prioridade de 0 a 100 e grava o resultado.

As categorias saem com o nome e o caminho que o site usa (por exemplo `Celulares e Telefones > Acessórios para Celulares`) e com foto. Quando a subcategoria não tem imagem própria, a capa é a foto do produto mais bem colocado dela.

Cada mineração é gravada em `~/ConectaHubSourcing/mineracoes/<id>/`:

- `painel.html`: painel de indicadores (ver abaixo);
- `catalogo.html`: catálogo com fotos, agrupado por categoria, para abrir no navegador;
- `mineracao.json`: o resultado completo.

### O que a prioridade é

A API do Mercado Livre informa a posição no ranking, nunca a quantidade vendida. A prioridade é uma regra de ordenação para a triagem, não uma estimativa de demanda. Os componentes vão junto com cada produto:

| Componente | Pontos |
| --- | --- |
| Posição no ranking | até 40 |
| Presença em mais de uma categoria | até 15 |
| Bate com um termo em alta | 15 |
| Sem marca | 15 |
| Marca de vendedor | 10 |
| Poucos anúncios concorrentes | 5 ou 10 |
| Alerta regulatório | −15 cada |
| Produto proibido | zera |

### Marcas

Quase todo produto do catálogo tem o campo marca preenchido, e na maioria das vezes é a marca própria de um vendedor. A triagem separa três casos:

- **sem marca**: campo vazio ou "Genérica";
- **marca de vendedor**: qualquer marca fora da lista de `server/marcas.js`. Segue para cotação, com o aviso de cotar o equivalente sem marca;
- **marca conhecida**: fabricantes e marcas de grande circulação (Samsung, Tramontina, Lorenzetti, Omo). Fica fora da cotação.

A lista não é completa nem substitui uma consulta ao INPI. Uma marca registrada que não esteja nela passa como marca de vendedor; ao encontrar uma, acrescente em `server/marcas.js`.

### Alertas regulatórios

Vêm de palavras-chave no nome do produto. As regras de Anvisa e Inmetro olham só as seis primeiras palavras, onde fica o tipo do produto, para não disparar com usos citados no fim do título ("para airfryer"). Capas, suportes e outros acessórios não herdam a exigência do produto principal. Servem para chamar atenção; a exigência real depende do NCM.

## Painel de indicadores

O `painel.html` de cada mineração mostra:

- os totais: produtos minerados, aptos para cotação, sem marca registrada, quantos batem com termo em alta e a faixa de menor preço;
- quatro gráficos de contagem: triagem para cotação, produtos por categoria, faixas de menor preço e concorrência (anúncios por produto);
- as sugestões de produto, com os motivos e as ressalvas de cada uma;
- a variação no ranking em relação à mineração anterior da mesma categoria: quem subiu, desceu, entrou e saiu;
- a tabela com todos os produtos.

`painel_indicadores` devolve os mesmos números em JSON e regrava o painel.

### Dados de venda

A API não entrega quantidade vendida a esta aplicação. Com o token `client_credentials`, `/items` e `/sites/MLB/search` respondem 403, e os produtos de catálogo não trazem esse campo. O painel mostra qualquer campo de venda que a API devolver e, quando não vem nenhum, diz isso.

O sinal de demanda disponível é a posição no ranking e a sua variação. Por isso vale minerar a mesma categoria de novo a cada semana: a comparação é o que mostra tendência.

## Envio para o Accio Work

O Accio Work trabalha sobre pastas do computador. `enviar_para_accio` grava em `~/AccioWork/conecta-hub-mineracao/<id>/`:

- `briefing-sourcing.md`: o pedido de sourcing, com foto, atributos e preço de referência de cada produto;
- `produtos.json`: os mesmos produtos em formato estruturado;
- `catalogo.html`: o catálogo completo da mineração.

A ferramenta devolve o pedido pronto para colar no Accio Work, apontando para essa pasta.

Por padrão ficam de fora os produtos de marca conhecida e os que têm alerta regulatório; `incluir_marcas` e `incluir_regulados` afrouxam o filtro. Produto proibido nunca é enviado.

O Accio Work também aceita servidores MCP personalizados. Para os agentes dele chamarem estas ferramentas direto, registre o servidor pela linha de comando do Accio. O comando abaixo segue a documentação do `accio-mcp-cli` e ainda não foi testado neste projeto:

```bash
accio-mcp-cli server add --json '{"mcpServers":{"conecta-hub-sourcing":{"command":"node","args":["CAMINHO/server/index.js"],"env":{"MELI_CLIENT_SECRET":"SEU_CLIENT_SECRET"}}}}'
```

## Configuração

| Variável | Uso |
| --- | --- |
| `MELI_CLIENT_SECRET` | Obrigatória. Chave da aplicação no DevCenter do Mercado Livre. |
| `MELI_CLIENT_ID` | Opcional. Substitui o Client ID embutido. |
| `ACCIO_WORK_DIR` | Opcional. Pasta do Accio Work; o padrão é `~/AccioWork`. |
| `CONECTA_HUB_SAIDA` | Opcional. Pasta das minerações; o padrão é `~/ConectaHubSourcing/mineracoes`. |
| `MELI_API_BASE` | Só para testes; aceita apenas `localhost` e `127.0.0.1`. |

Na extensão do Claude Desktop, o Client Secret e a pasta do Accio Work são preenchidos em Settings > Extensions > Conecta Hub Sourcing > Configure.

## Desenvolvimento

```bash
npm test
```

Os testes sobem uma API simulada em `127.0.0.1` e não precisam de credencial.

A extensão instalada no Claude Desktop é uma cópia. Para ela usar o código deste repositório, é preciso reempacotar e reinstalar:

```bash
npx @anthropic-ai/mcpb pack
```
