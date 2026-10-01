-- Cloudflare Worker가 레벨·코인(성장 기록)을 백업하는 테이블.
-- Worker는 guest_sessions를 쓰지 않으므로 외래키를 없애고,
-- 기기 토큰 원문 대신 SHA-256 해시(token_hash)로 지워진 세션의 기록을 되찾는다.
CREATE TABLE IF NOT EXISTS player_growth (
  player_id UUID PRIMARY KEY,
  growth JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE player_growth DROP CONSTRAINT IF EXISTS player_growth_player_id_fkey;
ALTER TABLE player_growth ADD COLUMN IF NOT EXISTS token_hash TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS player_growth_token_hash_idx
  ON player_growth (token_hash) WHERE token_hash IS NOT NULL;

-- Supabase API에서 서버 전용 테이블이 자동 노출되지 않도록 한다.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON player_growth FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON player_growth FROM authenticated;
  END IF;
END
$$;
