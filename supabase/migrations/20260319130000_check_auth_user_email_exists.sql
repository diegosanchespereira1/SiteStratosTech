-- Permite à Edge Function (service_role) verificar se o e-mail existe em auth.users,
-- sem expor auth.users via API pública. Usado no fluxo "esqueci minha senha".
CREATE OR REPLACE FUNCTION public.check_auth_user_email_exists(p_email text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, auth
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM auth.users
    WHERE lower(trim(email::text)) = lower(trim(p_email))
  );
$$;

REVOKE ALL ON FUNCTION public.check_auth_user_email_exists(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_auth_user_email_exists(text) TO service_role;

COMMENT ON FUNCTION public.check_auth_user_email_exists(text) IS
  'Retorna true se existe linha em auth.users com o e-mail informado. Só service_role pode executar.';
