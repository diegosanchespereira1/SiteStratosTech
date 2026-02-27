-- Add structured chunks for tenant knowledge files.

create table if not exists public.knowledge_chunks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  knowledge_file_id uuid not null references public.knowledge_files(id) on delete cascade,
  chunk_index integer not null,
  content text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (knowledge_file_id, chunk_index)
);

create index if not exists idx_knowledge_chunks_tenant_file
  on public.knowledge_chunks (tenant_id, knowledge_file_id, chunk_index);

alter table public.knowledge_chunks enable row level security;

drop policy if exists knowledge_chunks_member_rw on public.knowledge_chunks;
create policy knowledge_chunks_member_rw
on public.knowledge_chunks
for all
using (public.is_tenant_member(tenant_id))
with check (public.is_tenant_member(tenant_id));
