CREATE TABLE app.overlay_token (
  workspace_id uuid NOT NULL REFERENCES app.workspace (id) ON DELETE CASCADE,
  widget text NOT NULL CHECK (widget IN ('poll', 'leaderboard', 'game')),
  token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  created_at timestamptz NOT NULL DEFAULT now(),
  rotated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, widget)
);

ALTER TABLE app.overlay_token ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.overlay_token FORCE ROW LEVEL SECURITY;

-- Members see which widgets have a link, never the hash; writes and lookups go through definer functions.
GRANT SELECT (workspace_id, widget, created_at, rotated_at) ON app.overlay_token TO app_runtime;
GRANT SELECT, INSERT, UPDATE ON app.overlay_token TO app_definer;
CREATE POLICY definer_all ON app.overlay_token TO app_definer USING (true) WITH CHECK (true);
CREATE POLICY overlay_token_select ON app.overlay_token FOR SELECT TO app_runtime
  USING (workspace_id = app.current_workspace_id() AND (SELECT app.role_in(app.current_workspace_id())) IS NOT NULL);

CREATE FUNCTION app.rotate_overlay_token(p_widget text, p_token_hash text) RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
  BEGIN
    IF (SELECT app.role_in(app.current_workspace_id())) IS DISTINCT FROM 'owner' THEN
      RAISE EXCEPTION 'only the workspace owner can manage overlay links' USING ERRCODE = '42501';
    END IF;
    INSERT INTO app.overlay_token (workspace_id, widget, token_hash)
    VALUES (app.current_workspace_id(), p_widget, decode(p_token_hash, 'hex'))
    ON CONFLICT (workspace_id, widget) DO UPDATE SET token_hash = excluded.token_hash, rotated_at = now();
  END
  $$;

-- Called without any member context: an overlay URL is a bearer secret for one widget of one workspace.
CREATE FUNCTION app.overlay_lookup(p_token_hash text) RETURNS TABLE (workspace_id uuid, widget text)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$ SELECT o.workspace_id, o.widget FROM app.overlay_token o WHERE o.token_hash = decode(p_token_hash, 'hex') $$;

GRANT CREATE ON SCHEMA app TO app_definer;
ALTER FUNCTION app.rotate_overlay_token(text, text) OWNER TO app_definer;
ALTER FUNCTION app.overlay_lookup(text) OWNER TO app_definer;
REVOKE CREATE ON SCHEMA app FROM app_definer;

REVOKE ALL ON FUNCTION app.rotate_overlay_token(text, text), app.overlay_lookup(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.rotate_overlay_token(text, text), app.overlay_lookup(text) TO app_runtime;
