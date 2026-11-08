export type MemberRole = "owner" | "moderator";

export interface WorkspaceContext {
  workspaceId: string;
  role: MemberRole;
}
