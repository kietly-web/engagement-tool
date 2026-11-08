-- Roles are cluster-wide, so create them only if missing, and refuse a pre-existing one with dangerous attributes.
DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['app_runtime', 'app_definer'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('CREATE ROLE %I NOLOGIN NOBYPASSRLS', r);
    ELSIF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r AND (rolbypassrls OR rolsuper OR rolcanlogin)) THEN
      RAISE EXCEPTION 'role % exists with BYPASSRLS, SUPERUSER or LOGIN', r;
    END IF;
  END LOOP;
END
$$;

-- ALTER ... OWNER TO app_definer needs SET on it; INHERIT FALSE keeps the owner out of the definer_all policies.
GRANT app_definer TO CURRENT_USER WITH INHERIT FALSE;

CREATE SCHEMA app;
REVOKE ALL ON SCHEMA app FROM PUBLIC;
GRANT USAGE ON SCHEMA app TO app_runtime, app_definer;

CREATE TABLE app.member (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  google_sub text NOT NULL UNIQUE CHECK (char_length(google_sub) BETWEEN 1 AND 255),
  email text NOT NULL CHECK (char_length(email) BETWEEN 3 AND 320),
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.workspace (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.workspace_member (
  workspace_id uuid NOT NULL REFERENCES app.workspace (id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES app.member (id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner', 'moderator')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, member_id)
);

CREATE INDEX workspace_member_member_idx ON app.workspace_member (member_id);
CREATE UNIQUE INDEX workspace_member_one_owned_idx ON app.workspace_member (member_id) WHERE role = 'owner';

CREATE FUNCTION app.current_member_id() RETURNS uuid
  LANGUAGE sql STABLE
  SET search_path = pg_catalog
  AS $$ SELECT nullif(current_setting('app.member_id', true), '')::uuid $$;

CREATE FUNCTION app.current_workspace_id() RETURNS uuid
  LANGUAGE sql STABLE
  SET search_path = pg_catalog
  AS $$ SELECT nullif(current_setting('app.workspace_id', true), '')::uuid $$;

-- SECURITY DEFINER so policies can read memberships without recursing into workspace_member's own policies.
CREATE FUNCTION app.role_in(ws uuid) RETURNS text
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
    SELECT wm.role FROM app.workspace_member wm
    WHERE wm.workspace_id = ws AND wm.member_id = app.current_member_id()
  $$;

CREATE FUNCTION app.upsert_member(p_google_sub text, p_email text, p_display_name text) RETURNS uuid
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
    INSERT INTO app.member (google_sub, email, display_name)
    VALUES (p_google_sub, p_email, p_display_name)
    ON CONFLICT (google_sub) DO UPDATE
      SET email = excluded.email, display_name = excluded.display_name, updated_at = now()
    RETURNING id
  $$;

CREATE FUNCTION app.create_workspace(p_name text) RETURNS uuid
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
  DECLARE
    v_member uuid := app.current_member_id();
    v_workspace uuid;
  BEGIN
    IF v_member IS NULL THEN
      RAISE EXCEPTION 'no member context' USING ERRCODE = '42501';
    END IF;
    INSERT INTO app.workspace (name) VALUES (p_name) RETURNING id INTO v_workspace;
    INSERT INTO app.workspace_member (workspace_id, member_id, role) VALUES (v_workspace, v_member, 'owner');
    RETURN v_workspace;
  END
  $$;

CREATE FUNCTION app.me() RETURNS TABLE (id uuid, email text, display_name text)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$ SELECT m.id, m.email, m.display_name FROM app.member m WHERE m.id = app.current_member_id() $$;

-- Emails go only to the workspace owner and to each person for their own row (data minimisation).
CREATE FUNCTION app.workspace_members() RETURNS TABLE (member_id uuid, display_name text, role text, email text)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
    SELECT m.id, m.display_name, wm.role,
           CASE WHEN app.role_in(wm.workspace_id) = 'owner' OR m.id = app.current_member_id() THEN m.email END
      FROM app.workspace_member wm
      JOIN app.member m ON m.id = wm.member_id
     WHERE wm.workspace_id = app.current_workspace_id()
       AND app.role_in(wm.workspace_id) IS NOT NULL
  $$;

-- A new function owner needs CREATE on the schema, but only for the ALTERs below.
GRANT CREATE ON SCHEMA app TO app_definer;
ALTER FUNCTION app.role_in(uuid) OWNER TO app_definer;
ALTER FUNCTION app.upsert_member(text, text, text) OWNER TO app_definer;
ALTER FUNCTION app.create_workspace(text) OWNER TO app_definer;
ALTER FUNCTION app.me() OWNER TO app_definer;
ALTER FUNCTION app.workspace_members() OWNER TO app_definer;
REVOKE CREATE ON SCHEMA app FROM app_definer;

REVOKE ALL ON FUNCTION app.current_member_id(), app.current_workspace_id(), app.role_in(uuid),
  app.upsert_member(text, text, text), app.create_workspace(text), app.me(), app.workspace_members() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.current_member_id(), app.current_workspace_id(), app.role_in(uuid),
  app.upsert_member(text, text, text), app.create_workspace(text), app.me(), app.workspace_members() TO app_runtime;
GRANT EXECUTE ON FUNCTION app.current_member_id(), app.current_workspace_id(), app.role_in(uuid) TO app_definer;

ALTER TABLE app.member ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.member FORCE ROW LEVEL SECURITY;
ALTER TABLE app.workspace ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.workspace FORCE ROW LEVEL SECURITY;
ALTER TABLE app.workspace_member ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.workspace_member FORCE ROW LEVEL SECURITY;

-- No email or google_sub for the runtime role: read them through app.me() / app.workspace_members().
GRANT SELECT (id, display_name, created_at, updated_at), UPDATE (display_name, updated_at) ON app.member TO app_runtime;
GRANT SELECT, UPDATE (name) ON app.workspace TO app_runtime;
-- No INSERT: moderators join through an invite-acceptance definer function (ET-9), never by an owner's say-so.
GRANT SELECT, DELETE ON app.workspace_member TO app_runtime;

GRANT SELECT, INSERT, UPDATE ON app.member TO app_definer;
GRANT SELECT, INSERT ON app.workspace TO app_definer;
GRANT SELECT, INSERT ON app.workspace_member TO app_definer;

CREATE POLICY definer_all ON app.member TO app_definer USING (true) WITH CHECK (true);
CREATE POLICY definer_all ON app.workspace TO app_definer USING (true) WITH CHECK (true);
CREATE POLICY definer_all ON app.workspace_member TO app_definer USING (true) WITH CHECK (true);

CREATE POLICY member_select ON app.member FOR SELECT TO app_runtime
  USING (
    id = app.current_member_id()
    OR (
      (SELECT app.role_in(app.current_workspace_id())) IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM app.workspace_member wm
        WHERE wm.workspace_id = app.current_workspace_id() AND wm.member_id = member.id
      )
    )
  );
CREATE POLICY member_update_self ON app.member FOR UPDATE TO app_runtime
  USING (id = app.current_member_id())
  WITH CHECK (id = app.current_member_id());

CREATE POLICY workspace_select ON app.workspace FOR SELECT TO app_runtime
  USING (id IN (SELECT wm.workspace_id FROM app.workspace_member wm WHERE wm.member_id = app.current_member_id()));
CREATE POLICY workspace_update_owner ON app.workspace FOR UPDATE TO app_runtime
  USING (id = app.current_workspace_id() AND (SELECT app.role_in(app.current_workspace_id())) = 'owner')
  WITH CHECK (id = app.current_workspace_id() AND (SELECT app.role_in(app.current_workspace_id())) = 'owner');

CREATE POLICY workspace_member_select ON app.workspace_member FOR SELECT TO app_runtime
  USING (
    member_id = app.current_member_id()
    OR (workspace_id = app.current_workspace_id() AND (SELECT app.role_in(app.current_workspace_id())) IS NOT NULL)
  );
CREATE POLICY workspace_member_delete ON app.workspace_member FOR DELETE TO app_runtime
  USING (
    role = 'moderator'
    AND workspace_id = app.current_workspace_id()
    AND ((SELECT app.role_in(app.current_workspace_id())) = 'owner' OR member_id = app.current_member_id())
  );
