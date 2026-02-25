-- Tabela para registrar conversas e leads do demo chat Stratos Bot.
-- Uma linha por session_id; a conversa inteira fica em conversation (JSONB).
-- Execute no SQL Editor do Supabase.

create extension if not exists pgcrypto;

create table if not exists public.stratosbot_site (
  id uuid primary key default gen_random_uuid(),
  session_id text not null,
  event_type text not null default 'chat_message',
  role text,
  message text,
  reply text,
  lead_name text,
  lead_phone text,
  lead_email text,
  source text,
  channel text,
  payload jsonb not null default '{}'::jsonb,
  conversation jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stratosbot_site_session_id_key unique (session_id)
);

create index if not exists idx_stratosbot_site_session_id
  on public.stratosbot_site (session_id);

create index if not exists idx_stratosbot_site_updated_at
  on public.stratosbot_site (updated_at desc);

comment on table public.stratosbot_site is
  'Uma linha por sessão do chat demo. conversation = array de { role, message, reply, at }.';
comment on column public.stratosbot_site.conversation is
  'Array de turnos: [{ "role": "user", "message": "...", "reply": "...", "at": "ISO8601" }, ...]';
