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
- `server/indicadores.js` — triagem, distribuições, variação entre minerações e sugestões de produto.
- `server/painel.js` — painel HTML de indicadores (barras em CSS, uma série, um tom).
- `server/html.js` — escape de texto, URL e preço para as páginas geradas.
- `server/saida.js` — grava as minerações, gera o catálogo HTML e o pacote do Accio Work.
- `test/` — testes com `node:test` contra uma API simulada.

Sem dependências externas: só módulos do Node (>= 18).

## Regras a manter

- A API devolve posição no ranking, não quantidade. Nunca estimar unidades vendidas, faturamento ou conversão. A prioridade da mineração é regra de triagem e sai sempre com os componentes.
- Os termos do Mercado Livre exigem autorização para publicar estatísticas derivadas.
- Produto proibido nunca segue para o Accio Work nem entra nas sugestões, com qualquer filtro.
- Dados de venda: a API responde 403 em `/items` e `/sites/MLB/search` para esta aplicação. Não contornar com raspagem do site; mostrar só o que vier em `campos_de_venda`.
- Nada em stdout além das mensagens do protocolo; logs vão em stderr.
- O Client Secret nunca entra no repositório nem em logs.
- `MELI_API_BASE` só aceita endereço local, para o Client Secret não sair para terceiros.
- A versão aparece em três lugares e precisa andar junto: `manifest.json`, `package.json` e `SERVER_VERSION` em `server/index.js`.
- Comentários e mensagens das ferramentas em português sem acento, como no código original.

## Testes

```bash
npm test
```

Chamadas reais à API precisam do Client Secret, que fica só na configuração da extensão. Para conferir o formato de um recurso sem a chave, use a ferramenta `consulta_api` da extensão instalada.
