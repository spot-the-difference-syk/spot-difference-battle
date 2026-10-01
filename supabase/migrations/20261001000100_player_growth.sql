-- 플레이어 레벨·코인. 보상은 게임 서버가 계산해 저장한다.
CREATE TABLE IF NOT EXISTS player_growth (
  player_id UUID PRIMARY KEY REFERENCES guest_sessions(player_id) ON DELETE CASCADE,
  growth JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

