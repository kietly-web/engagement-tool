CREATE TABLE app.session (
  token_hash bytea PRIMARY KEY CHECK (octet_length(token_hash) = 32),
  member_id uuid NOT NULL REFERENCES app.member (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX session_member_idx ON app.session (member_id);
CREATE INDEX session_expires_idx ON app.session (expires_at);

CREATE TABLE app.youtube_connection (
  workspace_id uuid PRIMARY KEY REFERENCES app.workspace (id) ON DELETE CASCADE,
  channel_id text NOT NULL UNIQUE CHECK (channel_id ~ '^UC[A-Za-z0-9_-]{22}$'),
  channel_title text NOT NULL CHECK (char_length(channel_title) BETWEEN 1 AND 200),
  refresh_token_enc bytea NOT NULL CHECK (octet_length(refresh_token_enc) BETWEEN 29 AND 4096),
  scopes text NOT NULL CHECK (char_length(scopes) <= 2000),
  connected_at timestamptz NOT NULL DEFAULT now(),
  refreshed_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE app.session ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.session FORCE ROW LEVEL SECURITY;
ALTER TABLE app.youtube_connection ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.youtube_connection FORCE ROW LEVEL SECURITY;

-- Sessions are reachable only through the definer functions below; app_runtime has no grant at all.
GRANT SELECT, INSERT, UPDATE, DELETE ON app.session TO app_definer;
CREATE POLICY definer_all ON app.session TO app_definer USING (true) WITH CHECK (true);

-- The token ciphertext is readable only through app.youtube_refresh_token().
GRANT SELECT (workspace_id, channel_id, channel_title, scopes, connected_at, refreshed_at), DELETE
  ON app.youtube_connection TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON app.youtube_connection TO app_definer;
GRANT DELETE ON app.workspace TO app_definer;
GRANT DELETE ON app.member TO app_definer;
GRANT SELECT ON app.workspace_member TO app_definer;
CREATE POLICY definer_all ON app.youtube_connection TO app_definer USING (true) WITH CHECK (true);

CREATE POLICY youtube_connection_select ON app.youtube_connection FOR SELECT TO app_runtime
  USING (workspace_id = app.current_workspace_id() AND (SELECT app.role_in(app.current_workspace_id())) IS NOT NULL);
CREATE POLICY youtube_connection_delete_owner ON app.youtube_connection FOR DELETE TO app_runtime
  USING (workspace_id = app.current_workspace_id() AND (SELECT app.role_in(app.current_workspace_id())) = 'owner');

CREATE FUNCTION app.create_session(p_member uuid, p_token_hash text, p_ttl_seconds integer) RETURNS void
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
    INSERT INTO app.session (token_hash, member_id, expires_at)
    VALUES (decode(p_token_hash, 'hex'), p_member, now() + make_interval(secs => p_ttl_seconds));
  $$;

CREATE FUNCTION app.session_member(p_token_hash text, p_idle_seconds integer) RETURNS uuid
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
  DECLARE
    v_member uuid;
    v_last_seen timestamptz;
  BEGIN
    SELECT s.member_id, s.last_seen_at INTO v_member, v_last_seen
      FROM app.session s
     WHERE s.token_hash = decode(p_token_hash, 'hex')
       AND s.expires_at > now()
       AND s.last_seen_at > now() - make_interval(secs => p_idle_seconds);
    -- Sliding expiry, written at most every 5 minutes to spare database compute.
    IF v_member IS NOT NULL AND v_last_seen < now() - interval '5 minutes' THEN
      UPDATE app.session SET last_seen_at = now() WHERE token_hash = decode(p_token_hash, 'hex');
    END IF;
    RETURN v_member;
  END
  $$;

CREATE FUNCTION app.delete_session(p_token_hash text) RETURNS void
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$ DELETE FROM app.session WHERE token_hash = decode(p_token_hash, 'hex') $$;

CREATE FUNCTION app.save_youtube_connection(p_channel_id text, p_channel_title text, p_token_enc text, p_scopes text) RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
  BEGIN
    IF (SELECT app.role_in(app.current_workspace_id())) IS DISTINCT FROM 'owner' THEN
      RAISE EXCEPTION 'only the workspace owner can connect YouTube' USING ERRCODE = '42501';
    END IF;
    INSERT INTO app.youtube_connection (workspace_id, channel_id, channel_title, refresh_token_enc, scopes)
    VALUES (app.current_workspace_id(), p_channel_id, p_channel_title, decode(p_token_enc, 'hex'), p_scopes)
    ON CONFLICT (workspace_id) DO UPDATE
      SET channel_id = excluded.channel_id, channel_title = excluded.channel_title,
          refresh_token_enc = excluded.refresh_token_enc, scopes = excluded.scopes, refreshed_at = now();
  END
  $$;

CREATE FUNCTION app.youtube_refresh_token() RETURNS text
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
    SELECT encode(yc.refresh_token_enc, 'hex') FROM app.youtube_connection yc
     WHERE yc.workspace_id = app.current_workspace_id()
       AND (SELECT app.role_in(app.current_workspace_id())) IS NOT NULL
  $$;

CREATE FUNCTION app.my_sessions() RETURNS TABLE (created_at timestamptz, last_seen_at timestamptz, expires_at timestamptz)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$ SELECT s.created_at, s.last_seen_at, s.expires_at FROM app.session s WHERE s.member_id = app.current_member_id() ORDER BY s.created_at $$;

-- Idle sessions die at their absolute expiry at the latest; people who never joined a workspace go after 30 days.
CREATE FUNCTION app.purge_expired(p_idle_seconds integer) RETURNS void
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
    DELETE FROM app.session s
     WHERE s.expires_at <= now() OR s.last_seen_at <= now() - make_interval(secs => p_idle_seconds);
    DELETE FROM app.member m
     WHERE m.updated_at <= now() - interval '30 days'
       AND NOT EXISTS (SELECT 1 FROM app.workspace_member wm WHERE wm.member_id = m.id)
       AND NOT EXISTS (SELECT 1 FROM app.session s WHERE s.member_id = m.id);
  $$;

-- Deletes the caller's owned workspaces (cascading their YouTube data and memberships), then the caller.
CREATE FUNCTION app.delete_my_account() RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
  DECLARE
    v_member uuid := app.current_member_id();
  BEGIN
    IF v_member IS NULL THEN
      RAISE EXCEPTION 'no member context' USING ERRCODE = '42501';
    END IF;
    DELETE FROM app.workspace w
     WHERE w.id IN (SELECT wm.workspace_id FROM app.workspace_member wm WHERE wm.member_id = v_member AND wm.role = 'owner');
    DELETE FROM app.member m WHERE m.id = v_member;
  END
  $$;

GRANT CREATE ON SCHEMA app TO app_definer;
ALTER FUNCTION app.create_session(uuid, text, integer) OWNER TO app_definer;
ALTER FUNCTION app.session_member(text, integer) OWNER TO app_definer;
ALTER FUNCTION app.delete_session(text) OWNER TO app_definer;
ALTER FUNCTION app.save_youtube_connection(text, text, text, text) OWNER TO app_definer;
ALTER FUNCTION app.youtube_refresh_token() OWNER TO app_definer;
ALTER FUNCTION app.delete_my_account() OWNER TO app_definer;
ALTER FUNCTION app.my_sessions() OWNER TO app_definer;
ALTER FUNCTION app.purge_expired(integer) OWNER TO app_definer;
REVOKE CREATE ON SCHEMA app FROM app_definer;

REVOKE ALL ON FUNCTION app.create_session(uuid, text, integer), app.session_member(text, integer), app.delete_session(text),
  app.save_youtube_connection(text, text, text, text), app.youtube_refresh_token(), app.delete_my_account(),
  app.my_sessions(), app.purge_expired(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.create_session(uuid, text, integer), app.session_member(text, integer), app.delete_session(text),
  app.save_youtube_connection(text, text, text, text), app.youtube_refresh_token(), app.delete_my_account(),
  app.my_sessions(), app.purge_expired(integer) TO app_runtime;
