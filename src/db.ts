import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface PatternRow {
  id: number;
  version: number;
  pattern_json: string;
  created_at: string;
  run_params_json: string;
}

export interface ReportRow {
  id: number;
  pattern_id: number;
  pattern_version: number;
  kind: 'analyze' | 'timeline';
  params_json: string;
  result_json: string;
  created_at: string;
}

export function openDb(dbPath: string): DatabaseSync {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS patterns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version INTEGER NOT NULL,
      pattern_json TEXT NOT NULL UNIQUE,
      run_params_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pattern_id INTEGER NOT NULL,
      pattern_version INTEGER NOT NULL,
      kind TEXT NOT NULL,
      params_json TEXT NOT NULL,
      result_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (pattern_id) REFERENCES patterns(id)
    );
  `);
  db.prepare(
    `INSERT OR IGNORE INTO schema_meta(key, value) VALUES ('schema_version', '1')`,
  ).run();
  return db;
}

/** 按原输入内容查重：相同序列复用同一条记录（报告仍独立追加，不覆盖）。 */
export function findPattern(db: DatabaseSync, patternJson: string): PatternRow | undefined {
  return db
    .prepare(`SELECT * FROM patterns WHERE pattern_json = ?`)
    .get(patternJson) as unknown as PatternRow | undefined;
}

export function getPattern(db: DatabaseSync, id: number): PatternRow | undefined {
  return db.prepare(`SELECT * FROM patterns WHERE id = ?`).get(id) as unknown as PatternRow | undefined;
}

export function listPatterns(db: DatabaseSync): PatternRow[] {
  return db.prepare(`SELECT * FROM patterns ORDER BY id ASC, version ASC`).all() as unknown as PatternRow[];
}

/**
 * 保存模式版本。patternKey 为同一条模式的身份（规范化 JSON 字符串）：
 * 再次保存“相同输入”时 version+1，保留历史；不同输入另开一条记录。
 */
export function savePatternVersion(db: DatabaseSync, patternJson: string, runParams: unknown): PatternRow {
  const existing = findPattern(db, patternJson);
  if (existing) {
    // 相同输入复用同一条记录，版本号 +1；旧报告通过 pattern_version 保留历史快照。
    const result = db
      .prepare(
        `UPDATE patterns SET version = version + 1, run_params_json = ?
         WHERE id = ? RETURNING *`,
      )
      .get(JSON.stringify(runParams ?? {}), existing.id);
    return result as unknown as PatternRow;
  }
  const result = db
    .prepare(
      `INSERT INTO patterns(version, pattern_json, run_params_json) VALUES (1, ?, ?)
       RETURNING *`,
    )
    .get(patternJson, JSON.stringify(runParams ?? {}));
  return result as unknown as PatternRow;
}

export function saveReport(
  db: DatabaseSync,
  patternId: number,
  patternVersion: number,
  kind: 'analyze' | 'timeline',
  params: unknown,
  result: unknown,
): ReportRow {
  const row = db
    .prepare(
      `INSERT INTO reports(pattern_id, pattern_version, kind, params_json, result_json)
       VALUES (?, ?, ?, ?, ?) RETURNING *`,
    )
    .get(
      patternId,
      patternVersion,
      kind,
      JSON.stringify(params ?? {}),
      JSON.stringify(result),
    );
  return row as unknown as ReportRow;
}

export function listReports(db: DatabaseSync, patternId?: number): ReportRow[] {
  if (patternId === undefined) {
    return db.prepare(`SELECT * FROM reports ORDER BY id ASC`).all() as unknown as ReportRow[];
  }
  return db
    .prepare(`SELECT * FROM reports WHERE pattern_id = ? ORDER BY id ASC`)
    .all(patternId) as unknown as ReportRow[];
}

export function getReport(db: DatabaseSync, id: number): ReportRow | undefined {
  return db.prepare(`SELECT * FROM reports WHERE id = ?`).get(id) as unknown as ReportRow | undefined;
}

export function parseReport(row: ReportRow): {
  id: number;
  patternId: number;
  patternVersion: number;
  kind: string;
  params: unknown;
  result: unknown;
  createdAt: string;
} {
  return {
    id: row.id,
    patternId: row.pattern_id,
    patternVersion: row.pattern_version,
    kind: row.kind,
    params: JSON.parse(row.params_json),
    result: JSON.parse(row.result_json),
    createdAt: row.created_at,
  };
}

