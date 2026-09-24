-- The existing seed stores NORMAL; asset difficulty uses MEDIUM.
ALTER TABLE puzzle_catalog DROP CONSTRAINT IF EXISTS puzzle_catalog_difficulty_check;
UPDATE puzzle_catalog SET difficulty = 'MEDIUM' WHERE difficulty = 'NORMAL';
ALTER TABLE puzzle_catalog
  ADD CONSTRAINT puzzle_catalog_difficulty_check
  CHECK (difficulty IN ('UNRATED', 'EASY', 'MEDIUM', 'HARD'));
ALTER TABLE puzzle_catalog ALTER COLUMN difficulty SET DEFAULT 'UNRATED';

CREATE OR REPLACE FUNCTION set_puzzle_catalog_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS puzzle_catalog_set_updated_at ON puzzle_catalog;
CREATE TRIGGER puzzle_catalog_set_updated_at
BEFORE UPDATE ON puzzle_catalog
FOR EACH ROW EXECUTE FUNCTION set_puzzle_catalog_updated_at();

CREATE OR REPLACE FUNCTION activate_puzzle_version(
  requested_pair_id text,
  requested_asset_version text
)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  LOCK TABLE puzzle_catalog IN SHARE ROW EXCLUSIVE MODE;
  IF NOT EXISTS (
    SELECT 1 FROM puzzle_catalog
    WHERE pair_id = requested_pair_id AND asset_version = requested_asset_version
  ) THEN
    RAISE EXCEPTION 'Puzzle version not found: %/%', requested_pair_id, requested_asset_version;
  END IF;

  UPDATE puzzle_catalog SET is_active = FALSE WHERE pair_id = requested_pair_id AND is_active;
  UPDATE puzzle_catalog SET is_active = TRUE
  WHERE pair_id = requested_pair_id AND asset_version = requested_asset_version;
END;
$$;

REVOKE ALL ON FUNCTION set_puzzle_catalog_updated_at() FROM PUBLIC;
REVOKE ALL ON FUNCTION activate_puzzle_version(text, text) FROM PUBLIC;
