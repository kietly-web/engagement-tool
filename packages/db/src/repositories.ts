import type { MemberRole } from "./context";
import type { Queryable } from "./database";

export interface GoogleProfile {
  googleSub: string;
  email: string;
  displayName: string;
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  role: MemberRole;
}

export interface WorkspaceMemberView {
  memberId: string;
  email: string;
  displayName: string;
  role: MemberRole;
}

export const members = {
  async upsertFromGoogle(tx: Queryable, profile: GoogleProfile): Promise<string> {
    const { rows } = await tx.query<{ id: string }>("SELECT app.upsert_member($1, $2, $3) AS id", [
      profile.googleSub,
      profile.email,
      profile.displayName,
    ]);
    return rows[0]!.id;
  },
};

export const workspaces = {
  async create(tx: Queryable, name: string): Promise<string> {
    const { rows } = await tx.query<{ id: string }>("SELECT app.create_workspace($1) AS id", [name]);
    return rows[0]!.id;
  },

  async listMine(tx: Queryable): Promise<WorkspaceSummary[]> {
    const { rows } = await tx.query<WorkspaceSummary>(
      `SELECT w.id, w.name, wm.role
         FROM app.workspace w
         JOIN app.workspace_member wm ON wm.workspace_id = w.id AND wm.member_id = app.current_member_id()
        ORDER BY w.created_at`,
    );
    return rows;
  },

  async current(tx: Queryable): Promise<WorkspaceSummary | null> {
    const { rows } = await tx.query<WorkspaceSummary>(
      "SELECT id, name, app.role_in(id) AS role FROM app.workspace WHERE id = app.current_workspace_id()",
    );
    return rows[0] ?? null;
  },

  async rename(tx: Queryable, name: string): Promise<boolean> {
    const { rows } = await tx.query<{ id: string }>(
      "UPDATE app.workspace SET name = $1 WHERE id = app.current_workspace_id() RETURNING id",
      [name],
    );
    return rows.length === 1;
  },

  async listMembers(tx: Queryable): Promise<WorkspaceMemberView[]> {
    const { rows } = await tx.query<WorkspaceMemberView>(
      `SELECT m.id AS "memberId", m.email, m.display_name AS "displayName", wm.role
         FROM app.workspace_member wm
         JOIN app.member m ON m.id = wm.member_id
        WHERE wm.workspace_id = app.current_workspace_id()
        ORDER BY wm.role, m.display_name`,
    );
    return rows;
  },
};
