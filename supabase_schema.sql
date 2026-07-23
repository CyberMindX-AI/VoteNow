-- ============================================================
-- VoteNow — Supabase Schema
-- Run this entire file in your Supabase SQL Editor:
-- https://supabase.com/dashboard/project/lhzkyvktjwyprggcjdvu/sql/new
-- ============================================================

-- 1. CONTESTS TABLE
CREATE TABLE IF NOT EXISTS contests (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  vote_price  NUMERIC DEFAULT 100,
  active      BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 2. CONTESTANTS TABLE
CREATE TABLE IF NOT EXISTS contestants (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  contest_id  UUID REFERENCES contests(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  photo       TEXT DEFAULT '',
  votes       INTEGER DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 3. FEED / ACTIVITY LOG TABLE
CREATE TABLE IF NOT EXISTS feed (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  voter_name       TEXT DEFAULT 'Someone',
  contestant_id    UUID REFERENCES contestants(id) ON DELETE SET NULL,
  contestant_name  TEXT,
  contest_id       UUID REFERENCES contests(id) ON DELETE SET NULL,
  contest_name     TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- 4. RPC FUNCTION — atomic vote increment (prevents race conditions)
CREATE OR REPLACE FUNCTION increment_votes(p_contestant_id UUID)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE contestants SET votes = votes + 1 WHERE id = p_contestant_id;
END;
$$;

-- 5. ENABLE ROW LEVEL SECURITY
ALTER TABLE contests   ENABLE ROW LEVEL SECURITY;
ALTER TABLE contestants ENABLE ROW LEVEL SECURITY;
ALTER TABLE feed       ENABLE ROW LEVEL SECURITY;

-- 6. PUBLIC READ POLICIES (anyone can read active data)
DROP POLICY IF EXISTS "Public read contests"    ON contests;
DROP POLICY IF EXISTS "Public read contestants" ON contestants;
DROP POLICY IF EXISTS "Public read feed"        ON feed;

CREATE POLICY "Public read contests"    ON contests    FOR SELECT USING (true);
CREATE POLICY "Public read contestants" ON contestants FOR SELECT USING (true);
CREATE POLICY "Public read feed"        ON feed        FOR SELECT USING (true);

-- 7. ENABLE REALTIME on all tables
-- Go to Supabase Dashboard > Database > Replication and enable:
--   contests, contestants, feed tables under "supabase_realtime" publication
-- OR run:
ALTER PUBLICATION supabase_realtime ADD TABLE contests;
ALTER PUBLICATION supabase_realtime ADD TABLE contestants;
ALTER PUBLICATION supabase_realtime ADD TABLE feed;

-- ============================================================
-- 8. STORAGE — Contestant Photos
-- ============================================================
-- Create the public bucket (run in SQL editor)
INSERT INTO storage.buckets (id, name, public)
VALUES ('contestant-photos', 'contestant-photos', true)
ON CONFLICT (id) DO NOTHING;

-- Allow anyone to READ photos (public bucket)
DROP POLICY IF EXISTS "Public read contestant photos" ON storage.objects;
CREATE POLICY "Public read contestant photos"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'contestant-photos');

-- Allow authenticated/anon uploads (admin uses the Supabase anon key)
DROP POLICY IF EXISTS "Allow uploads to contestant-photos" ON storage.objects;
CREATE POLICY "Allow uploads to contestant-photos"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'contestant-photos');

-- Allow deletes (for when contestants are removed)
DROP POLICY IF EXISTS "Allow deletes in contestant-photos" ON storage.objects;
CREATE POLICY "Allow deletes in contestant-photos"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'contestant-photos');
