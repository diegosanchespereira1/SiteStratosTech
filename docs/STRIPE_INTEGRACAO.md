# Integração Stripe (StratosBot / Supabase)

Fluxo já implementado no código: o onboarding chama **`POST /functions/v1/create-checkout-session`** → o Stripe devolve `checkoutUrl` → o usuário paga → o **`stripe-webhook`** atualiza `subscriptions` e marca o passo **`billing`** no onboarding quando o pagamento conclui.

## 1. Secrets no Supabase

**Project Settings → Edge Functions → Secrets** (ou `supabase secrets set`):

| Variável | Onde obter |
|----------|------------|
| `STRIPE_SECRET_KEY` | Stripe Dashboard → Developers → API keys (`sk_test_...` / `sk_live_...`) |
| `STRIPE_WEBHOOK_SECRET` | Stripe → Developers → Webhooks → seu endpoint → **Signing secret** (`whsec_...`) |

Também precisam existir: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (já usados pelas outras functions).

## 2. Preço no Stripe → tabela `plans`

A Edge Function **não** usa “link de pagamento” copiado na interface; usa o **Price ID** (`price_...`).

1. No Stripe: **Products** → crie/edite o produto de assinatura → copie o **API ID** do preço (recorrente).
2. No Supabase **SQL Editor**:

```sql
-- Exemplo: plano starter (deve bater com planCode enviado pelo front, hoje "starter")
update public.plans
set stripe_price_id = 'price_XXXXXXXXXXXXXXXX'
where code = 'starter';
```

Sem `stripe_price_id`, a API responde: *Plano invalido ou sem stripe_price_id configurado.*

## 3. Webhook no Stripe

1. **URL** (substitua `PROJECT_REF`):

   `https://PROJECT_REF.supabase.co/functions/v1/stripe-webhook`

2. **Deploy sem JWT** (o Stripe não envia `Authorization` do Supabase):

   ```bash
   supabase functions deploy stripe-webhook --no-verify-jwt
   ```

3. **Eventos recomendados** (pelo menos):

   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`

4. Cole o **Signing secret** em `STRIPE_WEBHOOK_SECRET`.

## 4. Deploy da função de checkout

```bash
supabase functions deploy create-checkout-session
```

(Exige JWT do usuário — padrão com verificação ligada.)

## 5. Teste rápido

1. Cartão de teste: `4242 4242 4242 4242`, qualquer CVC/futuro.
2. Após pagamento, no Supabase confira `subscriptions.status` = `active` e `onboarding_steps` com `step_code = billing` e `status = completed`.
3. Recarregue o onboarding: o passo **Assinatura** deve aparecer concluído após `sync` com o backend (query `?stripe=success` na URL de retorno ajuda o front a sincronizar).

## 6. Front-end (`onboarding.html`)

- **Ativar assinatura** envia `planCode: "starter"` e URLs de sucesso/cancelamento com `?stripe=success` ou `?stripe=canceled`.
- Ajuste `planCode` no JS se criar outros planos no banco.

## Referência de API

Ver `supabase/functions/API_CONTRACT_SAAS.md` → `POST /create-checkout-session`.
