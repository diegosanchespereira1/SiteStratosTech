-- Busca semântica/lexical para catálogo Wladvan
-- Objetivo: reduzir falsos positivos entre peça principal e peça relacionada
-- Ex.: pedido "biela" não deve priorizar "bronzina da biela".

create extension if not exists pg_trgm;
create extension if not exists unaccent;

drop function if exists public.search_wladvan_products_semantic(text, text[], integer);

create or replace function public.search_wladvan_products_semantic(
  search_query text,
  exclude_terms text[] default '{}'::text[],
  max_rows int default 20
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
  stock_total numeric,
  score numeric
)
language sql
stable
security definer
set search_path = public
as $$
with q as (
  select
    lower(trim(unaccent(coalesce(search_query, '')))) as query_norm,
    greatest(1, least(coalesce(max_rows, 20), 50)) as lim
),
terms as (
  select
    q.query_norm,
    array_remove(regexp_split_to_array(q.query_norm, E'\s+'), '') as tokens,
    q.lim
  from q
  where q.query_norm <> ''
),
candidates as (
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
    p."ESTOQUE TOTAL" as stock_total,
    lower(unaccent(coalesce(p."PRODUTO", ''))) as name_norm,
    lower(unaccent(coalesce(p.description, ''))) as desc_norm,
    lower(unaccent(coalesce(p.vehicle_models, ''))) as vehicle_norm,
    t.query_norm,
    t.tokens,
    t.lim
  from public.wladvan_catalog_products p
  cross join terms t
  where p.active = true
),
scored as (
  select
    c.*,
    (
      -- maior peso para correspondência textual no nome do produto
      (case when c.name_norm like '%' || c.query_norm || '%' then 1.0 else 0.0 end) * 4.0
      + similarity(c.name_norm, c.query_norm) * 3.0
      + greatest(word_similarity(c.name_norm, c.query_norm), word_similarity(c.query_norm, c.name_norm)) * 2.0
      -- reforço quando tokens da busca aparecem no nome
      + (
          select coalesce(sum(case when c.name_norm like '%' || tk || '%' then 1 else 0 end), 0)
          from unnest(c.tokens) tk
        ) * 0.9
      -- sinais secundários (descrição/modelo)
      + (case when c.desc_norm like '%' || c.query_norm || '%' then 1.0 else 0.0 end) * 0.5
      + (case when c.vehicle_norm like '%' || c.query_norm || '%' then 1.0 else 0.0 end) * 0.4
      -- penalidade para termos que devem ser excluídos
      - (
          select coalesce(sum(
            case when c.name_norm like '%' || lower(unaccent(et)) || '%' then 2.0 else 0.0 end
          ), 0)
          from unnest(coalesce(exclude_terms, '{}'::text[])) et
        )
    )::numeric as score
  from candidates c
)
select
  s.id,
  s.sku,
  s.manufacturer_code,
  s.name,
  s.description,
  s.price_brl,
  s.brand,
  s.vehicle_models,
  s.category,
  s.product_status,
  s.stock_total,
  s.score
from scored s
where
  -- filtro mínimo para evitar ruído total
  s.name_norm like '%' || s.query_norm || '%'
  or similarity(s.name_norm, s.query_norm) >= 0.20
  or exists (
    select 1 from unnest(s.tokens) tk where s.name_norm like '%' || tk || '%'
  )
order by s.score desc, s.name asc
limit (select lim from terms limit 1);
$$;

comment on function public.search_wladvan_products_semantic(text, text[], int)
  is 'Busca semântica/lexical de peças com score e exclusões (ex.: bronzina para busca de biela).';

revoke all on function public.search_wladvan_products_semantic(text, text[], int) from public;
grant execute on function public.search_wladvan_products_semantic(text, text[], int) to service_role;
