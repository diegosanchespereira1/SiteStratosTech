# Planos (Starter / Pro / Max) — mensal e anual

A migration [`20260320120000_plans_monthly_annual_display_prices.sql`](../supabase/migrations/20260320120000_plans_monthly_annual_display_prices.sql) cria os códigos e o texto **`display_price_brl`**. O pagamento continua a usar **`stripe_price_id`** (`price_...` do Stripe).

## Códigos em `public.plans`

| Código | Preço exibido (referência) |
|--------|----------------------------|
| `starter_monthly` | R$ 169,90 |
| `starter_annual` | R$ 1.540,00 |
| `pro_monthly` | R$ 239,90 |
| `pro_annual` | R$ 2.058,00 |
| `max_monthly` | R$ 599,00 |
| `max_annual` | R$ 4.699,99 |

## Associar preços Stripe (obrigatório para checkout)

1. No **Stripe Dashboard**, crie **6 preços recorrentes** (mensal = `month`, anual = `year`) com os valores pretendidos.
2. Copie o **API ID** de cada preço (`price_...`, não `prod_...`).
3. No **Supabase → SQL Editor**, execute (substitua pelos teus `price_`):

```sql
update public.plans set stripe_price_id = 'price_XXX' where code = 'starter_monthly';
update public.plans set stripe_price_id = 'price_XXX' where code = 'starter_annual';
update public.plans set stripe_price_id = 'price_XXX' where code = 'pro_monthly';
update public.plans set stripe_price_id = 'price_XXX' where code = 'pro_annual';
update public.plans set stripe_price_id = 'price_XXX' where code = 'max_monthly';
update public.plans set stripe_price_id = 'price_XXX' where code = 'max_annual';
```

4. Confirma: `select code, display_price_brl, stripe_price_id from public.plans where active = true order by code;`

## Aplicar a migration

No diretório do projeto (com Supabase ligado ao projeto):

```bash
supabase db push
```

Ou cola o conteúdo do ficheiro SQL no **SQL Editor** do Supabase e executa.
