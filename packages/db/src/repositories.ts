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
  email: string | null;
  displayName: string;
  role: MemberRole;
}

export interface MemberProfile {
  id: string;
  email: string;
  displayName: string;
}

export interface YoutubeConnection {
  channelId: string;
  channelTitle: string;
  scopes: string;
  connectedAt: string;
}

export const members = {
  async deleteMyAccount(tx: Queryable): Promise<void> {
    await tx.query("SELECT app.delete_my_account()");
  },

  async me(tx: Queryable): Promise<MemberProfile | null> {
    const { rows } = await tx.query<MemberProfile>('SELECT id, email, display_name AS "displayName" FROM app.me()');
    return rows[0] ?? null;
  },

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

  async listMineWithDates(tx: Queryable): Promise<(WorkspaceSummary & { joinedAt: string })[]> {
    const { rows } = await tx.query<WorkspaceSummary & { joinedAt: string }>(
      `SELECT w.id, w.name, wm.role, wm.created_at::text AS "joinedAt"
         FROM app.workspace w
         JOIN app.workspace_member wm ON wm.workspace_id = w.id AND wm.member_id = app.current_member_id()
        ORDER BY w.created_at`,
    );
    return rows;
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
      `SELECT member_id AS "memberId", email, display_name AS "displayName", role
         FROM app.workspace_members()
        ORDER BY role, display_name`,
    );
    return rows;
  },
};

export const sessions = {
  async create(tx: Queryable, memberId: string, tokenHashHex: string, ttlSeconds: number): Promise<void> {
    await tx.query("SELECT app.create_session($1, $2, $3)", [memberId, tokenHashHex, ttlSeconds]);
  },

  async memberFor(tx: Queryable, tokenHashHex: string, idleSeconds: number): Promise<string | null> {
    const { rows } = await tx.query<{ id: string | null }>("SELECT app.session_member($1, $2) AS id", [tokenHashHex, idleSeconds]);
    return rows[0]?.id ?? null;
  },

  async delete(tx: Queryable, tokenHashHex: string): Promise<void> {
    await tx.query("SELECT app.delete_session($1)", [tokenHashHex]);
  },

  async purgeExpired(tx: Queryable, idleSeconds: number): Promise<void> {
    await tx.query("SELECT app.purge_expired($1)", [idleSeconds]);
  },

  async mine(tx: Queryable): Promise<{ createdAt: string; lastSeenAt: string; expiresAt: string }[]> {
    const { rows } = await tx.query<{ createdAt: string; lastSeenAt: string; expiresAt: string }>(
      'SELECT created_at::text AS "createdAt", last_seen_at::text AS "lastSeenAt", expires_at::text AS "expiresAt" FROM app.my_sessions()',
    );
    return rows;
  },
};

export const youtube = {
  async save(tx: Queryable, c: { channelId: string; channelTitle: string; tokenCiphertextHex: string; scopes: string }): Promise<void> {
    await tx.query("SELECT app.save_youtube_connection($1, $2, $3, $4)", [c.channelId, c.channelTitle, c.tokenCiphertextHex, c.scopes]);
  },

  async current(tx: Queryable): Promise<YoutubeConnection | null> {
    const { rows } = await tx.query<YoutubeConnection>(
      `SELECT channel_id AS "channelId", channel_title AS "channelTitle", scopes, connected_at::text AS "connectedAt"
         FROM app.youtube_connection WHERE workspace_id = app.current_workspace_id()`,
    );
    return rows[0] ?? null;
  },

  async refreshTokenCiphertext(tx: Queryable): Promise<string | null> {
    const { rows } = await tx.query<{ hex: string | null }>("SELECT app.youtube_refresh_token() AS hex");
    return rows[0]?.hex ?? null;
  },

  async disconnect(tx: Queryable): Promise<boolean> {
    const { rows } = await tx.query("DELETE FROM app.youtube_connection WHERE workspace_id = app.current_workspace_id() RETURNING workspace_id");
    return rows.length === 1;
  },
};

export type OverlayWidget = "poll" | "leaderboard" | "game";

export const overlays = {
  async rotate(tx: Queryable, widget: OverlayWidget, tokenHashHex: string): Promise<void> {
    await tx.query("SELECT app.rotate_overlay_token($1, $2)", [widget, tokenHashHex]);
  },

  async list(tx: Queryable): Promise<{ widget: OverlayWidget; rotatedAt: string }[]> {
    const { rows } = await tx.query<{ widget: OverlayWidget; rotatedAt: string }>(
      `SELECT widget, rotated_at::text AS "rotatedAt" FROM app.overlay_token WHERE workspace_id = app.current_workspace_id() ORDER BY widget`,
    );
    return rows;
  },

  async lookup(tx: Queryable, tokenHashHex: string): Promise<{ workspaceId: string; widget: OverlayWidget } | null> {
    const { rows } = await tx.query<{ workspaceId: string; widget: OverlayWidget }>(
      'SELECT workspace_id AS "workspaceId", widget FROM app.overlay_lookup($1)',
      [tokenHashHex],
    );
    return rows[0] ?? null;
  },
};
