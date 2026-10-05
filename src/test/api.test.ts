import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';

let baseUrl = '';
let proc: ChildProcess;

async function call(path: string, init?: RequestInit): Promise<{ status: number; body: any }> {
  const res = await fetch(baseUrl + path, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  const body = await res.json();
  return { status: res.status, body };
}

before(async () => {
  const dataDir = join(tmpdir(), `siteswap-api-${process.pid}-${Date.now()}`);
  proc = spawn(process.execPath, ['dist/server.js'], {
    env: { ...process.env, SITESWAP_DATA_DIR: dataDir, PORT: '0' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const line = await new Promise<string>((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => rejectPromise(new Error('服务器启动超时')), 10000);
    proc.stdout!.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      const match = text.match(/http:\/\/127\.0\.0\.1:(\d+)/);
      if (match) {
        clearTimeout(timer);
        resolvePromise(match[1]!);
      }
    });
  });
  baseUrl = `http://127.0.0.1:${line}`;
});

after(() => {
  proc.kill();
});

test('GET /health', async () => {
  const { status, body } = await call('/health');
  assert.equal(status, 200);
  assert.equal(body.data.status, 'up');
});

test('POST /analyze 合法与冲突模式', async () => {
  const ok = await call('/analyze', { method: 'POST', body: JSON.stringify([5, 3, 1]) });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.data.valid, true);

  const bad = await call('/analyze', { method: 'POST', body: JSON.stringify([3, 2, 1]) });
  assert.equal(bad.status, 200);
  assert.equal(bad.body.data.valid, false);
  assert.deepEqual(bad.body.data.conflicts[0].positions, [0, 1, 2]);
});

test('非法输入返回错误码而非 500', async () => {
  const r = await call('/analyze', { method: 'POST', body: JSON.stringify([-3]) });
  assert.equal(r.status, 400);
  assert.equal(r.body.error.code, 'NEGATIVE_VALUE');

  const r2 = await call('/analyze', { method: 'POST', body: 'not-json{' });
  assert.equal(r2.status, 400);
  assert.equal(r2.body.error.code, 'INVALID_JSON');
});

test('保存模式→保存分析→保存展开→导出报告 全链路', async () => {
  const saved = await call('/patterns', { method: 'POST', body: JSON.stringify({ pattern: [5, 3, 1], runParams: { demo: true } }) });
  assert.equal(saved.status, 200);
  const id = saved.body.data.id;
  assert.equal(saved.body.data.version, 1);

  const analysis = await call(`/patterns/${id}/analyses`, { method: 'POST', body: '{}' });
  assert.equal(analysis.body.data.analysis.ballCount, 3);
  const analysisReportId = analysis.body.data.reportId;

  const timeline = await call(`/patterns/${id}/timelines`, {
    method: 'POST',
    body: JSON.stringify({ startBeat: -3, endBeat: 6, limit: 50 }),
  });
  assert.equal(timeline.status, 200);
  assert.equal(timeline.body.data.timeline.maxLandPerBeat, 1);
  assert.ok(timeline.body.data.timeline.events.some((e: any) => e.type === 'land' && e.throwBeforeWindow));

  const reports = await call(`/patterns/${id}/reports`);
  assert.equal(reports.body.data.length, 2);

  const one = await call(`/reports/${analysisReportId}`);
  assert.equal(one.body.data.kind, 'analyze');

  const missing = await call('/reports/999999');
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error.code, 'NOT_FOUND');
});

test('旋转比较端点', async () => {
  const r = await call('/rotate-compare', {
    method: 'POST',
    body: JSON.stringify({ a: [5, 3, 1], b: [3, 1, 5] }),
  });
  assert.equal(r.body.data.rotationEquivalent, true);
  assert.equal(r.body.data.rotationShift, 1);
});
