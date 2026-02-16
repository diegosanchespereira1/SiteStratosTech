-- Tabela para registrar quem pediu aviso de lancamento.
-- Execute no Supabase SQL Editor.

create extension if not exists "pgcrypto";

create table if not exists public.registrations (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  email text not null unique,
  created_at timestamptz not null default now(),
  user_agent text null
);

-- Opcional: reforcos simples de qualidade (nao bloqueia nomes longos demais pelo frontend)
alter table public.registrations
  add constraint registrations_nome_len check (char_length(nome) >= 2 and char_length(nome) <= 120);

alter table public.registrations
  add constraint registrations_email_len check (char_length(email) <= 254);

-- Permissoes + RLS para permitir cadastro publico (somente INSERT).
grant usage on schema public to anon;
grant insert on table public.registrations to anon;

alter table public.registrations enable row level security;

drop policy if exists "anon_insert_registrations" on public.registrations;
create policy "anon_insert_registrations"
on public.registrations
for insert
to anon
with check (true);

