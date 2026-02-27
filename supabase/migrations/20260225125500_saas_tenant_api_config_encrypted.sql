-- Add encrypted storage for tenant API token.

alter table public.tenant_api_configs
  add column if not exists api_token_encrypted text;
