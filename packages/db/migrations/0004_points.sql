CREATE TABLE app.season (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES app.workspace (id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- 29 days, so season end plus cleanup lag (cron every 6 h) stays inside the 30-day limit (non-negotiable 3).
  CHECK (ends_at > starts_at AND ends_at <= starts_at + interval '29 days'),
  UNIQUE (id, workspace_id)
);
CREATE INDEX season_workspace_idx ON app.season (workspace_id, ends_at DESC);

-- Per viewer only the channel id and counters (non-negotiable 2); rows go when their season ends (non-negotiable 3).
CREATE TABLE app.viewer_points (
  season_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  channel_id text NOT NULL CHECK (channel_id ~ '^UC[A-Za-z0-9_-]{22}$'),
  points integer NOT NULL DEFAULT 0 CHECK (points >= 0),
  joins integer NOT NULL DEFAULT 0 CHECK (joins >= 0),
  votes integer NOT NULL DEFAULT 0 CHECK (votes >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (season_id, channel_id),
  FOREIGN KEY (season_id, workspace_id) REFERENCES app.season (id, workspace_id) ON DELETE CASCADE
);
CREATE INDEX viewer_points_rank_idx ON app.viewer_points (season_id, points DESC);
CREATE INDEX viewer_points_channel_idx ON app.viewer_points (workspace_id, channel_id);

-- One row per applied flush batch, so a retried flush (eviction, ambiguous commit) is applied once. No personal data.
CREATE TABLE app.points_batch (
  batch_id uuid PRIMARY KEY,
  season_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (season_id, workspace_id) REFERENCES app.season (id, workspace_id) ON DELETE CASCADE
);

CREATE TABLE app.maintenance_heartbeat (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  ran_at timestamptz NOT NULL
);

ALTER TABLE app.season ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.season FORCE ROW LEVEL SECURITY;
ALTER TABLE app.viewer_points ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.viewer_points FORCE ROW LEVEL SECURITY;
ALTER TABLE app.points_batch ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.points_batch FORCE ROW LEVEL SECURITY;
ALTER TABLE app.maintenance_heartbeat ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.maintenance_heartbeat FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE (ends_at) ON app.season TO app_runtime;
GRANT SELECT, INSERT, UPDATE (points, joins, votes, updated_at), DELETE ON app.viewer_points TO app_runtime;
GRANT SELECT, INSERT ON app.points_batch TO app_runtime;
GRANT SELECT, DELETE ON app.points_batch TO app_definer;
CREATE POLICY definer_all ON app.points_batch TO app_definer USING (true) WITH CHECK (true);
CREATE POLICY points_batch_select ON app.points_batch FOR SELECT TO app_runtime
  USING (workspace_id = app.current_workspace_id() AND (SELECT app.role_in(app.current_workspace_id())) IS NOT NULL);
CREATE POLICY points_batch_insert ON app.points_batch FOR INSERT TO app_runtime
  WITH CHECK (
    workspace_id = app.current_workspace_id()
    AND (SELECT app.role_in(app.current_workspace_id())) IS NOT NULL
    AND EXISTS (SELECT 1 FROM app.season s WHERE s.id = season_id AND s.workspace_id = app.current_workspace_id() AND now() < s.ends_at)
  );
GRANT SELECT, DELETE ON app.viewer_points TO app_definer;
GRANT SELECT ON app.season TO app_definer;
GRANT SELECT, INSERT, UPDATE ON app.maintenance_heartbeat TO app_definer;
CREATE POLICY definer_all ON app.viewer_points TO app_definer USING (true) WITH CHECK (true);
CREATE POLICY definer_all ON app.season TO app_definer USING (true) WITH CHECK (true);
CREATE POLICY definer_all ON app.maintenance_heartbeat TO app_definer USING (true) WITH CHECK (true);

CREATE POLICY season_select ON app.season FOR SELECT TO app_runtime
  USING (workspace_id = app.current_workspace_id() AND (SELECT app.role_in(app.current_workspace_id())) IS NOT NULL);
CREATE POLICY season_insert_owner ON app.season FOR INSERT TO app_runtime
  WITH CHECK (workspace_id = app.current_workspace_id() AND (SELECT app.role_in(app.current_workspace_id())) = 'owner');
-- Only ending early: an owner may move ends_at earlier, never later.
CREATE POLICY season_end_owner ON app.season FOR UPDATE TO app_runtime
  USING (workspace_id = app.current_workspace_id() AND (SELECT app.role_in(app.current_workspace_id())) = 'owner' AND now() < ends_at)
  WITH CHECK (workspace_id = app.current_workspace_id() AND ends_at <= now() + interval '1 minute');

CREATE POLICY viewer_points_select ON app.viewer_points FOR SELECT TO app_runtime
  USING (workspace_id = app.current_workspace_id() AND (SELECT app.role_in(app.current_workspace_id())) IS NOT NULL);
-- Points are written by the live session acting as the member who started it, only into a running season.
CREATE POLICY viewer_points_insert ON app.viewer_points FOR INSERT TO app_runtime
  WITH CHECK (
    workspace_id = app.current_workspace_id()
    AND (SELECT app.role_in(app.current_workspace_id())) IS NOT NULL
    AND EXISTS (SELECT 1 FROM app.season s WHERE s.id = season_id AND s.workspace_id = app.current_workspace_id() AND now() < s.ends_at)
  );
CREATE POLICY viewer_points_update ON app.viewer_points FOR UPDATE TO app_runtime
  USING (workspace_id = app.current_workspace_id() AND (SELECT app.role_in(app.current_workspace_id())) IS NOT NULL)
  WITH CHECK (
    workspace_id = app.current_workspace_id()
    AND EXISTS (SELECT 1 FROM app.season s WHERE s.id = season_id AND s.workspace_id = app.current_workspace_id() AND now() < s.ends_at)
  );
CREATE POLICY viewer_points_delete_owner ON app.viewer_points FOR DELETE TO app_runtime
  USING (workspace_id = app.current_workspace_id() AND (SELECT app.role_in(app.current_workspace_id())) = 'owner');

-- Cron (every 6 h): ended seasons lose their viewer rows and batch markers; idle sessions and orphan members go too.
CREATE FUNCTION app.daily_maintenance() RETURNS integer
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
  DECLARE
    v_deleted integer;
  BEGIN
    DELETE FROM app.viewer_points vp USING app.season s WHERE s.id = vp.season_id AND s.ends_at <= now();
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    DELETE FROM app.points_batch pb USING app.season s WHERE s.id = pb.season_id AND s.ends_at <= now();
    PERFORM app.purge_expired(7 * 24 * 3600);
    INSERT INTO app.maintenance_heartbeat (id, ran_at) VALUES (true, now()) ON CONFLICT (id) DO UPDATE SET ran_at = now();
    RETURN v_deleted;
  END
  $$;

CREATE FUNCTION app.maintenance_last_run() RETURNS timestamptz
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$ SELECT ran_at FROM app.maintenance_heartbeat $$;

GRANT EXECUTE ON FUNCTION app.purge_expired(integer) TO app_definer;

GRANT CREATE ON SCHEMA app TO app_definer;
ALTER FUNCTION app.daily_maintenance() OWNER TO app_definer;
ALTER FUNCTION app.maintenance_last_run() OWNER TO app_definer;
REVOKE CREATE ON SCHEMA app FROM app_definer;

REVOKE ALL ON FUNCTION app.daily_maintenance(), app.maintenance_last_run() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.daily_maintenance(), app.maintenance_last_run() TO app_runtime;
