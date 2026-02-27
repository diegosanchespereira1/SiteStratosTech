-- Runtime flags for tenant automation publish state.

alter table public.tenants
  add column if not exists automation_enabled boolean not null default false,
  add column if not exists published_at timestamptz,
  add column if not exists publish_notes text;
