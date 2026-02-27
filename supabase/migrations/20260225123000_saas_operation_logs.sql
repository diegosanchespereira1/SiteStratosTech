-- Operational logs for tenant readiness, publish and integration failures.

create table if not exists public.tenant_operation_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  source text not null,
  level text not null default 'info' check (level in ('debug', 'info', 'warn', 'error')),
  event text not null,
  message text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_tenant_operation_logs_tenant_created
  on public.tenant_operation_logs (tenant_id, created_at desc);

create index if not exists idx_tenant_operation_logs_level
  on public.tenant_operation_logs (level, created_at desc);

alter table public.tenant_operation_logs enable row level security;

drop policy if exists tenant_operation_logs_member_read on public.tenant_operation_logs;
create policy tenant_operation_logs_member_read
on public.tenant_operation_logs
for select
using (public.is_tenant_member(tenant_id));

drop policy if exists tenant_operation_logs_member_insert on public.tenant_operation_logs;
create policy tenant_operation_logs_member_insert
on public.tenant_operation_logs
for insert
with check (public.is_tenant_member(tenant_id));
