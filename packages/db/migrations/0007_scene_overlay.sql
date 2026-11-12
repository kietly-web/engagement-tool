-- ET-23: one combined "scene" overlay link, and links the owner can view again (stored encrypted, not just hashed).
ALTER TABLE app.overlay_token DROP CONSTRAINT overlay_token_widget_check;
ALTER TABLE app.overlay_token ADD CONSTRAINT overlay_token_widget_check CHECK (widget IN ('poll', 'leaderboard', 'game', 'alerts', 'scene'));
ALTER TABLE app.overlay_token ADD COLUMN token_enc bytea CHECK (token_enc IS NULL OR octet_length(token_enc) BETWEEN 29 AND 512);

-- Like rotate_overlay_token, plus the encrypted token so the owner can see the link again.
CREATE FUNCTION app.set_overlay_token(p_widget text, p_token_hash text, p_token_enc text) RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
  BEGIN
    IF (SELECT app.role_in(app.current_workspace_id())) IS DISTINCT FROM 'owner' THEN
      RAISE EXCEPTION 'only the workspace owner can manage overlay links' USING ERRCODE = '42501';
    END IF;
    INSERT INTO app.overlay_token (workspace_id, widget, token_hash, token_enc)
    VALUES (app.current_workspace_id(), p_widget, decode(p_token_hash, 'hex'), decode(p_token_enc, 'hex'))
    ON CONFLICT (workspace_id, widget) DO UPDATE
      SET token_hash = excluded.token_hash, token_enc = excluded.token_enc, rotated_at = now();
  END
  $$;

-- Owner only: the encrypted token for one widget of the current workspace (decrypted by the Worker).
CREATE FUNCTION app.overlay_token_enc(p_widget text) RETURNS text
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
    SELECT encode(o.token_enc, 'hex') FROM app.overlay_token o
     WHERE o.workspace_id = app.current_workspace_id() AND o.widget = p_widget
       AND (SELECT app.role_in(app.current_workspace_id())) = 'owner'
  $$;

-- For a scene link: every widget config of that link's workspace, keyed by widget. No member context needed.
CREATE FUNCTION app.overlay_scene_configs(p_token_hash text) RETURNS jsonb
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
    SELECT coalesce(jsonb_object_agg(c.widget, c.config), '{}'::jsonb)
      FROM app.overlay_token o
      JOIN app.widget_config c ON c.workspace_id = o.workspace_id
     WHERE o.token_hash = decode(p_token_hash, 'hex') AND o.widget = 'scene'
  $$;

GRANT CREATE ON SCHEMA app TO app_definer;
ALTER FUNCTION app.set_overlay_token(text, text, text) OWNER TO app_definer;
ALTER FUNCTION app.overlay_token_enc(text) OWNER TO app_definer;
ALTER FUNCTION app.overlay_scene_configs(text) OWNER TO app_definer;
REVOKE CREATE ON SCHEMA app FROM app_definer;
REVOKE ALL ON FUNCTION app.set_overlay_token(text, text, text), app.overlay_token_enc(text), app.overlay_scene_configs(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.set_overlay_token(text, text, text), app.overlay_token_enc(text), app.overlay_scene_configs(text) TO app_runtime;
