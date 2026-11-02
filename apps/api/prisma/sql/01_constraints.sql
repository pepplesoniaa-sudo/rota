-- Run as rota_owner. Applied to both shards unless marked.

-- No overlapping live shifts for one assignee in one team.
-- Deferrable, so a swap transaction can run SET CONSTRAINTS shift_no_overlap DEFERRED.
CREATE EXTENSION IF NOT EXISTS btree_gist;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'shift_no_overlap'
  ) THEN
    ALTER TABLE shift ADD CONSTRAINT shift_no_overlap
      EXCLUDE USING gist (
        team_id WITH =,
        assignee_user_id WITH =,
        tstzrange(starts_at, ends_at, '[)') WITH &&
      ) WHERE (deleted_at IS NULL) DEFERRABLE INITIALLY IMMEDIATE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'shift_duration'
  ) THEN
    ALTER TABLE shift ADD CONSTRAINT shift_duration
      CHECK (ends_at - starts_at BETWEEN interval '15 minutes' AND interval '16 hours');
  END IF;
END $$;

-- One open swap per requester shift
CREATE UNIQUE INDEX IF NOT EXISTS swap_one_open_per_shift ON swap_request (requester_shift_id)
  WHERE status IN ('PENDING_PEER', 'PENDING_MANAGER');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'availability_range'
  ) THEN
    ALTER TABLE availability_block ADD CONSTRAINT availability_range
      CHECK (start_minute >= 0 AND end_minute <= 1440 AND end_minute > start_minute
             AND day_of_week BETWEEN 1 AND 7);
  END IF;
END $$;

-- One active owner per team (meaningful on shard 0).
-- Not deferrable, so ownership transfer demotes the old owner before promoting the new one.
CREATE UNIQUE INDEX IF NOT EXISTS membership_one_owner ON membership (team_id)
  WHERE role = 'OWNER' AND status = 'ACTIVE';

-- Invites never grant the owner role (meaningful on shard 0)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'invite_role_not_owner'
  ) THEN
    ALTER TABLE invite ADD CONSTRAINT invite_role_not_owner CHECK (role <> 'OWNER');
  END IF;
END $$;

-- Append-only ledger (meaningful on shard 0)
CREATE OR REPLACE FUNCTION ledger_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ledger_entry is append-only';
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'ledger_no_update_delete'
  ) THEN
    CREATE TRIGGER ledger_no_update_delete
      BEFORE UPDATE OR DELETE ON ledger_entry
      FOR EACH ROW EXECUTE FUNCTION ledger_append_only();
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'ledger_no_truncate'
  ) THEN
    CREATE TRIGGER ledger_no_truncate
      BEFORE TRUNCATE ON ledger_entry
      FOR EACH STATEMENT EXECUTE FUNCTION ledger_append_only();
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rota_app') THEN
    REVOKE UPDATE, DELETE, TRUNCATE ON ledger_entry FROM rota_app;
    GRANT SELECT, INSERT ON ledger_entry TO rota_app;
  END IF;
END $$;

