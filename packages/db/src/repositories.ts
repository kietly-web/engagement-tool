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

export interface Season {
  id: string;
  name: string;
  startsAt: string;
  endsAt: string;
}

export interface ViewerPoints {
  channelId: string;
  points: number;
  joins: number;
  votes: number;
}

const SEASON_COLUMNS = 'id, name, starts_at::text AS "startsAt", ends_at::text AS "endsAt"';

export const seasons = {
  async active(tx: Queryable): Promise<Season | null> {
    const { rows } = await tx.query<Season>(
      `SELECT ${SEASON_COLUMNS} FROM app.season
        WHERE workspace_id = app.current_workspace_id() AND starts_at <= now() AND now() < ends_at
        ORDER BY starts_at DESC LIMIT 1`,
    );
    return rows[0] ?? null;
  },

  async recent(tx: Queryable, limit = 10): Promise<Season[]> {
    const { rows } = await tx.query<Season>(
      `SELECT ${SEASON_COLUMNS} FROM app.season WHERE workspace_id = app.current_workspace_id() ORDER BY starts_at DESC LIMIT $1`,
      [limit],
    );
    return rows;
  },

  // Starts at the database's now(), so app and database clocks can't disagree about whether it's running.
  // Returns null when a season is still running; the lock stops two concurrent creates from overlapping.
  async create(tx: Queryable, name: string, days: number): Promise<Season | null> {
    await tx.query("SELECT pg_advisory_xact_lock(hashtext('season:' || app.current_workspace_id()::text))");
    const { rows } = await tx.query<Season>(
      `INSERT INTO app.season (workspace_id, name, starts_at, ends_at)
       SELECT app.current_workspace_id(), $1, now(), now() + make_interval(days => $2)
        WHERE NOT EXISTS (SELECT 1 FROM app.season WHERE workspace_id = app.current_workspace_id() AND ends_at > now())
       RETURNING ${SEASON_COLUMNS}`,
      [name, days],
    );
    return rows[0] ?? null;
  },

  async endActive(tx: Queryable): Promise<boolean> {
    const { rows } = await tx.query(
      "UPDATE app.season SET ends_at = now() WHERE workspace_id = app.current_workspace_id() AND starts_at <= now() AND now() < ends_at RETURNING id",
    );
    return rows.length > 0;
  },
};

export const points = {
  // Applies a batch at most once: a retry with the same batch id is a no-op, so retries can't double-count.
  async flush(
    tx: Queryable,
    seasonId: string,
    batchId: string,
    deltas: [string, { points: number; joins: number; votes: number }][],
  ): Promise<{ applied: boolean; rows: number }> {
    const marker = await tx.query(
      `INSERT INTO app.points_batch (batch_id, season_id, workspace_id) VALUES ($1, $2, app.current_workspace_id())
       ON CONFLICT (batch_id) DO NOTHING RETURNING batch_id`,
      [batchId, seasonId],
    );
    if (marker.rows.length === 0) return { applied: false, rows: 0 };
    if (deltas.length === 0) return { applied: true, rows: 0 };
    const payload = JSON.stringify(deltas.map(([channel_id, d]) => ({ channel_id, ...d })));
    const { rows } = await tx.query(
      `INSERT INTO app.viewer_points (season_id, workspace_id, channel_id, points, joins, votes)
       SELECT $1, app.current_workspace_id(), r.channel_id, r.points, r.joins, r.votes
         FROM jsonb_to_recordset($2::jsonb) AS r(channel_id text, points integer, joins integer, votes integer)
       ON CONFLICT (season_id, channel_id) DO UPDATE
         SET points = app.viewer_points.points + excluded.points,
             joins = app.viewer_points.joins + excluded.joins,
             votes = app.viewer_points.votes + excluded.votes,
             updated_at = now()
       RETURNING channel_id`,
      [seasonId, payload],
    );
    return { applied: true, rows: rows.length };
  },

  async top(tx: Queryable, seasonId: string, limit: number): Promise<ViewerPoints[]> {
    const { rows } = await tx.query<ViewerPoints>(
      `SELECT channel_id AS "channelId", points, joins, votes FROM app.viewer_points
        WHERE season_id = $1 AND workspace_id = app.current_workspace_id()
        ORDER BY points DESC, updated_at ASC LIMIT $2`,
      [seasonId, limit],
    );
    return rows;
  },

  async eraseViewer(tx: Queryable, channelId: string): Promise<number> {
    const { rows } = await tx.query("DELETE FROM app.viewer_points WHERE workspace_id = app.current_workspace_id() AND channel_id = $1 RETURNING season_id", [
      channelId,
    ]);
    return rows.length;
  },
};

export const maintenance = {
  async run(tx: Queryable): Promise<number> {
    const { rows } = await tx.query<{ n: number }>("SELECT app.daily_maintenance() AS n");
    return rows[0]!.n;
  },

  async lastRun(tx: Queryable): Promise<string | null> {
    const { rows } = await tx.query<{ t: string | null }>("SELECT app.maintenance_last_run()::text AS t");
    return rows[0]?.t ?? null;
  },
};
