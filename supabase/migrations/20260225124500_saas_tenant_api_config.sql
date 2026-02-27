-- Store tenant API integration config in database (not browser local storage).

create table if not exists public.tenant_api_configs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null unique references public.tenants(id) on delete cascade,
  api_base_url text not null,
  api_token text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_tenant_api_configs_updated_at
before update on public.tenant_api_configs
for each row execute procedure public.set_updated_at();

alter table public.tenant_api_configs enable row level security;

drop policy if exists tenant_api_configs_member_rw on public.tenant_api_configs;
create policy tenant_api_configs_member_rw
on public.tenant_api_configs
for all
using (public.is_tenant_member(tenant_id))
with check (public.is_tenant_member(tenant_id));
