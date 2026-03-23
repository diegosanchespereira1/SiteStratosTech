-- Planos Starter / Pro / Max com recorrência mensal e anual.
-- Valores em display_price_brl são só referência na UI/admin.
-- stripe_price_id deve ser preenchido com o Price ID do Stripe (price_...) após criar os preços no Dashboard.

alter table public.plans
  add column if not exists display_price_brl text;

comment on column public.plans.display_price_brl is 'Texto de preço para exibição (ex.: R$ 239,90). O checkout usa stripe_price_id.';

insert into public.plans (code, name, monthly_message_limit, max_whatsapp_instances, active, display_price_brl)
values
  ('starter_monthly', 'Starter — recorrência mensal', 1500, 1, true, 'R$ 169,90'),
  ('starter_annual', 'Starter — recorrência anual', 1500, 1, true, 'R$ 1.540,00'),
  ('pro_monthly', 'Pro — recorrência mensal', 10000, 3, true, 'R$ 239,90'),
  ('pro_annual', 'Pro — recorrência anual', 10000, 3, true, 'R$ 2.058,00'),
  ('max_monthly', 'Max — recorrência mensal', 50000, 10, true, 'R$ 599,00'),
  ('max_annual', 'Max — recorrência anual', 50000, 10, true, 'R$ 4.699,99')
on conflict (code) do update set
  name = excluded.name,
  monthly_message_limit = excluded.monthly_message_limit,
  max_whatsapp_instances = excluded.max_whatsapp_instances,
  active = excluded.active,
  display_price_brl = excluded.display_price_brl,
  updated_at = now();

-- Desativa códigos legados (um intervalo só) se existirem, para o onboarding listar só mensal/anual.
update public.plans
set active = false, updated_at = now()
where code in ('starter', 'pro', 'scale');
