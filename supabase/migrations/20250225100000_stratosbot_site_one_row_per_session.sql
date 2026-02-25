-- StratosBot site: uma linha por session_id com conversation (JSONB).
-- Cria a tabela se não existir; se existir, adiciona colunas e colapsa por session_id.

create extension if not exists pgcrypto;

-- Caso 1: tabela não existe -> criar com schema novo
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
  updated_at timestamptz not null default now()
);

-- Adicionar colunas e constraint se a tabela já existia (schema antigo)
alter table public.stratosbot_site
  add column if not exists conversation jsonb not null default '[]'::jsonb,
  add column if not exists updated_at timestamptz not null default now();

-- Só adicionar UNIQUE se ainda não existir (evita erro quando já há duplicatas)
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'stratosbot_site_session_id_key'
  ) then
    -- Verificar se há duplicatas; se houver, colapsar antes de adicionar UNIQUE
    if exists (
      select 1 from public.stratosbot_site
      group by session_id having count(*) > 1
    ) then
      -- Colapsar: uma linha por session_id com conversation agregado
      create temp table stratosbot_site_agg as
      select
        (array_agg(id order by created_at asc))[1] as id,
        session_id,
        max(event_type) as event_type,
        max(role) as role,
        (array_agg(message order by created_at desc nulls last))[1] as message,
        (array_agg(reply order by created_at desc nulls last))[1] as reply,
        max(lead_name) as lead_name,
        max(lead_phone) as lead_phone,
        max(lead_email) as lead_email,
        max(source) as source,
        max(channel) as channel,
        jsonb_agg(
          jsonb_build_object(
            'role', coalesce(role, 'user'),
            'message', message,
            'reply', reply,
            'at', created_at
          ) order by created_at asc
        ) as conversation,
        min(created_at) as created_at,
        max(created_at) as updated_at
      from public.stratosbot_site
      group by session_id;

      alter table public.stratosbot_site rename to stratosbot_site_old;

      create table public.stratosbot_site (
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

      insert into public.stratosbot_site (
        id, session_id, event_type, role, message, reply,
        lead_name, lead_phone, lead_email, source, channel, payload,
        conversation, created_at, updated_at
      )
      select
        id, session_id, event_type, role, message, reply,
        lead_name, lead_phone, lead_email, source, channel, '{}'::jsonb,
        conversation, created_at, updated_at
      from stratosbot_site_agg;

      drop table public.stratosbot_site_old;
    else
      alter table public.stratosbot_site
        add constraint stratosbot_site_session_id_key unique (session_id);
    end if;
  end if;
end $$;

create index if not exists idx_stratosbot_site_session_id
  on public.stratosbot_site (session_id);

create index if not exists idx_stratosbot_site_updated_at
  on public.stratosbot_site (updated_at desc);

comment on table public.stratosbot_site is
  'Uma linha por sessão do chat demo. conversation = array de { role, message, reply, at }.';
comment on column public.stratosbot_site.conversation is
  'Array de turnos: [{ "role": "user", "message": "...", "reply": "...", "at": "ISO8601" }, ...]';
