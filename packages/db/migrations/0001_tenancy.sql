-- Roles are cluster-wide, so create them only if missing.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    CREATE ROLE app_runtime NOLOGIN NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_definer') THEN
    CREATE ROLE app_definer NOLOGIN NOBYPASSRLS;
  END IF;
END
$$;

-- ALTER ... OWNER TO app_definer needs the migrating role to be able to SET ROLE to it.
GRANT app_definer TO CURRENT_USER;

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

ALTER FUNCTION app.role_in(uuid) OWNER TO app_definer;
ALTER FUNCTION app.upsert_member(text, text, text) OWNER TO app_definer;
ALTER FUNCTION app.create_workspace(text) OWNER TO app_definer;

REVOKE ALL ON FUNCTION app.current_member_id(), app.current_workspace_id(), app.role_in(uuid),
  app.upsert_member(text, text, text), app.create_workspace(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.current_member_id(), app.current_workspace_id(), app.role_in(uuid),
  app.upsert_member(text, text, text), app.create_workspace(text) TO app_runtime;
GRANT EXECUTE ON FUNCTION app.current_member_id() TO app_definer;

ALTER TABLE app.member ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.member FORCE ROW LEVEL SECURITY;
ALTER TABLE app.workspace ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.workspace FORCE ROW LEVEL SECURITY;
ALTER TABLE app.workspace_member ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.workspace_member FORCE ROW LEVEL SECURITY;

GRANT SELECT, UPDATE (display_name, updated_at) ON app.member TO app_runtime;
GRANT SELECT, UPDATE (name) ON app.workspace TO app_runtime;
GRANT SELECT, INSERT, DELETE ON app.workspace_member TO app_runtime;

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
      app.role_in(app.current_workspace_id()) IS NOT NULL
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
  USING (app.role_in(id) IS NOT NULL);
CREATE POLICY workspace_update_owner ON app.workspace FOR UPDATE TO app_runtime
  USING (id = app.current_workspace_id() AND app.role_in(id) = 'owner')
  WITH CHECK (id = app.current_workspace_id() AND app.role_in(id) = 'owner');

CREATE POLICY workspace_member_select ON app.workspace_member FOR SELECT TO app_runtime
  USING (
    member_id = app.current_member_id()
    OR (workspace_id = app.current_workspace_id() AND app.role_in(workspace_id) IS NOT NULL)
  );
CREATE POLICY workspace_member_insert_owner ON app.workspace_member FOR INSERT TO app_runtime
  WITH CHECK (
    workspace_id = app.current_workspace_id()
    AND app.role_in(workspace_id) = 'owner'
    AND role = 'moderator'
  );
CREATE POLICY workspace_member_delete ON app.workspace_member FOR DELETE TO app_runtime
  USING (
    role = 'moderator'
    AND workspace_id = app.current_workspace_id()
    AND (app.role_in(workspace_id) = 'owner' OR member_id = app.current_member_id())
  );
