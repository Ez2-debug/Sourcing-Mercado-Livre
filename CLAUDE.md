# Conecta Hub Sourcing

Extensão local do Claude Desktop (formato MCPB) que expõe a API oficial do Mercado Livre Brasil como servidor MCP, para apoiar decisões de sourcing e importação da Conecta Hub.

## Origem

Cópia do código da extensão instalada em
`%APPDATA%\Claude\Claude Extensions\local.mcpb.conecta-hub.conecta-hub-sourcing` (versão 0.2.2, copiada em 05/10/2026).
A extensão instalada continua sendo a que o Claude Desktop executa; alterações feitas aqui só valem depois de reempacotar e reinstalar.

## Estrutura

- `manifest.json` — manifesto MCPB (nome, versão, lista de ferramentas, campo `client_secret` da tela de configuração).
- `server/index.js` — servidor MCP em stdio, sem dependências externas (Node >= 18). Implementa o JSON-RPC à mão.

## Como funciona

- Autenticação: fluxo `client_credentials` em `/oauth/token`. O Client ID vai embutido no código (não é segredo); o Client Secret chega pela variável `MELI_CLIENT_SECRET`. O token é renovado 5 minutos antes de vencer.
- `MELI_API_BASE` só aceita `localhost`/`127.0.0.1`, para testes com API simulada.
- Site fixo: `MLB`.
- Ferramentas: `listar_categorias`, `detalhar_categoria`, `tendencias`, `mais_vendidos`, `detalhar_produto`, `anuncios_do_produto`, `consulta_api` (diagnóstico, com lista de prefixos permitidos).

## Regras a manter

- A API devolve posição no ranking, não quantidade. Nunca estimar unidades vendidas, faturamento ou conversão.
- Os termos do Mercado Livre exigem autorização para publicar estatísticas derivadas.
- Nada em stdout além das mensagens do protocolo; logs vão em stderr.
- O Client Secret nunca entra no repositório nem em logs.
- A versão aparece em dois lugares e precisa andar junto: `manifest.json` e `SERVER_VERSION` em `server/index.js`.

## Teste rápido (sem credencial)

```bash
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}' '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | node server/index.js
```
