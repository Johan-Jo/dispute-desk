-- 009_portal.sql — Portal user profiles and shop links
-- Supports EPIC P0: External Portal + Marketing

-- Portal user profiles (extends Supabase Auth users)
CREATE TABLE IF NOT EXISTS portal_user_profiles (
  id          uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name   text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Links portal users to shops (many-to-many)
CREATE TABLE IF NOT EXISTS portal_user_shops (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  shop_id     uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  role        text NOT NULL DEFAULT 'admin'
              CHECK (role IN ('admin', 'member', 'read_only')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, shop_id)
);

CREATE INDEX idx_portal_user_shops_user ON portal_user_shops(user_id);
CREATE INDEX idx_portal_user_shops_shop ON portal_user_shops(shop_id);

-- RLS
ALTER TABLE portal_user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal_user_shops ENABLE ROW LEVEL SECURITY;

-- portal_user_profiles: user can read/write own row
CREATE POLICY "Users manage own profile"
  ON portal_user_profiles
  FOR ALL
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- portal_user_profiles: service role bypasses RLS (default in Supabase)

-- portal_user_shops: user can read own rows
CREATE POLICY "Users read own shop links"
  ON portal_user_shops
  FOR SELECT
  USING (user_id = auth.uid());

-- portal_user_shops: service role inserts (OAuth callback creates links server-side)
CREATE POLICY "Service role manages shop links"
  ON portal_user_shops
  FOR ALL
  USING (true)
  WITH CHECK (true);
