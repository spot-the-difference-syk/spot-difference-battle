-- Cloudflare Worker/DO의 database 카탈로그 전환 전에 현재 운영 범위를
-- home-office 퍼즐 한 쌍으로 고정한다.
-- R2 객체 자체는 DB에 저장하지 않고 object key와 검증된 정답만 유지한다.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM puzzle_catalog
    WHERE pair_id = 'home-office'
      AND asset_version = '2026-08-28.2'
  ) THEN
    RAISE EXCEPTION 'Required home-office puzzle version is missing';
  END IF;
END
$$;

-- 현재 단계에서는 home-office만 DB 카탈로그 대상으로 사용한다.
UPDATE puzzle_catalog
SET is_active = FALSE
WHERE pair_id <> 'home-office'
  AND is_active;

SELECT activate_puzzle_version('home-office', '2026-08-28.2');

-- Worker가 읽는 R2 key 형식과 정답 JSON의 최소 정합성을 DB에서 보장한다.
DO $$
DECLARE
  puzzle puzzle_catalog%ROWTYPE;
BEGIN
  SELECT *
  INTO STRICT puzzle
  FROM puzzle_catalog
  WHERE pair_id = 'home-office'
    AND asset_version = '2026-08-28.2'
    AND is_active;

  IF puzzle.original_asset_key <> 'puzzles/home-office/2026-08-28.2/runtime/original.webp'
     OR puzzle.modified_asset_key <> 'puzzles/home-office/2026-08-28.2/runtime/modified.webp' THEN
    RAISE EXCEPTION 'home-office R2 object keys do not match the verified runtime assets';
  END IF;

  IF jsonb_typeof(puzzle.differences) <> 'array'
     OR jsonb_array_length(puzzle.differences) <> 3 THEN
    RAISE EXCEPTION 'home-office must contain exactly three verified differences';
  END IF;
END
$$;
