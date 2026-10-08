-- Conecta Hub Sourcing: o que o aplicativo web hospedado precisa.
--
-- Rode este arquivo uma vez no SQL Editor do projeto, depois de schema.sql.
-- Pode ser rodado de novo sem perder dados.
--
-- 1. Cria chs_retratos: uma linha por assunto ("shopee", "cotacoes"), com o
--    retrato mais recente em JSON, enviado pelo minerador.
-- 2. Libera SOMENTE leitura das tabelas, e so para quem entrou com login
--    (papel "authenticated"). Visitante sem login (papel "anon") continua sem
--    ver nada, e a gravacao continua exclusiva da chave secreta do minerador.
--
-- Atencao: qualquer usuario cadastrado no projeto le todos os dados. Mantenha
-- o cadastro publico desligado (Authentication > Sign In / Providers) e crie
-- os usuarios pelo painel.

create table if not exists public.chs_retratos (
  chave          text primary key,
  atualizado_em  timestamptz not null default now(),
  dados          jsonb not null
);

alter table public.chs_retratos enable row level security;

drop policy if exists "chs_mineracoes leitura logada" on public.chs_mineracoes;
create policy "chs_mineracoes leitura logada" on public.chs_mineracoes
  for select to authenticated using (true);

drop policy if exists "chs_categorias leitura logada" on public.chs_categorias;
create policy "chs_categorias leitura logada" on public.chs_categorias
  for select to authenticated using (true);

drop policy if exists "chs_produtos leitura logada" on public.chs_produtos;
create policy "chs_produtos leitura logada" on public.chs_produtos
  for select to authenticated using (true);

drop policy if exists "chs_retratos leitura logada" on public.chs_retratos;
create policy "chs_retratos leitura logada" on public.chs_retratos
  for select to authenticated using (true);
