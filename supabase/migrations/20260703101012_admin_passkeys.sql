-- Custom WebAuthn (passkey / Face ID / Windows Hello) second factor for the
-- internal admin panel. Supabase's built-in WebAuthn MFA is server-side gated
-- off on this org (PATCH .../config/auth -> HTTP 422 on both Free dev and Pro
-- prod), so we store passkey credentials ourselves and gate /admin on a
-- passkey-verified session cookie. See docs/technical.md § Internal Admin Panel.
--
-- One row per registered authenticator per admin user. Enforcement is in
-- middleware.ts (admin gates) + app/api/admin/passkeys/*.
--
-- LOCK-OUT ESCAPE HATCH: if an admin loses all their devices, a service-role
-- operator can reset them to the enrollment flow with:
--   DELETE FROM admin_passkeys WHERE user_id = '<auth.users uuid>';
-- (Same trust level as granting admin — service-role DB access only.)

CREATE TABLE IF NOT EXISTS admin_passkeys (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  credential_id text NOT NULL,              -- base64url-encoded credential ID
  public_key    bytea NOT NULL,             -- COSE-encoded public key
  counter       bigint NOT NULL DEFAULT 0,  -- signature counter (clone detection)
  transports    text[],                     -- 'internal','hybrid','usb','nfc','ble'
  friendly_name text,                       -- e.g. "MacBook Touch ID"
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_used_at  timestamptz
);

-- A credential ID is globally unique; used to look up the row during auth.
CREATE UNIQUE INDEX IF NOT EXISTS admin_passkeys_credential_id_key
  ON admin_passkeys (credential_id);

CREATE INDEX IF NOT EXISTS admin_passkeys_user_id_idx
  ON admin_passkeys (user_id);

-- Service role bypasses RLS; anon/authenticated get no direct access
-- (mirrors internal_admin_grants). All reads/writes go through server-only
-- routes using the service-role client.
ALTER TABLE admin_passkeys ENABLE ROW LEVEL SECURITY;
