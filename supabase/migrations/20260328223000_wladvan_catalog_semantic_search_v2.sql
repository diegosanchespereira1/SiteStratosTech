-- v2: busca semântica com exclusão rígida e deduplicação por SKU

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
prepared as (
  select
    query_norm,
    trim(regexp_replace(query_norm, '[^a-z0-9]+', ' ', 'g')) as query_words,
    lim
  from q
  where query_norm <> ''
),
q_tokens as (
  select
    p.query_norm,
    p.query_words,
    array_remove(regexp_split_to_array(p.query_words, E'\s+'), '') as tokens,
    (array_remove(regexp_split_to_array(p.query_words, E'\s+'), ''))[1] as core_token,
    p.lim
  from prepared p
),
modifiers as (
  -- termos frequentemente "peça relacionada" e não a peça principal
  select array[
    'bronzina','bucha','bieleta','coxim','guarda po','kit','reparo','arruela','parafuso','retentor'
  ]::text[] as terms
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
    trim(regexp_replace(lower(unaccent(coalesce(p."PRODUTO", ''))), '[^a-z0-9]+', ' ', 'g')) as name_words,
    lower(unaccent(coalesce(p.description, ''))) as desc_norm,
    lower(unaccent(coalesce(p.vehicle_models, ''))) as vehicle_norm,
    qt.query_norm,
    qt.query_words,
    qt.tokens,
    qt.core_token,
    qt.lim,
    m.terms as modifier_terms
  from public.wladvan_catalog_products p
  cross join q_tokens qt
  cross join modifiers m
  where p.active = true
),
scored as (
  select
    c.*,
    -- exclusão rígida por termo explícito
    exists (
      select 1
      from unnest(coalesce(exclude_terms, '{}'::text[])) et
      where et is not null
        and btrim(et) <> ''
        and (
          c.name_norm like '%' || lower(unaccent(et)) || '%'
          or similarity(c.name_norm, lower(unaccent(et))) >= 0.45
          or c.name_words like '%' || left(lower(unaccent(et)), 5) || '%'
        )
    ) as has_excluded_term,

    -- penalidade por modificadores quando não fazem parte da busca do usuário
    (
      select coalesce(sum(
        case
          when c.name_norm like '%' || mt || '%'
               and c.query_words not like '%' || mt || '%'
          then 1.0 else 0.0
        end
      ), 0)
      from unnest(c.modifier_terms) mt
    ) as modifier_penalty,

    -- score lexical/semântico
    (
      (case when c.name_norm like '%' || c.query_norm || '%' then 1.0 else 0.0 end) * 4.0
      + similarity(c.name_norm, c.query_norm) * 3.2
      + greatest(word_similarity(c.name_norm, c.query_norm), word_similarity(c.query_norm, c.name_norm)) * 2.0
      + (
          select coalesce(sum(case when c.name_words like '%' || tk || '%' then 1 else 0 end), 0)
          from unnest(c.tokens) tk
        ) * 0.8
      + (case when c.desc_norm like '%' || c.query_norm || '%' then 1.0 else 0.0 end) * 0.4
      + (case when c.vehicle_norm like '%' || c.query_norm || '%' then 1.0 else 0.0 end) * 0.3
      + (case when c.core_token is not null and c.name_words like '%' || c.core_token || '%' then 1.0 else 0.0 end) * 1.3
    )::numeric as raw_score
  from candidates c
),
filtered as (
  select
    s.*,
    (s.raw_score - (s.modifier_penalty * 1.4))::numeric as final_score
  from scored s
  where not s.has_excluded_term
    and (
      s.name_norm like '%' || s.query_norm || '%'
      or similarity(s.name_norm, s.query_norm) >= 0.20
      or exists (
        select 1 from unnest(s.tokens) tk where s.name_words like '%' || tk || '%'
      )
    )
),
dedup as (
  select distinct on (coalesce(nullif(trim(sku), ''), name))
    id,
    sku,
    manufacturer_code,
    name,
    description,
    price_brl,
    brand,
    vehicle_models,
    category,
    product_status,
    stock_total,
    final_score as score,
    lim
  from filtered
  order by coalesce(nullif(trim(sku), ''), name), final_score desc, name asc
)
select
  d.id,
  d.sku,
  d.manufacturer_code,
  d.name,
  d.description,
  d.price_brl,
  d.brand,
  d.vehicle_models,
  d.category,
  d.product_status,
  d.stock_total,
  d.score
from dedup d
order by d.score desc, d.name asc
limit (select lim from q_tokens limit 1);
$$;

comment on function public.search_wladvan_products_semantic(text, text[], int)
  is 'v2: busca semântica com exclusão rígida (exclude_terms), penalidade de peça relacionada e dedupe por SKU.';

revoke all on function public.search_wladvan_products_semantic(text, text[], int) from public;
grant execute on function public.search_wladvan_products_semantic(text, text[], int) to service_role;
