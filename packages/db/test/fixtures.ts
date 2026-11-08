import { members, withMember, withSystem, workspaces, type Database } from "../src/index";
import { loadMigrations } from "../src/migrations-fs";
import { createTestDatabase } from "../src/testing";

export interface World {
  db: Database;
  alice: string;
  bob: string;
  carol: string;
  dave: string;
  wsA: string;
  wsB: string;
}

// Synthetic people only (non-negotiable 8): alice owns A with bob as moderator; carol owns B; dave belongs nowhere.
export async function buildWorld(): Promise<World> {
  const db = await createTestDatabase(await loadMigrations());
  const person = (name: string) =>
    withSystem(db, (tx) =>
      members.upsertFromGoogle(tx, { googleSub: `sub-${name}`, email: `${name}@example.test`, displayName: name }),
    );
  const [alice, bob, carol, dave] = [await person("alice"), await person("bob"), await person("carol"), await person("dave")];
  const wsA = await withMember(db, { memberId: alice }, (tx) => workspaces.create(tx, "Kênh A"));
  const wsB = await withMember(db, { memberId: carol }, (tx) => workspaces.create(tx, "Kênh B"));
  await db.transaction((tx) =>
    tx.query("INSERT INTO app.workspace_member (workspace_id, member_id, role) VALUES ($1, $2, 'moderator')", [wsA, bob]),
  );
  return { db, alice, bob, carol, dave, wsA, wsB };
}
