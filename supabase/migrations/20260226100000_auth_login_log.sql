-- Rastreabilidade de login/sessão: quem, quando e de onde (IP, user-agent).
-- Útil para SaaS com usuários remotos e IPs variados.

create table if not exists public.auth_login_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  tenant_id uuid references public.tenants(id) on delete set null,
  ip text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists idx_auth_login_log_user_created
  on public.auth_login_log (user_id, created_at desc);

create index if not exists idx_auth_login_log_tenant_created
  on public.auth_login_log (tenant_id, created_at desc);

alter table public.auth_login_log enable row level security;

-- Usuário autenticado só vê seus próprios registros de login.
create policy auth_login_log_user_select
on public.auth_login_log
for select
using (auth.uid() = user_id);

-- Inserção apenas pelo backend (Edge Function com service_role). Sem policy de INSERT para roles anon/authenticated.

comment on table public.auth_login_log is 'Registro de cada login/sessão para rastreabilidade (user, tenant, IP, user-agent).';
