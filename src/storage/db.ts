import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export const SCHEMA_VERSION = 1;

/** 保存的模式：版本、原输入与运行参数；原序列原样保留。 */
export interface SavedPatternRow {
  id: number;
  schema_version: number;
  pattern_json: string;
  period_length: number;
  note: string | null;
  created_at: string;
}

/** 保存的分析结果：绑定具体模式快照；修改模式产生新行，不覆盖旧报告。 */
export interface SavedAnalysisRow {
  id: number;
  pattern_id: number;
  pattern_snapshot_json: string;
  params_json: string;
  result_json: string;
  created_at: string;
}

export class Storage {
  readonly db: DatabaseSync;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS patterns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        schema_version INTEGER NOT NULL,
        pattern_json TEXT NOT NULL,
        period_length INTEGER NOT NULL,
        note TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
      CREATE TABLE IF NOT EXISTS analyses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pattern_id INTEGER NOT NULL REFERENCES patterns(id),
        pattern_snapshot_json TEXT NOT NULL,
        params_json TEXT NOT NULL,
        result_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
    `);
    const insertMeta = this.db.prepare(
      'INSERT OR IGNORE INTO schema_meta(key, value) VALUES (?, ?)',
    );
    insertMeta.run('schema_version', String(SCHEMA_VERSION));
  }

  savePattern(pattern: number[], note: string | null): SavedPatternRow {
    const stmt = this.db.prepare(
      `INSERT INTO patterns(schema_version, pattern_json, period_length, note)
       VALUES (?, ?, ?, ?)`,
    );
    const result = stmt.run(SCHEMA_VERSION, JSON.stringify(pattern), pattern.length, note);
    return this.getPattern(Number(result.lastInsertRowid))!;
  }

  getPattern(id: number): SavedPatternRow | null {
    const row = this.db.prepare('SELECT * FROM patterns WHERE id = ?').get(id) as
      | SavedPatternRow
      | undefined;
    return row ?? null;
  }

  listPatterns(): SavedPatternRow[] {
    return this.db.prepare('SELECT * FROM patterns ORDER BY id ASC').all() as unknown as
      SavedPatternRow[];
  }

  saveAnalysis(
    patternId: number,
    patternSnapshot: number[],
    params: Record<string, unknown>,
    result: unknown,
  ): SavedAnalysisRow {
    const stmt = this.db.prepare(
      `INSERT INTO analyses(pattern_id, pattern_snapshot_json, params_json, result_json)
       VALUES (?, ?, ?, ?)`,
    );
    const runResult = stmt.run(
      patternId,
      JSON.stringify(patternSnapshot),
      JSON.stringify(params),
      JSON.stringify(result),
    );
    return this.db.prepare('SELECT * FROM analyses WHERE id = ?').get(
      Number(runResult.lastInsertRowid),
    ) as unknown as SavedAnalysisRow;
  }

  listAnalyses(patternId?: number): SavedAnalysisRow[] {
    if (patternId === undefined) {
      return this.db.prepare('SELECT * FROM analyses ORDER BY id ASC').all() as unknown as SavedAnalysisRow[];
    }
    return this.db
      .prepare('SELECT * FROM analyses WHERE pattern_id = ? ORDER BY id ASC')
      .all(patternId) as unknown as SavedAnalysisRow[];
  }

  getAnalysis(id: number): SavedAnalysisRow | null {
    const row = this.db.prepare('SELECT * FROM analyses WHERE id = ?').get(id) as
      | SavedAnalysisRow
      | undefined;
    return row ?? null;
  }

  close(): void {
    this.db.close();
  }
}
