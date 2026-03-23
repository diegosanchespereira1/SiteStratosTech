# Integração Stripe (StratosBot / Supabase)

Fluxo já implementado no código: o onboarding chama **`POST /functions/v1/create-checkout-session`** → o Stripe devolve `checkoutUrl` → o usuário paga → o **`stripe-webhook`** atualiza `subscriptions` e marca o passo **`billing`** no onboarding quando o pagamento conclui.

## 1. Secrets no Supabase

**Project Settings → Edge Functions → Secrets** (ou `supabase secrets set`):

| Variável | Onde obter |
|----------|------------|
| `STRIPE_SECRET_KEY` | Stripe Dashboard → Developers → API keys (`sk_test_...` / `sk_live_...`). Usada em **`create-checkout-session`** e em **`stripe-webhook`** para [recuperar a Checkout Session](https://docs.stripe.com/payments/checkout/fulfillment) após `checkout.session.completed` (`expand[]=subscription`). Sem ela no webhook, o handler usa só o payload do evento. |
| `STRIPE_WEBHOOK_SECRET` | Stripe → Developers → Webhooks → seu endpoint → **Signing secret** (`whsec_...`) |
| `STRIPE_API_VERSION` | *(opcional)* Versão da API para o header `Stripe-Version` na criação do Checkout. Se omitida, usa o default do código (alinhado ao pacote `stripe` do repositório). |

Também precisam existir: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (já usados pelas outras functions).

### Versão da API Stripe

As chamadas da Edge Function **`create-checkout-session`** enviam o header **`Stripe-Version`**, para não depender só da versão default da conta (ver [API upgrades](https://docs.stripe.com/upgrades)).

- **Webhook:** no Stripe Dashboard, ao criar/editar o endpoint do webhook, use a **mesma versão de API** que o projeto usa (ou deixe explícita no endpoint), para o formato dos eventos bater com o que o código espera — ver [webhook versioning](https://docs.stripe.com/webhooks/versioning).
- **Node (`stripe` no `package.json`):** ao usar o SDK, passe `apiVersion` igual à constante em `supabase/functions/_shared/stripe_api_version.ts` (ou atualize ambos quando subir de versão do pacote).

## 2. Preço no Stripe → tabela `plans`

A Edge Function **não** usa “link de pagamento” copiado na interface; usa o **Price ID** (`price_...`). **Não** use o Product ID (`prod_...`) — se o Stripe devolver *No such price: 'prod_...'*, troque no SQL pelo `price_...` do preço (produto → secção Pricing → API ID do preço).

A migration `20260225113000_saas_core_multitenant.sql` cria os códigos legados **`starter`**, **`pro`** e **`scale`**. A migration `20260320120000_plans_monthly_annual_display_prices.sql` adiciona **`display_price_brl`** e os planos **`starter_monthly`**, **`starter_annual`**, **`pro_monthly`**, **`pro_annual`**, **`max_monthly`**, **`max_annual`** (e desativa os códigos legados de um só intervalo). Só aparecem no onboarding os planos com **`stripe_price_id` preenchido** e `active = true`. Ver também **[STRIPE_PLANOS_PRECOS.md](./STRIPE_PLANOS_PRECOS.md)**.

1. No Stripe: **Products** → crie/edite um produto de assinatura por plano que quiser vender → copie o **API ID** do preço (recorrente).
2. No Supabase **SQL Editor**, associe cada `price_...` ao `code` correspondente:

```sql
-- Substitua pelos Price IDs reais do Stripe (modo test ou live, conforme a chave STRIPE_SECRET_KEY)
update public.plans set stripe_price_id = 'price_XXXXXXXXXXXXXXXX' where code = 'starter';
update public.plans set stripe_price_id = 'price_YYYYYYYYYYYYYYYY' where code = 'pro';
update public.plans set stripe_price_id = 'price_ZZZZZZZZZZZZZZZZ' where code = 'scale';
```

Pode configurar só os planos que for vender; os que ficarem com `stripe_price_id` nulo **não** entram na lista do `onboarding.html`.

Sem `stripe_price_id` para o plano escolhido, a API responde: *Plano invalido ou sem stripe_price_id configurado.*

## 3. Webhook no Stripe

Documentação de referência: [Verify webhook signatures](https://docs.stripe.com/webhooks/signature), [Fulfillment (Checkout)](https://docs.stripe.com/payments/checkout/fulfillment), [checkout.session.completed](https://docs.stripe.com/api/events/types#event_types-checkout.session.completed).

Checklist que costuma quebrar integrações:

- **Corpo bruto** — o handler usa `req.text()` sem reparse; não coloque JSON middleware antes do webhook.
- **`whsec_`** — o secret do **Dashboard** (endpoint de produção) **não** é o do `stripe listen` (CLI); não misturar.
- **`client_reference_id`** — o `create-checkout-session` envia o `tenant_id` também como **`client_reference_id`**. O webhook usa **metadata OU `client_reference_id`** para localizar o tenant (recomendado pela Stripe para correlacionar sessão com o teu registo).
- **`payment_status`** — em `checkout.session.completed`, sessões **`unpaid`** (ex.: métodos assíncronos) não disparam fulfillment; nesses casos usa-se `checkout.session.async_payment_succeeded` (não está no handler atual).
- **Mesma conta / modo** — `sk_test_` com preços de teste; `sk_live_` com preços live.

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
5. Garanta **`STRIPE_SECRET_KEY`** nos secrets (a função **recupera** a sessão na API Stripe após o evento).
6. Se o Dashboard permitir escolher a **API version** do endpoint, alinhe com `STRIPE_API_VERSION` / default em `_shared/stripe_api_version.ts`.

## 4. Deploy da função de checkout

```bash
supabase functions deploy create-checkout-session
```

(Exige JWT do usuário — padrão com verificação ligada.)

### Edge `onboarding-status`

O `GET` usa `onboarding_steps` **e** `subscriptions` para marcar o passo `billing` como concluído (inclui `past_due`, e subscrições com `stripe_subscription_id` quando o redirect volta antes do webhook). Sem deploy desta função, o front pode ficar preso em “sincronizando”.

```bash
supabase functions deploy onboarding-status
```

## 5. Teste rápido

1. Cartão de teste: `4242 4242 4242 4242`, qualquer CVC/futuro.
2. Após pagamento, no Supabase confira `subscriptions.status` = `active` e `onboarding_steps` com `step_code = billing` e `status = completed`.
3. Recarregue o onboarding: o passo **Assinatura** deve aparecer concluído após `sync` com o backend (query `?stripe=success` na URL de retorno ajuda o front a sincronizar).

### “Falha ao criar sessão no Stripe” (502)

A resposta da API passa a incluir a **mensagem devolvida pela Stripe** (ex.: preço inválido). Causas frequentes:

- **`sk_test_...` vs `sk_live_...`** não corresponde ao `price_...` (preço de teste no Dashboard de teste, não misturar com live).
- **Price ID** errado, apagado ou de outra conta Stripe.
- **`STRIPE_API_VERSION`** (secret) incompatível com a conta — deixe em branco para usar o default do código ou alinhe com o [Workbench](https://dashboard.stripe.com/workbench/overview).

## 6. Front-end (`onboarding.html`)

- No passo **Assinatura**, o utilizador **escolhe o plano** (lista carregada do Supabase: planos ativos com `stripe_price_id` preenchido). **Ativar assinatura** envia o `planCode` selecionado para `create-checkout-session`, com URLs de sucesso/cancelamento com `?stripe=success` ou `?stripe=canceled`.
- As chamadas às Edge Functions incluem o header **`apikey`** (anon de `config.js`) junto do **Bearer** do usuário — exigência usual do gateway do Supabase; sem isso o checkout pode falhar com 401 e nunca redirecionar para a Stripe.
- Novos planos: insira a linha em `public.plans` (ou use os códigos existentes) e configure `stripe_price_id` no SQL para o plano aparecer na lista.

## Referência de API

Ver `supabase/functions/API_CONTRACT_SAAS.md` → `POST /create-checkout-session`.
