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
| `registrar_vendas_estimadas` | Grava nos produtos minerados as estimativas de venda de uma fonte externa, como o JoomPulse. |
| `sugerir_ncm` | Sugere a posição e códigos da NCM para um produto, pela tabela oficial do Siscomex. |
| `salvar_no_supabase` | Grava uma mineração no banco do projeto Supabase configurado. |
| `exportar_excel` | Gera uma planilha Excel com fotos e links dos produtos minerados. |
| `definir_fila` | Define a fila de categorias da mineração automática. |
| `ver_fila` | Mostra a fila e a última mineração de cada categoria. |
| `minerar_proxima` | Minera a categoria da fila que está há mais tempo parada. |
| `resumo_do_dia` | Resumo das minerações de um dia, com os produtos aptos em destaque. |
| `planilha_do_sourcing` | Planilha com os candidatos que o Accio Work encontrou no Alibaba para cada produto. |
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

## Sugestão de NCM

Cada produto minerado recebe uma sugestão de NCM, e `sugerir_ncm` faz o mesmo para uma descrição avulsa.

- A **posição** (4 dígitos) vem de um dicionário de tipos de produto em `server/ncm-posicoes.js`. A descrição legal da NCM raramente usa a palavra do anúncio (mangueira de jardim está em "tubos e seus acessórios, de plástico"), então a busca por texto sozinha não acha a posição.
- Os **códigos de 8 dígitos** e as descrições vêm da tabela oficial de nomenclatura do Portal Único Siscomex, baixada uma vez e guardada em `~/ConectaHubSourcing/ncm-siscomex.json` por 30 dias.
- Um código de 8 dígitos só é sugerido quando as primeiras palavras da descrição dele estão no anúncio. Sem isso, a sugestão fica só na posição.
- Tipos de produto fora do dicionário ficam sem sugestão.

A sugestão é ponto de partida, não classificação fiscal: o material e a função mudam a posição, e quem classifica é o despachante. A tabela oficial não traz alíquotas, então o sistema não calcula impostos.

## Estimativas de venda de terceiros (JoomPulse)

A API do Mercado Livre não informa vendas, mas ferramentas de inteligência de mercado publicam estimativas próprias. O [JoomPulse](https://joompulse.com) oferece um conector MCP (`https://joompulse.com/mcp`) com vendas e faturamento semanais estimados; o acesso exige conta no JoomPulse.

O fluxo é:

1. conectar o JoomPulse ao Claude (o `.mcp.json` deste repositório já declara o servidor para sessões do Claude Code abertas na pasta; no Claude Desktop, adicione como conector personalizado);
2. minerar a categoria;
3. pedir ao Claude para consultar no JoomPulse os produtos sugeridos e gravar o resultado com `registrar_vendas_estimadas`.

As estimativas e a tendência informada pela fonte ficam em cada produto, com a fonte e o período, e aparecem no painel, nas sugestões e no briefing do Accio Work, sempre rotuladas como estimativa de terceiros. O sistema não calcula nem ajusta esses números, e a prioridade de triagem não os usa.

O repositório [joomcode/joompulse-skills](https://github.com/joomcode/joompulse-skills) (MIT) traz skills prontas para o mesmo conector, como produtos sem marca por categoria e nichos sem concorrência.

## Mineração automática

A automação é uma fila de categorias mais uma tarefa agendada no Claude Desktop.

- `definir_fila` grava a lista de categorias em `~/ConectaHubSourcing/fila.json`. Cada categoria pode levar uma `origem`, por exemplo o CNAE de onde veio.
- `minerar_proxima` minera a categoria que está há mais tempo sem ser minerada, grava no Supabase, atualiza a planilha Excel do dia e, se a fila pedir, grava o pacote do Accio Work. Chamada a cada execução, percorre a fila inteira em rodízio.
- `resumo_do_dia` consolida as minerações do dia, para o relatório.

A tarefa agendada só precisa dizer "chame `minerar_proxima`". Tarefas agendadas rodam enquanto o Claude Desktop está aberto neste computador; com ele fechado, a execução fica para a próxima abertura.

O ranking e os termos em alta do Mercado Livre mudam devagar (os termos são semanais). Minerar a mesma categoria muitas vezes por dia repete quase os mesmos produtos; o rodízio serve para cobrir mais categorias, não para repetir a mesma.

## Planilha Excel

`exportar_excel` gera um `.xlsx` em `~/ConectaHubSourcing/planilhas/` com uma linha por produto: foto na célula, nome com link, categoria, posição, menor preço, marca, situação na triagem (com cor), alertas, NCM sugerida, prioridade, desde quando está no catálogo e os links do produto, do anúncio mais barato e da foto. Uma segunda aba explica as colunas.

Exporta uma mineração, ou todas as de um dia com `data` (`AAAA-MM-DD` ou `hoje`). Quando a mesma categoria foi minerada mais de uma vez no dia, entra a mais recente. Produtos sem detalhe da API ficam de fora.

O arquivo é montado por `server/xlsx.js`, sem bibliotecas externas. As fotos vêm só do CDN de imagens do Mercado Livre (`mlstatic.com`).

## Banco de dados no Supabase

As minerações podem ser gravadas em um projeto [Supabase](https://supabase.com), para alimentar painéis e outros sistemas.

1. Crie o projeto no Supabase e rode [`supabase/schema.sql`](supabase/schema.sql) no SQL Editor. Ele cria três tabelas: `chs_mineracoes`, `chs_categorias` e `chs_produtos`.
2. Em Settings > Extensions > Conecta Hub Sourcing > Configure, preencha o endereço do projeto e a chave secreta (service role).

Com isso, `minerar_categoria` e `registrar_vendas_estimadas` gravam sozinhas, e `salvar_no_supabase` envia uma mineração já feita. Gravar de novo atualiza as mesmas linhas.

Cada produto vai com as colunas de triagem (situação, tipo de marca, alertas, prioridade), a NCM sugerida, as estimativas de terceiros e o registro completo em `dados`.

A chave secreta só é enviada a endereços `https://<projeto>.supabase.co`. As tabelas ficam com a segurança por linha ligada e sem políticas: só a chave secreta lê e grava. Para um painel ler os dados com a chave pública, crie políticas de SELECT.

## Envio para o Accio Work

O Accio Work trabalha sobre pastas do computador. `enviar_para_accio` grava em `~/AccioWork/conecta-hub-mineracao/<id>/`:

- `briefing-sourcing.md`: o pedido de sourcing, com foto, atributos e preço de referência de cada produto;
- `produtos.json`: os mesmos produtos em formato estruturado;
- `catalogo.html`: o catálogo completo da mineração.

A ferramenta devolve o pedido pronto para colar no Accio Work, apontando para essa pasta.

Por padrão ficam de fora os produtos de marca conhecida e os que têm alerta regulatório; `incluir_marcas` e `incluir_regulados` afrouxam o filtro. Produto proibido nunca é enviado.

### Planilha do resultado

Depois que o Accio termina a busca, ele grava um `sourcing.md` com a tabela de candidatos. `planilha_do_sourcing` lê esse arquivo e gera `~/ConectaHubSourcing/planilhas/sourcing-<id>.xlsx`, com cada produto minerado ao lado do candidato do Alibaba: as duas fotos, fornecedor, preço e MOQ do anúncio, local, aderência e links.

O briefing pede ao Accio que cite o código do produto (`MLB...`) em cada candidato. Quando ele cita, o cruzamento é exato; quando não, é feito pelas palavras em comum e sai marcado como "Por semelhança; conferir".

Preço de anúncio não é cotação FOB. Iniciar a tarefa dentro do Accio continua sendo manual.

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
| `SUPABASE_URL` | Opcional. Endereço do projeto Supabase. |
| `SUPABASE_KEY` | Opcional. Chave secreta (service role) do projeto. |
| `NCM_TABELA` | Só para testes; arquivo local com a tabela de NCM. |
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
