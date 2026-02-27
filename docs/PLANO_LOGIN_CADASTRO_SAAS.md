# Plano: Login, cadastro e rastreabilidade no onboarding SaaS

## Objetivo

- Tela de **login** e **cadastro** no fluxo do onboarding.
- Cada usuário associado a um **tenant** (empresa/organização); isolamento de dados por tenant.
- **Rastreabilidade**: quem fez o quê, quando e de onde (IP, user-agent), mesmo com usuários remotos e IPs variados.

---

## Modelo atual (resumo)

- **Supabase Auth**: usuários em `auth.users` (email/senha ou outros providers).
- **tenants**: tabela `public.tenants` (id, name, slug, owner_user_id, status).
- **tenant_members**: liga usuário a tenant com role (owner, admin, member). Cada chamada às Edge Functions usa `getUserTenantId(userId)` = primeiro tenant do usuário.
- **tenant_operation_logs**: logs por tenant (source, event, message, details); usado pelo backend.
- Não existe hoje: criação automática de tenant no cadastro; nem registro de sessão/login (IP, user-agent).

---

## Rastreabilidade

Requisito: usuário acessando de casa, escritório, celular, IPs variados — precisamos saber **quem** (user_id, tenant_id), **quando** (timestamp) e **de onde** (IP, user-agent opcional).

| O quê | Onde |
|-------|------|
| Login / abertura de sessão | Nova tabela `auth_login_log`: user_id, tenant_id, ip, user_agent, created_at. Preenchida por uma Edge Function chamada após login (ou na primeira chamada autenticada). |
| Ações por tenant (já existe) | `tenant_operation_logs`: eventos do negócio (publish, webhook, etc.). Opcional: adicionar `user_id` em details ou coluna para “quem” fez a ação. |
| Sessão Supabase | Supabase Auth já mantém sessão (refresh token, etc.). Não armazenamos senha; o token JWT identifica o usuário em cada request. |

**IP e user-agent**: só são confiáveis no **servidor**. Por isso uma Edge Function (ex.: `log-session`) recebe a requisição autenticada, lê `x-forwarded-for` / `x-real-ip` e `user-agent`, obtém `user_id` e `tenant_id` do JWT e grava em `auth_login_log`.

---

## Fluxo de cadastro (novo usuário)

1. Usuário acessa o onboarding (ou página de login).
2. Clica em **Cadastrar**: preenche email, senha e **nome da empresa** (obrigatório para criar o tenant).
3. Front chama `supabase.auth.signUp({ email, password })`.
4. Se sucesso: front chama Edge Function **provision-tenant** (Bearer = session.access_token) com body `{ companyName }`.
   - Backend: valida JWT, obtém `user_id`; verifica se já existe `tenant_member` para esse usuário.
   - Se não existir: cria `tenant` (name, slug único, owner_user_id = user_id), cria `tenant_member` (tenant_id, user_id, role = 'owner'), cria `subscription` (tenant_id, plan starter, status = 'inactive').
   - Retorna tenant_id (e talvez nome do tenant).
5. Front opcionalmente chama **log-session** para registrar primeiro acesso (IP, user_agent).
6. Redireciona ou mostra o onboarding já autenticado (token na sessão; `initSupabaseAuth()` preenche Base API + token).

---

## Fluxo de login (usuário existente)

1. Usuário acessa onboarding e clica em **Entrar**.
2. Preenche email e senha; front chama `supabase.auth.signInWithPassword({ email, password })`.
3. Se sucesso: front opcionalmente chama **log-session** (registra login com IP/user-agent).
4. `initSupabaseAuth()` preenche Base API + token; mostra o conteúdo do onboarding.

---

## Tarefas de implementação (ordem)

| # | Tarefa | Descrição |
|---|--------|-----------|
| 1 | Migration `auth_login_log` | Tabela para registrar cada login/sessão: user_id, tenant_id, ip, user_agent, created_at. RLS: usuário só vê os próprios registros (ou só admin). |
| 2 | Edge Function **provision-tenant** | POST; JWT obrigatório. Cria tenant + tenant_member + subscription (starter, inactive) para o user quando ainda não tem tenant. Body: `{ companyName }`. Slug único a partir do nome. |
| 3 | Edge Function **log-session** | POST; JWT obrigatório. Lê IP (x-forwarded-for / x-real-ip) e user-agent do request; obtém user_id e tenant_id; insere em auth_login_log. Chamada opcional pelo front após login/signup. |
| 4 | Tela login/cadastro no onboarding | Na mesma página (onboarding.html): se não houver sessão, mostrar bloco com abas ou links "Entrar" e "Cadastrar". Cadastro: email, senha, nome da empresa. Login: email, senha. Após sucesso, esconder login e mostrar onboarding; preencher config (initSupabaseAuth) e permitir uso das etapas. |
| 5 | (Opcional) user_id em operações | Incluir user_id em `tenant_operation_logs.details` ou nova coluna para auditoria de “quem” fez cada ação. |

---

## Segurança e boas práticas

- **Senha**: nunca enviada ao backend; Supabase Auth faz signUp/signIn no cliente.
- **JWT**: todas as Edge Functions que alteram dados exigem Authorization Bearer e validam com `getUserTenantId`.
- **Tenant**: um usuário pode ter mais de um tenant (tenant_members); hoje o fluxo usa o “primeiro” (order by created_at). Cadastro cria um tenant por usuário; depois pode-se adicionar “convidar usuário” para o mesmo tenant.
- **RLS**: auth_login_log com política para o usuário ver apenas seus próprios logs (ou apenas leitura por service_role para admin).

---

## Arquivos a criar/alterar

- **Migration**: `supabase/migrations/YYYYMMDD_auth_login_log.sql`
- **Edge Functions**: `supabase/functions/provision-tenant/index.ts`, `supabase/functions/log-session/index.ts`
- **Front**: `StratosBot/onboarding.html` — bloco de login/cadastro + chamadas a provision-tenant e log-session após auth.
