-- Colunas alinhadas ao Excel Relatorio_produtos.xlsx:
-- A CÓD INTERNO, B CÓD FABRICANTE, C PRODUTO, D STATUS, E ESTOQUE TOTAL
-- O relatório não traz preço; price_brl passa a ser opcional até carga de tabela de preços.

alter table public.wladvan_catalog_products
  alter column price_brl drop not null;

alter table public.wladvan_catalog_products
  add column if not exists manufacturer_code text;

alter table public.wladvan_catalog_products
  add column if not exists product_status text;

alter table public.wladvan_catalog_products
  add column if not exists stock_total numeric(14, 3);

comment on column public.wladvan_catalog_products.manufacturer_code is 'CÓD FABRICANTE (Excel col. B).';
comment on column public.wladvan_catalog_products.product_status is 'STATUS do relatório (ex.: ATIVO).';
comment on column public.wladvan_catalog_products.stock_total is 'ESTOQUE TOTAL (Excel col. E).';

create index if not exists idx_wladvan_catalog_products_manufacturer_code_trgm
  on public.wladvan_catalog_products using gin (manufacturer_code gin_trgm_ops);

-- sku continua a representar CÓD INTERNO (Excel col. A) para upsert.

drop function if exists public.search_wladvan_products(text, integer);

create or replace function public.search_wladvan_products(
  search_query text,
  max_rows int default 15
)
returns table (
  id uuid,
  sku text,
  manufacturer_code text,
  name text,
  description text,
  price_brl numeric,
  brand text,
  vehicle_models text,
  category text,
  product_status text,
  stock_total numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id,
    p.sku,
    p.manufacturer_code,
    p.name,
    p.description,
    p.price_brl,
    p.brand,
    p.vehicle_models,
    p.category,
    p.product_status,
    p.stock_total
  from public.wladvan_catalog_products p
  where p.active = true
    and trim(coalesce(search_query, '')) <> ''
    and (
      p.name ilike '%' || search_query || '%'
      or coalesce(p.sku, '') ilike '%' || search_query || '%'
      or coalesce(p.manufacturer_code, '') ilike '%' || search_query || '%'
      or coalesce(p.brand, '') ilike '%' || search_query || '%'
      or coalesce(p.description, '') ilike '%' || search_query || '%'
      or coalesce(p.vehicle_models, '') ilike '%' || search_query || '%'
      or coalesce(p.product_status, '') ilike '%' || search_query || '%'
    )
  order by p.name asc
  limit greatest(1, least(coalesce(max_rows, 15), 50));
$$;

comment on function public.search_wladvan_products(text, int) is 'Chamada via PostgREST POST /rest/v1/rpc/search_wladvan_products — use service_role no n8n.';

revoke all on function public.search_wladvan_products(text, int) from public;
grant execute on function public.search_wladvan_products(text, int) to service_role;
