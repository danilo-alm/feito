import type { Database } from "@sqlite.org/sqlite-wasm";
import type { SQLiteProfile } from "@feito/core/product/sqlite-batches";
import type { BrowserRecord, BrowserSummary, BrowserUpdate, LocalSpace, Space } from "../storage";

type Profile = Omit<SQLiteProfile, "local" | "remotes"> & {
  local: (NonNullable<SQLiteProfile["local"]>) | null;
  remotes: (Partial<SQLiteProfile["remotes"][number]> & Pick<SQLiteProfile["remotes"][number], "id" | "user">)[];
};

export function createProfileStorage(db: Database, queries: Record<string, string>, origin: string) {
  function read(): BrowserRecord | undefined {
    const json = db.selectValue(queries["read-profile.sql"], [0]);
    if (typeof json !== "string") return undefined;
    const profile = JSON.parse(json) as Profile;
    const { generation, epoch, spaceId, discoverSession, revokeSession } = profile.selection;
    const account = profile.remotes.find(({ id }) => id === spaceId);
    const local = profile.local ?? undefined;
    const space: Space = account ? { kind: "account", user: account.user }
      : local ? { kind: "local" } : { kind: "none" };
    const data = account?.working && account.confirmed && (account as SQLiteProfile["remotes"][number]);
    return { generation, selection: { epoch, space, discoverSession, revokeSession: revokeSession ?? undefined }, data: data || local };
  }

  function summary(): (BrowserSummary & { spaceId?: string }) | undefined {
    const row = db.selectObject(`
      SELECT selection.*, spaces.kind, spaces.account_id, spaces.account_email, replica_state.notice,
        EXISTS (SELECT 1 FROM preferences WHERE space_id = selection.space_id AND layer = 'working') AS loaded,
        (SELECT count(*) FROM pending_operations WHERE space_id = selection.space_id) AS pending
      FROM selection LEFT JOIN spaces ON spaces.id = selection.space_id
      LEFT JOIN replica_state ON replica_state.space_id = selection.space_id WHERE selection.id = 1
    `);
    if (!row) return undefined;
    const space: Space = row.kind === "local" ? { kind: "local" } : row.kind === "remote"
      ? { kind: "account", user: { id: String(row.account_id), email: String(row.account_email) } }
      : { kind: "none" };
    return {
      generation: Number(row.generation), spaceId: typeof row.space_id === "string" ? row.space_id : undefined,
      selection: {
        epoch: String(row.epoch), space, discoverSession: !!row.discover_session,
        revokeSession: typeof row.revoke_session === "string" ? row.revoke_session : undefined,
      },
      loaded: !!row.loaded, pending: Number(row.pending),
      notice: typeof row.notice === "string" ? row.notice : undefined,
    };
  }

  function save(profile: unknown) {
    db.exec({ sql: queries["save-profile.sql"], bind: [JSON.stringify(profile)] });
  }

  function localExists() {
    return db.selectValue("SELECT 1 FROM spaces WHERE id = 'local'") === 1;
  }

  return {
    read, summary,
    initialize(legacy?: SQLiteProfile) {
      db.transaction("IMMEDIATE", () => {
        if (db.selectValue("SELECT 1 FROM selection WHERE id = 1") === 1) return;
        if (legacy) db.exec({ sql: queries["import-profile.sql"], bind: [JSON.stringify(legacy)] });
        else save({ selection: { generation: 0, epoch: "", discoverSession: true } });
      });
    },
    commit(generation: number, update: BrowserUpdate) {
      return db.transaction("IMMEDIATE", () => {
        const current = db.selectObject(`
          SELECT selection.*, spaces.kind, spaces.account_id, spaces.account_email
          FROM selection LEFT JOIN spaces ON spaces.id = selection.space_id WHERE selection.id = 1
        `);
        if (!current || current.generation !== generation) return false;
        const selected = update.selection;
        const space: Space = selected?.space ?? (current.kind === "local" ? { kind: "local" }
          : current.kind === "remote" ? {
            kind: "account", user: { id: String(current.account_id), email: String(current.account_email) },
          } : { kind: "none" });
        const spaceId = space.kind === "account" ? "account:" + space.user.id
          : space.kind === "local" ? "local" : undefined;
        const workspace = space.kind === "local" && update.data ? update.data as LocalSpace
          : update.localIfMissing && !localExists() ? update.localIfMissing : undefined;
        const selection = {
          generation: generation + 1, spaceId,
          epoch: selected?.epoch ?? current.epoch,
          discoverSession: selected?.discoverSession ?? current.discover_session,
          revokeSession: selected ? selected.revokeSession : current.revoke_session,
        };
        const remotes = space.kind === "account" && (update.data || selected)
          ? [{ ...update.data, id: spaceId, origin, user: space.user }] : [];
        save({
          selection, remotes, local: workspace && { ...workspace, id: "local" },
          deleteSpace: update.deleteAccount ? "account:" + update.deleteAccount : undefined,
        });
        return true;
      });
    },
  };
}
