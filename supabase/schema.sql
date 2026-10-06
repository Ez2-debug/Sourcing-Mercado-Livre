-- Conecta Hub Sourcing: tabelas das mineracoes no Supabase.
--
-- Rode este arquivo uma vez no SQL Editor do projeto (ou como migracao).
-- Pode ser rodado de novo sem perder dados.
--
-- A seguranca por linha fica ligada e sem politicas: so a chave secreta
-- (service role), usada pela extensao, le e grava. Para abrir a leitura a um
-- painel ou a outro sistema, crie politicas de SELECT para o papel desejado.

create table if not exists public.chs_mineracoes (
  id             text primary key,
  categoria_id   text not null,
  categoria      text not null,
  consultado_em  timestamptz not null,
  parametros     jsonb,
  resumo         jsonb,
  ncm            jsonb,
  indicadores    jsonb,
  atualizado_em  timestamptz not null default now()
);

create table if not exists public.chs_categorias (
  mineracao_id   text not null references public.chs_mineracoes (id) on delete cascade,
  categoria_id   text not null,
  nome           text,
  caminho        text,
  nivel          integer,
  foto           text,
  link           text,
  total_anuncios bigint,
  termos_em_alta jsonb,
  primary key (mineracao_id, categoria_id)
);

create table if not exists public.chs_produtos (
  mineracao_id           text not null references public.chs_mineracoes (id) on delete cascade,
  produto_id             text not null,
  categoria_id           text,
  categoria              text,
  nome                   text,
  marca                  text,
  tipo_de_marca          text,
  foto                   text,
  link                   text,
  melhor_posicao         integer,
  menor_preco            numeric,
  quantidade_anuncios    integer,
  vendedores             integer,
  prioridade             integer,
  situacao               text,
  alertas                jsonb,
  termos_em_alta         jsonb,
  ncm_posicao            text,
  ncm_codigos            jsonb,
  -- Estimativas de terceiros (por exemplo JoomPulse); nao sao dado do Mercado Livre.
  estimativa_fonte       text,
  estimativa_periodo     text,
  estimativa_vendas      numeric,
  estimativa_faturamento numeric,
  dados                  jsonb,
  primary key (mineracao_id, produto_id)
);

create index if not exists chs_mineracoes_categoria_idx on public.chs_mineracoes (categoria_id, consultado_em desc);
create index if not exists chs_produtos_produto_idx on public.chs_produtos (produto_id);
create index if not exists chs_produtos_situacao_idx on public.chs_produtos (mineracao_id, situacao);

alter table public.chs_mineracoes enable row level security;
alter table public.chs_categorias enable row level security;
alter table public.chs_produtos   enable row level security;
