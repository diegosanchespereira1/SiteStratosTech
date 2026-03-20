# Supabase — Site URL e Redirect URLs (reset de senha / onboarding)

## Qual URL você deve usar no link de reset?

É a **URL completa da página** onde o usuário **cai depois de clicar no e-mail** e onde o app troca o token da recuperação por sessão e **define a nova senha**.

| Ambiente | Exemplo (ajuste porta/caminho) |
|----------|--------------------------------|
| Teste local (`python3 -m http.server 3000`) | `http://localhost:3000/onboarding.html` |
| Mesmo servidor via IP | `http://127.0.0.1:3000/onboarding.html` |
| Produção | `https://seu-dominio.com/onboarding.html` |

1. **Authentication → URL Configuration → Redirect URLs:** inclua **exatamente** essa URL (ou use curinga `http://localhost:3000/**` se o painel permitir).
2. **`StratosBot/config.js`:** `window.SUPABASE_PASSWORD_RESET_REDIRECT` deve ser a **mesma** URL que você cadastrou (o pedido “esqueci a senha” envia isso como `redirect_to` para o GoTrue).

O e-mail do Supabase primeiro abre o domínio do projeto (`*.supabase.co/auth/...`) e **redireciona** para essa URL com os parâmetros da sessão (hash ou query, conforme o projeto). O `onboarding.html` trata o evento **PASSWORD_RECOVERY** e mostra o formulário **“Definir nova senha”**.

### Por que o link no e-mail é enorme?

É **normal**. O endereço inclui o **token** de uso único (longo), o `type=recovery` e o `redirect_to`. Não dá para encurtar sem mudar de fluxo (ex.: outro produto de e-mail transacional).

### `redirect_to` só com `http://localhost:3000` (sem `/onboarding.html`)

Isso acontece quando o pedido de reset foi feito com o site aberto na **raiz** (`http://localhost:3000/`) e o `redirect_to` virou só a origem. Duas soluções:

1. **Manter** `http://localhost:3000` nas Redirect URLs do Supabase e usar o **`index.html`** na pasta do servidor estático: ele **redireciona** para `onboarding.html` **mantendo o `#hash`** dos tokens (já incluído neste repositório em `StratosBot/index.html`).
2. Ou garantir **`SUPABASE_PASSWORD_RESET_REDIRECT`** com path completo (`…/onboarding.html`) e pedir um **novo** e-mail de reset.

---

O fluxo **“Esqueci a senha”** envia para o GoTrue um `redirect_to`. **Toda URL usada aí precisa estar permitida** no painel; caso contrário o Auth pode **recusar** o pedido ou o link do e-mail **não funciona** — e o e-mail pode **nem ser enviado**.

> Não dá para aplicar isso pelo repositório: é obrigatório configurar no **Dashboard** do projeto (ou Management API com token seu).

## Onde configurar

1. Abra [Supabase Dashboard](https://supabase.com/dashboard) → seu projeto.
2. **Authentication** → **URL Configuration**.

### Site URL

- **Desenvolvimento** (servidor local na porta 3000):  
  `http://localhost:3000`
- **Produção**: a URL pública do site (ex.: `https://app.suaempresa.com`).

### Redirect URLs

Clique em **Add URL** e inclua **pelo menos** as que você realmente usa no navegador.

**Teste local com Python (`python3 -m http.server 3000`):**

| URL | Motivo |
|-----|--------|
| `http://localhost:3000/onboarding.html` | Acesso por `localhost` |
| `http://127.0.0.1:3000/onboarding.html` | Mesma origem com IP (URL diferente no Auth) |

Se usar **outra porta** (ex. 8080), troque `3000` pela porta e adicione as duas variantes (`localhost` e `127.0.0.1`).

**Atalho com curinga (se o painel aceitar na sua conta):**

- `http://localhost:3000/**`
- `http://127.0.0.1:3000/**`

**Produção:** inclua a URL completa da página de onboarding, por exemplo:

- `https://seu-dominio.com/onboarding.html`

Salve as alterações.

## Alinhar o front com o painel

No `StratosBot/config.js` defina **a mesma URL** que você cadastrou em Redirect URLs:

```js
window.SUPABASE_PASSWORD_RESET_REDIRECT = "http://localhost:3000/onboarding.html";
```

Assim o `redirect_to` do reset **não depende** de abrir o site como `localhost` vs `127.0.0.1` por engano.

## Log: `bg recover HTTP 500` — `Error sending recovery email`

Se aparecer algo como:

```text
bg recover HTTP 500 {"msg":"Error sending recovery email","error_code":"unexpected_failure",...}
```

isso vem do **GoTrue** (Auth do Supabase): o pedido de recuperação foi aceito em termos de utilizador/redirect, mas o **envio SMTP falhou** no servidor do Supabase. **Não é falha da Edge Function** nem do `onboarding.html`.

### O que rever (Authentication → SMTP)

| Verificação | Detalhe |
|-------------|---------|
| **SMTP customizado** | Host, porta (muitas vezes **465** SSL ou **587** STARTTLS), utilizador e palavra-passe de aplicação (Gmail/Outlook costumam exigir “app password”, não a password normal). |
| **Remetente (“From”)** | O e-mail/dominio do remetente tem de ser permitido pelo teu provedor (SPF/DKIM no domínio, se for e-mail próprio). |
| **Rate limit / bloqueio** | Provedor gratuito pode bloquear ou limitar; vê logs do SMTP ou painel do Resend/SendGrid/etc. |
| **Voltar ao e-mail built-in** | Para isolar o problema, em projetos de teste podes temporariamente usar o envio padrão do Supabase (se disponível no teu plano) e confirmar se o reset volta a funcionar. |
| **Suporte Supabase** | O campo `error_id` (ex.: `…-GRU`) podes mencionar ao suporte se precisares de detalhe interno. |

Confirma também **Authentication → Logs** no mesmo instante do erro — às vezes há mais contexto.

---

## Ainda não chega o e-mail?

1. **Edge Functions** → **password-reset-request** → **Logs**:
   - **`quick recover OK`** + resposta **200** com `emailDispatchConfirmed` no JSON → o GoTrue aceitou; se não há e-mail, o problema é **SMTP/provedor** ou bloqueio no destino (spam).
   - **`quick recover failed`** com **4xx** → leia o corpo no log: quase sempre **Redirect URL** não bate com o `redirect_to` enviado pelo `config.js` (`SUPABASE_PASSWORD_RESET_REDIRECT`).
   - **`bg recover HTTP`** (segunda tentativa) → se não for **200**, o e-mail provavelmente não foi disparado.
2. **Authentication** → **Logs** — falhas de envio do Auth.
3. **Authentication** → **SMTP** — host, porta, TLS, usuário/senha; envie um e-mail de teste se o painel oferecer.
4. Caixa de **spam** / **Promoções** (Gmail).

## Docker / nginx

Se o onboarding for servido em outro host/porta, repita: mesma URL em **Redirect URLs** e em `SUPABASE_PASSWORD_RESET_REDIRECT`.
