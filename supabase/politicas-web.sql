-- Conecta Hub Sourcing: leitura das mineracoes pelo aplicativo web.
--
-- Rode este arquivo uma vez no SQL Editor do projeto, depois de schema.sql.
-- Pode ser rodado de novo.
--
-- Libera SOMENTE leitura, e so para quem entrou com login (papel
-- "authenticated"). Visitante sem login (papel "anon") continua sem ver nada,
-- e a gravacao continua exclusiva da chave secreta usada pelo minerador.
--
-- Atencao: com estas politicas, qualquer usuario cadastrado no projeto le
-- todas as mineracoes. Mantenha o cadastro publico desligado em
-- Authentication > Sign In / Providers e crie os usuarios pelo painel.

drop policy if exists "chs_mineracoes leitura logada" on public.chs_mineracoes;
create policy "chs_mineracoes leitura logada" on public.chs_mineracoes
  for select to authenticated using (true);

drop policy if exists "chs_categorias leitura logada" on public.chs_categorias;
create policy "chs_categorias leitura logada" on public.chs_categorias
  for select to authenticated using (true);

drop policy if exists "chs_produtos leitura logada" on public.chs_produtos;
create policy "chs_produtos leitura logada" on public.chs_produtos
  for select to authenticated using (true);
