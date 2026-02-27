-- SaaS core schema for StratosBot (multi-tenant + billing + onboarding).
-- This migration is designed for a dedicated Supabase project for the SaaS.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Common helpers
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Tenancy
-- ---------------------------------------------------------------------------
create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  owner_user_id uuid not null,
  status text not null default 'active' check (status in ('active', 'suspended', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_tenants_updated_at
before update on public.tenants
for each row execute procedure public.set_updated_at();

create table if not exists public.tenant_members (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null,
  role text not null default 'owner' check (role in ('owner', 'admin', 'member')),
  created_at timestamptz not null default now(),
  unique (tenant_id, user_id)
);

create index if not exists idx_tenant_members_user on public.tenant_members(user_id);

create or replace function public.is_tenant_member(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id = p_tenant_id
      and tm.user_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------------
-- Plans and subscriptions
-- ---------------------------------------------------------------------------
create table if not exists public.plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  stripe_price_id text unique,
  monthly_message_limit integer not null default 1000,
  max_whatsapp_instances integer not null default 1,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_plans_updated_at
before update on public.plans
for each row execute procedure public.set_updated_at();

insert into public.plans (code, name, monthly_message_limit, max_whatsapp_instances)
values
  ('starter', 'Starter', 1500, 1),
  ('pro', 'Pro', 10000, 3),
  ('scale', 'Scale', 50000, 10)
on conflict (code) do nothing;

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null unique references public.tenants(id) on delete cascade,
  plan_id uuid not null references public.plans(id),
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  stripe_checkout_session_id text unique,
  status text not null default 'inactive' check (status in ('trialing', 'active', 'past_due', 'canceled', 'inactive')),
  current_period_start timestamptz,
  current_period_end timestamptz,
  trial_ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_subscriptions_tenant_status on public.subscriptions(tenant_id, status);

create trigger trg_subscriptions_updated_at
before update on public.subscriptions
for each row execute procedure public.set_updated_at();

create table if not exists public.billing_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete set null,
  source text not null default 'stripe',
  external_event_id text not null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (source, external_event_id)
);

create index if not exists idx_billing_events_tenant_created on public.billing_events(tenant_id, created_at desc);

-- ---------------------------------------------------------------------------
-- WhatsApp and AI config
-- ---------------------------------------------------------------------------
create table if not exists public.whatsapp_instances (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  provider text not null default 'evolution',
  instance_key text not null unique,
  phone_number text,
  status text not null default 'disconnected' check (status in ('disconnected', 'connecting', 'connected', 'error')),
  metadata jsonb not null default '{}'::jsonb,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_whatsapp_instances_tenant on public.whatsapp_instances(tenant_id);

create trigger trg_whatsapp_instances_updated_at
before update on public.whatsapp_instances
for each row execute procedure public.set_updated_at();

create table if not exists public.agent_configs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null unique references public.tenants(id) on delete cascade,
  assistant_name text not null default 'Assistente',
  objective text,
  tone text not null default 'profissional',
  allowed_topics text[] not null default '{}',
  blocked_topics text[] not null default '{}',
  response_guidelines text,
  fallback_human text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_agent_configs_updated_at
before update on public.agent_configs
for each row execute procedure public.set_updated_at();

create table if not exists public.knowledge_files (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  file_name text not null,
  storage_path text not null,
  mime_type text not null,
  size_bytes bigint not null,
  status text not null default 'uploaded' check (status in ('uploaded', 'processing', 'ready', 'failed')),
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_knowledge_files_tenant on public.knowledge_files(tenant_id, created_at desc);

create trigger trg_knowledge_files_updated_at
before update on public.knowledge_files
for each row execute procedure public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Runtime events and conversations
-- ---------------------------------------------------------------------------
create table if not exists public.usage_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  event_type text not null,
  quantity integer not null default 1,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_usage_events_tenant_created on public.usage_events(tenant_id, created_at desc);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  whatsapp_instance_id uuid references public.whatsapp_instances(id) on delete set null,
  external_contact_id text not null,
  channel text not null default 'whatsapp',
  last_message_at timestamptz,
  messages jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, external_contact_id, channel)
);

create index if not exists idx_conversations_tenant_updated on public.conversations(tenant_id, updated_at desc);

create trigger trg_conversations_updated_at
before update on public.conversations
for each row execute procedure public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Onboarding progress
-- ---------------------------------------------------------------------------
create table if not exists public.onboarding_steps (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  step_code text not null,
  status text not null default 'pending' check (status in ('pending', 'completed')),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, step_code)
);

create index if not exists idx_onboarding_steps_tenant on public.onboarding_steps(tenant_id);

create trigger trg_onboarding_steps_updated_at
before update on public.onboarding_steps
for each row execute procedure public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.tenants enable row level security;
alter table public.tenant_members enable row level security;
alter table public.plans enable row level security;
alter table public.subscriptions enable row level security;
alter table public.billing_events enable row level security;
alter table public.whatsapp_instances enable row level security;
alter table public.agent_configs enable row level security;
alter table public.knowledge_files enable row level security;
alter table public.usage_events enable row level security;
alter table public.conversations enable row level security;
alter table public.onboarding_steps enable row level security;

-- Members can read their tenant data.
drop policy if exists tenants_member_select on public.tenants;
create policy tenants_member_select
on public.tenants
for select
using (public.is_tenant_member(id));

drop policy if exists tenant_members_member_select on public.tenant_members;
create policy tenant_members_member_select
on public.tenant_members
for select
using (public.is_tenant_member(tenant_id));

drop policy if exists tenant_members_member_insert_self on public.tenant_members;
create policy tenant_members_member_insert_self
on public.tenant_members
for insert
with check (auth.uid() = user_id);

-- Plans are public to authenticated users.
drop policy if exists plans_auth_read on public.plans;
create policy plans_auth_read
on public.plans
for select
using (auth.uid() is not null and active = true);

-- Tenant scoped tables.
drop policy if exists subscriptions_member_rw on public.subscriptions;
create policy subscriptions_member_rw
on public.subscriptions
for all
using (public.is_tenant_member(tenant_id))
with check (public.is_tenant_member(tenant_id));

drop policy if exists billing_events_member_read on public.billing_events;
create policy billing_events_member_read
on public.billing_events
for select
using (tenant_id is null or public.is_tenant_member(tenant_id));

drop policy if exists whatsapp_instances_member_rw on public.whatsapp_instances;
create policy whatsapp_instances_member_rw
on public.whatsapp_instances
for all
using (public.is_tenant_member(tenant_id))
with check (public.is_tenant_member(tenant_id));

drop policy if exists agent_configs_member_rw on public.agent_configs;
create policy agent_configs_member_rw
on public.agent_configs
for all
using (public.is_tenant_member(tenant_id))
with check (public.is_tenant_member(tenant_id));

drop policy if exists knowledge_files_member_rw on public.knowledge_files;
create policy knowledge_files_member_rw
on public.knowledge_files
for all
using (public.is_tenant_member(tenant_id))
with check (public.is_tenant_member(tenant_id));

drop policy if exists usage_events_member_read on public.usage_events;
create policy usage_events_member_read
on public.usage_events
for select
using (public.is_tenant_member(tenant_id));

drop policy if exists usage_events_member_insert on public.usage_events;
create policy usage_events_member_insert
on public.usage_events
for insert
with check (public.is_tenant_member(tenant_id));

drop policy if exists conversations_member_rw on public.conversations;
create policy conversations_member_rw
on public.conversations
for all
using (public.is_tenant_member(tenant_id))
with check (public.is_tenant_member(tenant_id));

drop policy if exists onboarding_steps_member_rw on public.onboarding_steps;
create policy onboarding_steps_member_rw
on public.onboarding_steps
for all
using (public.is_tenant_member(tenant_id))
with check (public.is_tenant_member(tenant_id));
