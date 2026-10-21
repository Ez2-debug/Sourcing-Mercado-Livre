Tarefa agendada: "Conecta: importados China/EUA → Brasil"
Quando: toda segunda-feira às 09:30 (cron `30 9 * * 1`)

--- copie a partir daqui para o campo de instruções da tarefa ---

Tarefa automatica do Conecta Market Sourcing: atualizar a tela "Importados -> Brasil" (o que o Brasil compra da China e dos EUA). Rode tudo sem pedir confirmacao ao usuario; nao envie e-mail nem mensagem. Responda em portugues.

Pasta do projeto: C:\Users\dmaul\OneDrive\Documentos\conecta-hub-sourcing (rode os comandos a partir dela).

1. Cota: chame get_mcp_usage do JoomPulse. Se algum balde (total, MercadoLivre ou Shopee) tiver menos de 8 chamadas restantes, NAO consulte nada: termine dizendo "Importados nao atualizados: cota do JoomPulse baixa (X restantes)". Se a ferramenta disser que o uso esta indisponivel, siga em frente.

2. Consultas (uma de cada, nunca repita):
   a. `node scripts/claude.js internacional-consulta ml` imprime a consulta; envie-a exatamente como veio para query_cubejs_meli.
   b. `node scripts/claude.js internacional-consulta ml-us` -> query_cubejs_meli.
   c. `node scripts/claude.js internacional-consulta shopee` -> query_cubejs_shopee.
   O resultado de cada consulta e grande; quando o sistema grava o resultado em um arquivo, use esse caminho. Se vier inline, grave o JSON exato (com "columns" e "data") em C:\Users\dmaul\ConectaHubSourcing\internacional\entrada-<tipo>.json.

3. No PowerShell, carregue as variaveis do Supabase do usuario (nunca mostre os valores):
   $env:SUPABASE_URL=[Environment]::GetEnvironmentVariable('SUPABASE_URL','User'); $env:SUPABASE_KEY=[Environment]::GetEnvironmentVariable('SUPABASE_KEY','User')
   e grave cada resposta, nesta ordem:
   `node scripts/claude.js internacional-gravar ml <arquivo da a>`
   `node scripts/claude.js internacional-gravar ml-us <arquivo da b>`
   `node scripts/claude.js internacional-gravar shopee <arquivo da c>`
   Se o Supabase falhar (projeto pausado), continue: os dados ficam no computador.

4. Resumo final curto (5 a 8 linhas): quantos anuncios da China, dos EUA e da Shopee; as 3 primeiras oportunidades da China e o que aparece nas duas lojas (rode `node -e "const p=require('./server/internacional').lerInternacional();console.log(JSON.stringify({c:p.china.oportunidades.slice(0,3).map(x=>x.titulo+' | '+x.sinal),d:p.nas_duas_lojas.slice(0,3).map(x=>x.titulo)}))"`); e se o Supabase recebeu. Regras: pedidos e vendas sao ESTIMATIVAS do JoomPulse, nunca vendas reais; a lista e ordem de analise, nao previsao; produto de marca de terceiros ou regulado (Anvisa, Anatel, Inmetro) nunca e recomendado para importar.
