-- 플레이어 성장정보. 보상 계산 및 저장은 게임 서버에서 수행한다.
CREATE TABLE IF NOT EXISTS public.player_growth (
  player_id UUID PRIMARY KEY
    REFERENCES public.guest_sessions(player_id) ON DELETE CASCADE,
  growth JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 성장정보는 게임 서버 전용 데이터다. Supabase 클라이언트 역할의 직접 접근을 차단한다.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON public.player_growth FROM anon;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON public.player_growth FROM authenticated;
  END IF;
END
$$;
