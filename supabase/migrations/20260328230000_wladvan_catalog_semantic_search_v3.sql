-- v3: fix tokenização (string_to_array em vez de regexp_split com E'\s+' quebrado),
--      leading match boost (+5 quando produto começa com termo principal),
--      penalidade ampliada para modificadores (bronz, bucha, borr, etc.),
--      modifier prefix penalty (-3.5 quando nome começa com modificador).

create extension if not exists pg_trgm;
create extension if not exists unaccent;

drop function if exists public.search_wladvan_products_semantic(text, text[], integer);

create or replace function public.search_wladvan_products_semantic(
  search_query text,
  exclude_terms text[] default '{}'::text[],
  max_rows int default 20
)
returns table (
  id uuid, sku text, manufacturer_code text, name text, description text,
  price_brl numeric, brand text, vehicle_models text, category text,
  product_status text, stock_total numeric, score numeric
)
language sql stable security definer set search_path = public
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
  from q where query_norm <> ''
),
q_tokens as (
  select
    p.query_norm,
    p.query_words,
    -- FIX: string_to_array em vez de regexp_split_to_array(E'\s+')
    -- O E'\s+' era interpretado como 's+' (split no char 's'), não whitespace.
    array_remove(string_to_array(p.query_words, ' '), '') as tokens,
    (array_remove(string_to_array(p.query_words, ' '), ''))[1] as core_token,
    p.lim
  from prepared p
),
modifiers as (
  -- termos que, quando prefixam outro produto, indicam peça RELACIONADA (não a principal).
  -- Inclui abreviações reais do catálogo (bronz = bronzina, borr = borracha, reten = retentor).
  select array[
    'bronzina','bronz','bucha','bieleta','coxim','guarda','kit',
    'reparo','arruela','parafuso','retentor','reten','batente',
    'anel','coifa','borracha','borr','porca','presilha','suporte'
  ]::text[] as terms
),
candidates as (
  select
    p.id,
    p."CÓD INTERNO" as sku,
    p."CÓD FABRICANTE" as manufacturer_code,
    p."PRODUTO" as name,
    p.description, p.price_brl, p.brand, p.vehicle_models, p.category,
    p."STATUS" as product_status,
    p."ESTOQUE TOTAL" as stock_total,
    lower(unaccent(coalesce(p."PRODUTO", ''))) as name_norm,
    trim(regexp_replace(lower(unaccent(coalesce(p."PRODUTO", ''))), '[^a-z0-9]+', ' ', 'g')) as name_words,
    lower(unaccent(coalesce(p.description, ''))) as desc_norm,
    lower(unaccent(coalesce(p.vehicle_models, ''))) as vehicle_norm,
    qt.query_norm, qt.query_words, qt.tokens, qt.core_token, qt.lim,
    m.terms as modifier_terms
  from public.wladvan_catalog_products p
  cross join q_tokens qt
  cross join modifiers m
  where p.active = true
),
scored as (
  select c.*,
    -- exclusão rígida por termo explícito
    exists (
      select 1 from unnest(coalesce(exclude_terms, '{}'::text[])) et
      where et is not null and btrim(et) <> ''
        and (c.name_norm like '%' || lower(unaccent(et)) || '%'
             or similarity(c.name_norm, lower(unaccent(et))) >= 0.45)
    ) as has_excluded_term,

    -- penalidade por modificadores no nome que não estão na busca
    (select coalesce(sum(
        case when c.name_norm like '%' || mt || '%'
                  and c.query_words not like '%' || mt || '%'
             then 1.0 else 0.0 end
      ), 0) from unnest(c.modifier_terms) mt
    ) as modifier_penalty,

    -- boost: nome do produto COMEÇA com o termo principal da busca
    -- Ex: busca "biela" → "BIELA MOTOR HR" ganha +5, "BRONZ BIELA HR" não ganha
    (case
      when c.core_token is not null
           and (c.name_words like c.core_token || ' %' or c.name_words = c.core_token)
      then 5.0 else 0.0
    end) as leading_match_boost,

    -- penalidade: nome começa com modificador e o termo principal aparece depois
    -- Ex: busca "biela" → "BRONZ BIELA HR" perde -3.5 (bronz é modificador)
    (case
      when c.core_token is not null
           and c.name_words like '%' || c.core_token || '%'
           and c.name_words not like c.core_token || ' %'
           and c.name_words <> c.core_token
           and exists (
             select 1 from unnest(c.modifier_terms) mt
             where c.name_words like mt || ' %'
               and c.query_words not like mt || '%'
           )
      then 3.5 else 0.0
    end) as modifier_prefix_penalty,

    -- score léxico-semântico
    (
      (case when c.name_norm like '%' || c.query_norm || '%' then 1.0 else 0.0 end) * 4.0
      + similarity(c.name_norm, c.query_norm) * 3.2
      + greatest(word_similarity(c.name_norm, c.query_norm), word_similarity(c.query_norm, c.name_norm)) * 2.0
      + (select coalesce(sum(case when c.name_words like '%' || tk || '%' then 1 else 0 end), 0)
         from unnest(c.tokens) tk) * 0.8
      + (case when c.desc_norm like '%' || c.query_norm || '%' then 1.0 else 0.0 end) * 0.4
      + (case when c.vehicle_norm like '%' || c.query_norm || '%' then 1.0 else 0.0 end) * 0.3
      + (case when c.core_token is not null and c.name_words like '%' || c.core_token || '%' then 1.0 else 0.0 end) * 1.3
    )::numeric as raw_score
  from candidates c
),
filtered as (
  select s.*,
    (s.raw_score
      + s.leading_match_boost
      - (s.modifier_penalty * 2.0)
      - s.modifier_prefix_penalty
    )::numeric as final_score
  from scored s
  where not s.has_excluded_term
    and (
      s.name_norm like '%' || s.query_norm || '%'
      or similarity(s.name_norm, s.query_norm) >= 0.20
      or exists (select 1 from unnest(s.tokens) tk where s.name_words like '%' || tk || '%')
    )
),
dedup as (
  select distinct on (coalesce(nullif(trim(sku), ''), name))
    id, sku, manufacturer_code, name, description, price_brl, brand,
    vehicle_models, category, product_status, stock_total,
    final_score as score, lim
  from filtered
  order by coalesce(nullif(trim(sku), ''), name), final_score desc, name asc
)
select
  d.id, d.sku, d.manufacturer_code, d.name, d.description, d.price_brl,
  d.brand, d.vehicle_models, d.category, d.product_status, d.stock_total, d.score
from dedup d
order by d.score desc, d.name asc
limit (select lim from q_tokens limit 1);
$$;

comment on function public.search_wladvan_products_semantic(text, text[], int)
  is 'v3: fix tokenização, leading match boost, penalidade expandida para modificadores (bronz, bucha, borr…), dedup por SKU.';

revoke all on function public.search_wladvan_products_semantic(text, text[], int) from public;
grant execute on function public.search_wladvan_products_semantic(text, text[], int) to service_role;
