-- Admin users table for the internal operator panel.
-- Replaces the shared ADMIN_SECRET env-var with named accounts that can be
-- managed from within /admin/team.  Passwords are stored as bcrypt hashes.
-- Only ever accessed via the Supabase service-role client — no RLS needed.

CREATE TABLE IF NOT EXISTS admin_users (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email           text        NOT NULL UNIQUE,
  password_hash   text        NOT NULL,
  name            text,
  is_active       boolean     NOT NULL DEFAULT true,
  last_login_at   timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text        -- email of the admin who created this record
);
