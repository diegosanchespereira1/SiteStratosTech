-- Nomes de colunas iguais ao CSV/Excel (Supabase Table Editor → Import CSV exige match exato).
-- Identificadores com acentos e espaços: aspas duplas em SQL.

drop function if exists public.search_wladvan_products(text, integer);

alter table public.wladvan_catalog_products rename column sku to "CÓD INTERNO";
alter table public.wladvan_catalog_products rename column manufacturer_code to "CÓD FABRICANTE";
alter table public.wladvan_catalog_products rename column name to "PRODUTO";
alter table public.wladvan_catalog_products rename column product_status to "STATUS";
alter table public.wladvan_catalog_products rename column stock_total to "ESTOQUE TOTAL";

comment on column public.wladvan_catalog_products."CÓD INTERNO" is 'Col. A do relatório; chave única para upsert.';
comment on column public.wladvan_catalog_products."CÓD FABRICANTE" is 'Col. B do relatório.';
comment on column public.wladvan_catalog_products."PRODUTO" is 'Col. C do relatório.';
comment on column public.wladvan_catalog_products."STATUS" is 'Col. D do relatório (ex.: ATIVO).';
comment on column public.wladvan_catalog_products."ESTOQUE TOTAL" is 'Col. E do relatório.';

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
    p."CÓD INTERNO" as sku,
    p."CÓD FABRICANTE" as manufacturer_code,
    p."PRODUTO" as name,
    p.description,
    p.price_brl,
    p.brand,
    p.vehicle_models,
    p.category,
    p."STATUS" as product_status,
    p."ESTOQUE TOTAL" as stock_total
  from public.wladvan_catalog_products p
  where p.active = true
    and trim(coalesce(search_query, '')) <> ''
    and (
      p."PRODUTO" ilike '%' || search_query || '%'
      or coalesce(p."CÓD INTERNO", '') ilike '%' || search_query || '%'
      or coalesce(p."CÓD FABRICANTE", '') ilike '%' || search_query || '%'
      or coalesce(p.brand, '') ilike '%' || search_query || '%'
      or coalesce(p.description, '') ilike '%' || search_query || '%'
      or coalesce(p.vehicle_models, '') ilike '%' || search_query || '%'
      or coalesce(p."STATUS", '') ilike '%' || search_query || '%'
    )
  order by p."PRODUTO" asc
  limit greatest(1, least(coalesce(max_rows, 15), 50));
$$;

comment on function public.search_wladvan_products(text, int) is 'RPC devolve aliases em inglês (sku, name, …); tabela usa nomes do CSV.';

revoke all on function public.search_wladvan_products(text, int) from public;
grant execute on function public.search_wladvan_products(text, int) to service_role;
