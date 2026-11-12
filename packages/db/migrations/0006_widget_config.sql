-- One shared per-widget config (theme now, alert commands later), so new features add keys, not tables.
CREATE TABLE app.widget_config (
  workspace_id uuid NOT NULL REFERENCES app.workspace (id) ON DELETE CASCADE,
  widget text NOT NULL CHECK (widget IN ('poll', 'leaderboard', 'game', 'alerts')),
  config jsonb NOT NULL CHECK (jsonb_typeof(config) = 'object' AND octet_length(config::text) <= 8192),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, widget)
);

ALTER TABLE app.widget_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.widget_config FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE (config, updated_at) ON app.widget_config TO app_runtime;
GRANT SELECT ON app.widget_config TO app_definer;
CREATE POLICY definer_all ON app.widget_config TO app_definer USING (true) WITH CHECK (true);
CREATE POLICY widget_config_select ON app.widget_config FOR SELECT TO app_runtime
  USING (workspace_id = app.current_workspace_id() AND (SELECT app.role_in(app.current_workspace_id())) IS NOT NULL);
CREATE POLICY widget_config_insert_owner ON app.widget_config FOR INSERT TO app_runtime
  WITH CHECK (workspace_id = app.current_workspace_id() AND (SELECT app.role_in(app.current_workspace_id())) = 'owner');
CREATE POLICY widget_config_update_owner ON app.widget_config FOR UPDATE TO app_runtime
  USING (workspace_id = app.current_workspace_id() AND (SELECT app.role_in(app.current_workspace_id())) = 'owner')
  WITH CHECK (workspace_id = app.current_workspace_id() AND (SELECT app.role_in(app.current_workspace_id())) = 'owner');

ALTER TABLE app.overlay_token DROP CONSTRAINT overlay_token_widget_check;
ALTER TABLE app.overlay_token ADD CONSTRAINT overlay_token_widget_check CHECK (widget IN ('poll', 'leaderboard', 'game', 'alerts'));

-- Resolves an overlay link to its workspace, widget and saved config in one call, without member context.
CREATE FUNCTION app.overlay_resolve(p_token_hash text) RETURNS TABLE (workspace_id uuid, widget text, config jsonb)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
    SELECT o.workspace_id, o.widget, coalesce(c.config, '{}'::jsonb)
      FROM app.overlay_token o
      LEFT JOIN app.widget_config c ON c.workspace_id = o.workspace_id AND c.widget = o.widget
     WHERE o.token_hash = decode(p_token_hash, 'hex')
  $$;

GRANT CREATE ON SCHEMA app TO app_definer;
ALTER FUNCTION app.overlay_resolve(text) OWNER TO app_definer;
REVOKE CREATE ON SCHEMA app FROM app_definer;
REVOKE ALL ON FUNCTION app.overlay_resolve(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.overlay_resolve(text) TO app_runtime;
