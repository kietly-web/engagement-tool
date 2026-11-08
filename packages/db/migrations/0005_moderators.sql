CREATE TABLE app.invite (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES app.workspace (id) ON DELETE CASCADE,
  email text NOT NULL CHECK (char_length(email) BETWEEN 3 AND 320 AND email = lower(email)),
  token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  created_by uuid REFERENCES app.member (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '7 days')
);
CREATE INDEX invite_workspace_idx ON app.invite (workspace_id);

-- Who did what in a workspace; never viewer ids, chat text or tokens in detail.
CREATE TABLE app.audit_event (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES app.workspace (id) ON DELETE CASCADE,
  actor_member_id uuid REFERENCES app.member (id) ON DELETE SET NULL,
  action text NOT NULL CHECK (action IN (
    'invite_created', 'invite_revoked', 'invite_accepted', 'member_removed', 'member_left',
    'overlay_rotated', 'youtube_disconnected', 'viewer_erased', 'season_started', 'season_ended'
  )),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (octet_length(detail::text) <= 500),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_event_workspace_idx ON app.audit_event (workspace_id, created_at DESC);

ALTER TABLE app.invite ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.invite FORCE ROW LEVEL SECURITY;
ALTER TABLE app.audit_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.audit_event FORCE ROW LEVEL SECURITY;

-- Owners list and revoke pending invites; creation and acceptance go through definer functions.
GRANT SELECT (id, workspace_id, email, created_at, expires_at, accepted_at), DELETE ON app.invite TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON app.invite TO app_definer;
GRANT SELECT ON app.audit_event TO app_runtime;
GRANT SELECT, INSERT, DELETE ON app.audit_event TO app_definer;
GRANT INSERT ON app.workspace_member TO app_definer;
CREATE POLICY definer_all ON app.invite TO app_definer USING (true) WITH CHECK (true);
CREATE POLICY definer_all ON app.audit_event TO app_definer USING (true) WITH CHECK (true);

CREATE POLICY invite_select_owner ON app.invite FOR SELECT TO app_runtime
  USING (workspace_id = app.current_workspace_id() AND (SELECT app.role_in(app.current_workspace_id())) = 'owner');
CREATE POLICY invite_delete_owner ON app.invite FOR DELETE TO app_runtime
  USING (workspace_id = app.current_workspace_id() AND (SELECT app.role_in(app.current_workspace_id())) = 'owner' AND accepted_at IS NULL);
CREATE POLICY audit_select_owner ON app.audit_event FOR SELECT TO app_runtime
  USING (workspace_id = app.current_workspace_id() AND (SELECT app.role_in(app.current_workspace_id())) = 'owner');

CREATE FUNCTION app.audit(p_action text, p_detail jsonb) RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
  BEGIN
    IF (SELECT app.role_in(app.current_workspace_id())) IS NULL THEN
      RAISE EXCEPTION 'not a member of this workspace' USING ERRCODE = '42501';
    END IF;
    INSERT INTO app.audit_event (workspace_id, actor_member_id, action, detail)
    VALUES (app.current_workspace_id(), app.current_member_id(), p_action, coalesce(p_detail, '{}'::jsonb));
  END
  $$;

CREATE FUNCTION app.create_invite(p_email text, p_token_hash text) RETURNS uuid
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
  DECLARE
    v_id uuid;
  BEGIN
    IF (SELECT app.role_in(app.current_workspace_id())) IS DISTINCT FROM 'owner' THEN
      RAISE EXCEPTION 'only the workspace owner can invite' USING ERRCODE = '42501';
    END IF;
    IF (SELECT count(*) FROM app.invite i WHERE i.workspace_id = app.current_workspace_id() AND i.accepted_at IS NULL AND i.expires_at > now()) >= 20 THEN
      RAISE EXCEPTION 'too many pending invites' USING ERRCODE = '54000';
    END IF;
    INSERT INTO app.invite (workspace_id, email, token_hash, created_by, expires_at)
    VALUES (app.current_workspace_id(), lower(trim(p_email)), decode(p_token_hash, 'hex'), app.current_member_id(), now() + interval '7 days')
    RETURNING id INTO v_id;
    PERFORM app.audit('invite_created', jsonb_build_object('invite_id', v_id));
    RETURN v_id;
  END
  $$;

-- The caller's verified Google email must match; the invite is single-use and expires after 7 days.
CREATE FUNCTION app.accept_invite(p_token_hash text) RETURNS TABLE (workspace_id uuid, outcome text)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
  DECLARE
    v_member uuid := app.current_member_id();
    v_invite app.invite%ROWTYPE;
    v_email text;
  BEGIN
    IF v_member IS NULL THEN
      RAISE EXCEPTION 'no member context' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO v_invite FROM app.invite i WHERE i.token_hash = decode(p_token_hash, 'hex') FOR UPDATE;
    IF NOT FOUND OR v_invite.accepted_at IS NOT NULL OR v_invite.expires_at <= now() THEN
      RETURN QUERY SELECT NULL::uuid, 'invalid'::text;
      RETURN;
    END IF;
    SELECT lower(m.email) INTO v_email FROM app.member m WHERE m.id = v_member;
    IF v_email IS DISTINCT FROM v_invite.email THEN
      RETURN QUERY SELECT NULL::uuid, 'email_mismatch'::text;
      RETURN;
    END IF;
    IF EXISTS (SELECT 1 FROM app.workspace_member wm WHERE wm.workspace_id = v_invite.workspace_id AND wm.member_id = v_member) THEN
      RETURN QUERY SELECT v_invite.workspace_id, 'already_member'::text;
      RETURN;
    END IF;
    INSERT INTO app.workspace_member (workspace_id, member_id, role) VALUES (v_invite.workspace_id, v_member, 'moderator');
    UPDATE app.invite SET accepted_at = now() WHERE id = v_invite.id;
    INSERT INTO app.audit_event (workspace_id, actor_member_id, action, detail)
    VALUES (v_invite.workspace_id, v_member, 'invite_accepted', jsonb_build_object('invite_id', v_invite.id));
    RETURN QUERY SELECT v_invite.workspace_id, 'accepted'::text;
  END
  $$;

CREATE OR REPLACE FUNCTION app.audit_retention() RETURNS void
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
    DELETE FROM app.audit_event WHERE created_at < now() - interval '12 months';
    DELETE FROM app.invite WHERE accepted_at IS NULL AND expires_at < now() - interval '1 day';
    DELETE FROM app.invite WHERE accepted_at IS NOT NULL AND accepted_at < now() - interval '30 days';
  $$;

GRANT CREATE ON SCHEMA app TO app_definer;
ALTER FUNCTION app.audit(text, jsonb) OWNER TO app_definer;
ALTER FUNCTION app.create_invite(text, text) OWNER TO app_definer;
ALTER FUNCTION app.accept_invite(text) OWNER TO app_definer;
ALTER FUNCTION app.audit_retention() OWNER TO app_definer;
REVOKE CREATE ON SCHEMA app FROM app_definer;

REVOKE ALL ON FUNCTION app.audit(text, jsonb), app.create_invite(text, text), app.accept_invite(text), app.audit_retention() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.audit(text, jsonb), app.create_invite(text, text), app.accept_invite(text), app.audit_retention() TO app_runtime;
GRANT EXECUTE ON FUNCTION app.audit(text, jsonb), app.audit_retention() TO app_definer;
