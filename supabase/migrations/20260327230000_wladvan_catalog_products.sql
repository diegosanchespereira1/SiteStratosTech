-- Catálogo de preços Wladvan para o agente Chatwoot (n8n consulta via RPC).
-- Após aplicar: no n8n use credencial Supabase com service_role (ou anon + políticas, se preferir).

create extension if not exists pg_trgm;

create table if not exists public.wladvan_catalog_products (
  id uuid primary key default gen_random_uuid(),
  sku text unique,
  name text not null,
  description text,
  price_brl numeric(14, 2) not null check (price_brl >= 0),
  brand text,
  vehicle_models text,
  category text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_wladvan_catalog_products_name_trgm
  on public.wladvan_catalog_products using gin (name gin_trgm_ops);

create index if not exists idx_wladvan_catalog_products_active_name
  on public.wladvan_catalog_products (active, name)
  where active = true;

create trigger trg_wladvan_catalog_products_updated_at
before update on public.wladvan_catalog_products
for each row execute procedure public.set_updated_at();

comment on table public.wladvan_catalog_products is 'Preços de peças Wladvan; consultado pelo agente via search_wladvan_products.';

-- Busca textual (nome, sku, marca, descrição, modelos). Limite máximo 50 linhas.
create or replace function public.search_wladvan_products(
  search_query text,
  max_rows int default 15
)
returns table (
  id uuid,
  sku text,
  name text,
  description text,
  price_brl numeric,
  brand text,
  vehicle_models text,
  category text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id,
    p.sku,
    p.name,
    p.description,
    p.price_brl,
    p.brand,
    p.vehicle_models,
    p.category
  from public.wladvan_catalog_products p
  where p.active = true
    and trim(coalesce(search_query, '')) <> ''
    and (
      p.name ilike '%' || search_query || '%'
      or coalesce(p.sku, '') ilike '%' || search_query || '%'
      or coalesce(p.brand, '') ilike '%' || search_query || '%'
      or coalesce(p.description, '') ilike '%' || search_query || '%'
      or coalesce(p.vehicle_models, '') ilike '%' || search_query || '%'
    )
  order by p.name asc
  limit greatest(1, least(coalesce(max_rows, 15), 50));
$$;

comment on function public.search_wladvan_products(text, int) is 'Chamada via PostgREST POST /rest/v1/rpc/search_wladvan_products — use service_role no n8n.';

revoke all on function public.search_wladvan_products(text, int) from public;
grant execute on function public.search_wladvan_products(text, int) to service_role;

alter table public.wladvan_catalog_products enable row level security;

-- Sem políticas para anon/authenticated: acesso negado via API pública.
-- JWT service_role (n8n) ignora RLS no Supabase e continua a conseguir ler/escrever.
