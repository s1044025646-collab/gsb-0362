import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, savePatternVersion, saveReport, listReports, parseReport } from '../db.js';

test('saving same input creates a new version without overwriting reports', () => {
  const path = join(tmpdir(), `siteswap-db-${process.pid}-${Date.now()}.sqlite`);
  const db = openDb(path);

  const v1 = savePatternVersion(db, JSON.stringify([5, 3, 1]), { source: 'test' });
  assert.equal(v1.version, 1);
  const report1 = saveReport(db, v1.id, 1, 'analyze', {}, { valid: true });

  const v2 = savePatternVersion(db, JSON.stringify([5, 3, 1]), { source: 'rerun' });
  assert.equal(v2.id, v1.id);
  assert.equal(v2.version, 2);

  const v3 = savePatternVersion(db, JSON.stringify([3]), {});
  assert.notEqual(v3.id, v1.id);
  assert.equal(v3.version, 1);

  const report2 = saveReport(db, v1.id, 2, 'timeline', { startBeat: 0, endBeat: 6 }, { truncated: false });
  const reports = listReports(db, v1.id);
  assert.equal(reports.length, 2);
  assert.deepEqual(parseReport(report1).result, { valid: true });
  assert.deepEqual(parseReport(report2).params, { startBeat: 0, endBeat: 6 });

  db.close();
  rmSync(path, { force: true });
  rmSync(path + '-wal', { force: true });
  rmSync(path + '-shm', { force: true });
});
