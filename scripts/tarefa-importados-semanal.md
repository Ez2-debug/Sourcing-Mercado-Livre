Tarefa agendada: "Conecta: mais vendidos e importados (JoomPulse)"
Quando: toda segunda-feira às 09:30 (cron `30 9 * * 1`)
Custo: 8 consultas do JoomPulse por execução (o plano tem 40 por mês).

--- copie a partir daqui para o campo de instruções da tarefa ---

Tarefa automatica do Conecta Market Sourcing: atualizar pelo JoomPulse os mais vendidos de cada marketplace (Mercado Livre, Compra Internacional, Shopee, Shopee internacional e fornecedores da China/JoomPro). Isso atualiza as telas Mais vendidos, ML Internacional, Shopee, China (JoomPro) e Importados -> Brasil. Rode tudo sem pedir confirmacao ao usuario; nao envie e-mail nem mensagem. Responda em portugues. Carregue pela busca de ferramentas qualquer ferramenta que aparecer como adiada.

Pasta do projeto: C:\Users\dmaul\OneDrive\Documentos\conecta-hub-sourcing (rode os comandos a partir dela).

1. Cota: chame get_mcp_usage do JoomPulse (nao gasta cota). Se o balde total mensal tiver menos de 10 chamadas restantes, NAO consulte nada: termine dizendo "Mais vendidos nao atualizados: cota do JoomPulse baixa (X restantes)". Se a ferramenta disser que o uso esta indisponivel, siga em frente.

2. Rode `node scripts/claude.js mais-vendidos-consultas`. Ele devolve uma lista de 8 buscas, cada uma com `tipo`, `ferramenta` e `argumentos`.

3. Para cada busca, na ordem: chame a ferramenta do JoomPulse com o nome em `ferramenta` (meli_search_products, shopee_search_products ou joompro_search_products) e exatamente os `argumentos` dados, uma unica vez. A resposta e grande: o sistema a grava em um arquivo e informa o caminho. Grave com:
   `node scripts/claude.js mais-vendidos-gravar <tipo> "<caminho do arquivo>"`
   Se a resposta vier inline, grave o JSON exato (com "columns" e "data") em C:\Users\dmaul\ConectaHubSourcing\mais-vendidos\entrada\<tipo>-<n>.json e use esse caminho. Se uma busca falhar, anote o motivo e siga para a proxima; nunca repita uma busca.

4. Antes de gravar, no PowerShell, carregue as variaveis do Supabase do usuario para o envio ao site (nunca mostre os valores):
   $env:SUPABASE_URL=[Environment]::GetEnvironmentVariable('SUPABASE_URL','User'); $env:SUPABASE_KEY=[Environment]::GetEnvironmentVariable('SUPABASE_KEY','User')
   Se o Supabase falhar (projeto pausado), continue: os dados ficam no computador.

5. Resumo final curto (5 a 8 linhas): quantos produtos entraram em cada marketplace, as 3 categorias que mais vendem no Mercado Livre e na Shopee, e se o Supabase recebeu. Regras: vendas e faturamento sao ESTIMATIVAS do JoomPulse, nunca vendas reais (no Mercado Livre, media mensal da vida do produto); a lista e ordem de analise, nao previsao; produto de marca de terceiros ou regulado (Anvisa, Anatel, Inmetro) nunca e recomendado para importar; o par JoomPro x Mercado Livre e automatico e precisa ser conferido.
