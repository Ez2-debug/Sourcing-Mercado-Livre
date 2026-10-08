# Conecta Hub Sourcing

Extensão local do Claude Desktop (formato MCPB) que expõe a API oficial do Mercado Livre Brasil como servidor MCP, minera produtos por categoria e entrega o resultado ao Accio Work. Uso: sourcing e importação da Conecta Hub. O [README.md](README.md) descreve as ferramentas e o formato das saídas.

## Origem

O código partiu da extensão instalada em
`%APPDATA%\Claude\Claude Extensions\local.mcpb.conecta-hub.conecta-hub-sourcing` (versão 0.2.2, copiada em 05/10/2026).
A extensão instalada continua sendo a que o Claude Desktop executa; alterações feitas aqui só valem depois de reempacotar e reinstalar.

## Estrutura

- `manifest.json` — manifesto MCPB (versão, lista de ferramentas, campos da tela de configuração).
- `server/index.js` — protocolo MCP em stdio (JSON-RPC à mão) e definição das ferramentas.
- `server/meli.js` — credenciais, token `client_credentials` e `apiGet`, com nova tentativa em 401 e 429.
- `server/catalogo.js` — validação de ids, links públicos e leitura de produto, fotos e anúncios.
- `server/mineracao.js` — mineração por categoria, sinais de triagem e prioridade.
- `server/marcas.js` — lista de marcas conhecidas; só elas barram um produto na triagem.
- `server/ncm.js` e `server/ncm-posicoes.js` — sugestão de NCM: dicionário de tipo de produto para posição, e tabela oficial do Siscomex (com cache) para os códigos.
- `server/estimativas.js` — registro de estimativas de venda de terceiros (JoomPulse) nos produtos.
- `server/indicadores.js` — triagem, distribuições, variação entre minerações e sugestões de produto.
- `server/painel.js` — painel HTML de indicadores (barras em CSS, uma série, um tom).
- `server/html.js` — escape de texto, URL e preço para as páginas geradas.
- `server/saida.js` — grava as minerações, gera o catálogo HTML e o pacote do Accio Work.
- `server/sourcing.js` — lê o `sourcing.md` do Accio Work, cruza candidatos e produtos e gera a planilha do sourcing.
- `minerador.js` — minerador autonomo: roda sem o Claude, minera a fila a cada intervalo e serve a central em `http://127.0.0.1:4310`.
- `server/automacao.js` — passos da mineracao usados tanto pelo servidor MCP quanto pelo minerador autonomo.
- `server/emalta.js` — produtos aptos que subiram no ranking entre duas mineracoes da mesma categoria (7 ou 30 dias).
- `server/accio.js` — situacao dos pacotes do Accio Work para a central: liga cada `sourcing.md` ao pacote que ele responde.
- `server/cotacao.js` — cotacao em duas planilhas com os mesmos produtos na mesma ordem: uma com os dados do Mercado Livre, outra com os candidatos do Alibaba.
- `server/shopee.js` — produtos da Shopee Brasil a partir da resposta do JoomPulse (`query_cubejs_shopee`), gravados em disco.
- `server/pedidos.js` — fila de pedidos para o Claude (cotacao no Accio, atualizacao da Shopee, estimativas, texto livre).
- `scripts/claude.js` — atalhos de linha de comando para o Claude atender a fila, gravar a Shopee e gerar as planilhas da cotacao.
- `server/central.js` — pagina da central (dados escritos no DOM com `textContent`).
- `scripts/inicio-automatico.ps1` — liga ou desliga o inicio do minerador com o Windows.
- `accio-plugin/plugin.json` — plugin que registra o servidor MCP no Accio Work.
- `server/fila.js` — fila de categorias da mineração automática; `minerar_proxima` pega a que está há mais tempo parada.
- `server/planilha.js` e `server/xlsx.js` — exportação para Excel com fotos; `xlsx.js` monta o arquivo (ZIP e XML) sem bibliotecas.
- `server/supabase.js` e `supabase/schema.sql` — gravação das minerações no Supabase pela API REST, e as tabelas.
- `web/` — aplicativo web (React + Vite + Tailwind, componentes no estilo shadcn/ui em `web/src/ui.jsx`, tema em `web/src/estilos.css`). O minerador serve `web/dist` na raiz e a central antiga em `/central`. Telas: Painel, Em alta, Mercado Livre, Shopee, Cotações, Pedidos ao Claude e Integrações. Sem Supabase configurado, lê a central local (modo demonstração). `web/src/emalta.js` repete a regra de `server/emalta.js` sobre as linhas do banco.
- `supabase/hospedagem.sql` — tabela `chs_retratos` (Shopee e cotações para o site) e leitura das tabelas só para usuário logado.
- `.github/workflows/publicar-site.yml` — publica `web/` no GitHub Pages, com a chave pública do Supabase vinda das variáveis do repositório.
- `test/` — testes com `node:test` contra uma API simulada.

O servidor MCP e o minerador não têm dependências externas: só módulos do Node (>= 18). As dependências do `web/` ficam só nele.

## Regras a manter

- A API devolve posição no ranking, não quantidade. O sistema nunca estima unidades vendidas, faturamento ou conversão. Estimativas de terceiros só entram por `registrar_vendas_estimadas`, com a fonte, e saem sempre rotuladas como estimativa. A prioridade da mineração é regra de triagem e sai sempre com os componentes.
- Os termos do Mercado Livre exigem autorização para publicar estatísticas derivadas.
- Produto proibido nunca segue para o Accio Work nem entra nas sugestões, com qualquer filtro.
- Dados de venda: a API responde 403 em `/items` e `/sites/MLB/search` para esta aplicação. Não contornar com raspagem do site; mostrar só o que vier em `campos_de_venda`.
- NCM é sugestão para o despachante: sem alíquota, e código de 8 dígitos só quando as primeiras palavras da descrição oficial estão no anúncio.
- Nada em stdout além das mensagens do protocolo; logs vão em stderr.
- O Client Secret e a chave do Supabase nunca entram no repositório nem em logs. A chave do Supabase só é enviada a `https://<projeto>.supabase.co`.
- Não fazer engenharia reversa de serviços de terceiros (JoomPulse, Mercado Livre) para obter dados fora dos canais oficiais; usar o conector ou a API que o serviço oferece.
- A central do minerador só atende em `127.0.0.1`, confere o cabeçalho `Host` e exige o cabeçalho `X-Conecta-Hub` nos comandos.
- No `web/` só entra a chave pública do Supabase (anon/publishable). A chave secreta nunca vai para o navegador.
- Shopee: os dados vêm só do JoomPulse; vendas e faturamento são estimativas dele e saem sempre rotuladas assim. Sem raspagem do site da Shopee.
- `MELI_API_BASE` só aceita endereço local, para o Client Secret não sair para terceiros.
- A versão aparece em três lugares e precisa andar junto: `manifest.json`, `package.json` e `SERVER_VERSION` em `server/index.js`.
- Comentários e mensagens das ferramentas em português sem acento, como no código original.

## Testes

```bash
npm test
```

Chamadas reais à API precisam do Client Secret, que fica só na configuração da extensão. Para conferir o formato de um recurso sem a chave, use a ferramenta `consulta_api` da extensão instalada.
