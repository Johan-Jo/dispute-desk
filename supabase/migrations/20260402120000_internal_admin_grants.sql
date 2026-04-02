-- Internal admin access: Supabase Auth user IDs (same credentials as portal).
-- Replaces password-based admin_users.

CREATE TABLE IF NOT EXISTS internal_admin_grants (
  user_id       uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  email         text        NOT NULL,
  is_active     boolean     NOT NULL DEFAULT true,
  last_login_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    text
);

ALTER TABLE internal_admin_grants ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS; anon/authenticated have no direct access.

CREATE OR REPLACE FUNCTION public.dd_admin_resolve_user_id_by_email(p_email text)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, auth
STABLE
AS $$
  SELECT id
  FROM auth.users
  WHERE lower(trim(email)) = lower(trim(p_email))
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.dd_admin_resolve_user_id_by_email(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dd_admin_resolve_user_id_by_email(text) TO service_role;

CREATE OR REPLACE FUNCTION public.dd_admin_touch_last_login(p_user_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE internal_admin_grants
  SET last_login_at = now()
  WHERE user_id = p_user_id
    AND is_active = true
    AND (
      last_login_at IS NULL
      OR last_login_at < now() - interval '30 minutes'
    );
$$;

REVOKE ALL ON FUNCTION public.dd_admin_touch_last_login(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dd_admin_touch_last_login(uuid) TO service_role;

-- Migrate existing password-based admins (matched by email to auth.users)
INSERT INTO internal_admin_grants (user_id, email, is_active, last_login_at, created_at, created_by)
SELECT u.id,
       u.email,
       au.is_active,
       au.last_login_at,
       au.created_at,
       au.created_by
FROM admin_users au
INNER JOIN auth.users u ON lower(trim(u.email)) = lower(trim(au.email))
ON CONFLICT (user_id) DO NOTHING;

DROP TABLE IF EXISTS admin_users;
