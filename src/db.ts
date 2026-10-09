import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ScriptStatus } from "./domain.ts";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS script (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  creator_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('awaiting_review','changes_requested','approved')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS script_version (
  script_id TEXT NOT NULL REFERENCES script(id),
  number INTEGER NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (script_id, number)
);

CREATE TABLE IF NOT EXISTS change_request (
  id TEXT PRIMARY KEY,
  script_id TEXT NOT NULL REFERENCES script(id),
  version_number INTEGER NOT NULL,
  reason TEXT NOT NULL,
  due_date TEXT NOT NULL,
  created_at TEXT NOT NULL,
  resolved_by_version INTEGER
);

-- no máximo um pedido aberto por roteiro, garantido também pelo banco
CREATE UNIQUE INDEX IF NOT EXISTS one_open_request_per_script
  ON change_request(script_id) WHERE resolved_by_version IS NULL;
`;

export function openDatabase(path = process.env.DB_PATH ?? ":memory:"): DatabaseSync {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(SCHEMA);
  return db;
}

export interface ScriptRow {
  id: string;
  campaign_id: string;
  creator_id: string;
  status: ScriptStatus;
  created_at: string;
}
export interface VersionRow {
  number: number;
  content: string;
  created_at: string;
}
export interface ChangeRequestRow {
  id: string;
  version_number: number;
  reason: string;
  due_date: string;
  created_at: string;
  resolved_by_version: number | null;
}

export function transaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function getScript(db: DatabaseSync, id: string): ScriptRow | undefined {
  return db.prepare("SELECT * FROM script WHERE id = ?").get(id) as unknown as ScriptRow | undefined;
}

export function listVersions(db: DatabaseSync, scriptId: string): VersionRow[] {
  return db
    .prepare("SELECT number, content, created_at FROM script_version WHERE script_id = ? ORDER BY number")
    .all(scriptId) as unknown as VersionRow[];
}

export function listChangeRequests(db: DatabaseSync, scriptId: string): ChangeRequestRow[] {
  return db
    .prepare(
      `SELECT id, version_number, reason, due_date, created_at, resolved_by_version
       FROM change_request WHERE script_id = ? ORDER BY created_at, rowid`,
    )
    .all(scriptId) as unknown as ChangeRequestRow[];
}

export function latestVersionNumber(db: DatabaseSync, scriptId: string): number {
  const row = db.prepare("SELECT MAX(number) AS n FROM script_version WHERE script_id = ?").get(scriptId) as unknown as {
    n: number | null;
  };
  return row.n ?? 0;
}

export function insertScript(db: DatabaseSync, s: ScriptRow): void {
  db.prepare("INSERT INTO script (id, campaign_id, creator_id, status, created_at) VALUES (?,?,?,?,?)").run(
    s.id,
    s.campaign_id,
    s.creator_id,
    s.status,
    s.created_at,
  );
}

export function insertVersion(db: DatabaseSync, scriptId: string, v: VersionRow): void {
  db.prepare("INSERT INTO script_version (script_id, number, content, created_at) VALUES (?,?,?,?)").run(
    scriptId,
    v.number,
    v.content,
    v.created_at,
  );
}

export function insertChangeRequest(db: DatabaseSync, scriptId: string, r: ChangeRequestRow): void {
  db.prepare(
    `INSERT INTO change_request (id, script_id, version_number, reason, due_date, created_at, resolved_by_version)
     VALUES (?,?,?,?,?,?,NULL)`,
  ).run(r.id, scriptId, r.version_number, r.reason, r.due_date, r.created_at);
}

export function resolveOpenRequest(db: DatabaseSync, scriptId: string, versionNumber: number): void {
  db.prepare("UPDATE change_request SET resolved_by_version = ? WHERE script_id = ? AND resolved_by_version IS NULL").run(
    versionNumber,
    scriptId,
  );
}

export function setStatus(db: DatabaseSync, scriptId: string, status: ScriptStatus): void {
  db.prepare("UPDATE script SET status = ? WHERE id = ?").run(status, scriptId);
}
