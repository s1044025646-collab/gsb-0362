import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { type AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { openDb, savePatternVersion, saveReport, listPatterns, getPattern, listReports, getReport, parseReport } from './db.js';
import { analyzeSiteswap, rotationShift } from './siteswap.js';
import { expandTimeline } from './timeline.js';
import { AppError, errorBody, type ErrorBody } from './errors.js';

const DATA_DIR = resolve(process.env.SITESWAP_DATA_DIR ?? 'data');
const DB_PATH = resolve(DATA_DIR, 'siteswap.sqlite');
const db = openDb(DB_PATH);

interface JsonRequest {
  body: unknown;
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolvePromise, rejectPromise) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > 1_000_000) {
        rejectPromise(new AppError('INVALID_JSON', '请求体过大（上限 1MB）'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolvePromise({});
      try {
        resolvePromise(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        rejectPromise(new AppError('INVALID_JSON', '请求体不是合法 JSON'));
      }
    });
    req.on('error', () => rejectPromise(new AppError('INVALID_JSON', '读取请求体失败')));
  });
}

function send(res: ServerResponse, status: number, payload: unknown): void {
  const json = JSON.stringify(payload);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(json);
}

function ok(res: ServerResponse, payload: unknown): void {
  send(res, 200, { ok: true, data: payload });
}

type Handler = (
  req: IncomingMessage,
  res: ServerResponse,
  body: unknown,
  query: URLSearchParams,
  params: string[],
) => void | Promise<void>;

const routes: { method: string; match: (p: string) => string[] | null; handler: Handler }[] = [
  {
    method: 'GET',
    match: (p) => (p === '/health' ? [] : null),
    handler: (_req, res) => ok(res, { status: 'up', db: DB_PATH }),
  },
  {
    method: 'POST',
    match: (p) => (p === '/analyze' ? [] : null),
    handler: (_req, res, body) => {
      const pattern = Array.isArray(body) ? body : (body as JsonRequest)?.body;
      const analysis = analyzeSiteswap(pattern);
      ok(res, analysis);
    },
  },
  {
    method: 'POST',
    match: (p) => (p === '/rotate-compare' ? [] : null),
    handler: (_req, res, body) => {
      const b = (body as { a?: unknown; b?: unknown }) ?? {};
      const a = analyzeSiteswap(b.a);
      const other = analyzeSiteswap(b.b);
      const shift = rotationShift(a.pattern, other.pattern);
      ok(res, {
        a: a.pattern,
        b: other.pattern,
        sameLength: a.pattern.length === other.pattern.length,
        rotationEquivalent: shift !== null,
        rotationShift: shift,
        rotatedA: shift === null ? null : a.pattern.map((_, k) => a.pattern[((shift + k) % a.pattern.length)]!),
        note:
          shift === null
            ? '两序列不是循环旋转关系（或长度不同）。'
            : `把 a 循环左移 ${shift} 位即得到 b；旋转等价不改变落点结构，但报告中的原始位置仍以各自输入为准。`,
      });
    },
  },
  {
    method: 'POST',
    match: (p) => (p === '/timeline' ? [] : null),
    handler: (_req, res, body) => {
      const raw = (body as { pattern?: unknown; startBeat?: unknown; endBeat?: unknown; limit?: unknown; body?: unknown }) ?? {};
      const b = raw.pattern ? raw : { ...raw, pattern: raw.body };
      ok(res, expandTimeline(b.pattern, b.startBeat, b.endBeat, b.limit));
    },
  },
  {
    method: 'POST',
    match: (p) => (p === '/patterns' ? [] : null),
    handler: async (_req, res, body) => {
      const b = (body as { pattern?: unknown; runParams?: unknown }) ?? {};
      const pattern = analyzeSiteswap(b.pattern).pattern;
      const row = savePatternVersion(db, JSON.stringify(pattern), b.runParams ?? {});
      ok(res, {
        id: row.id,
        version: row.version,
        pattern: JSON.parse(row.pattern_json),
        runParams: JSON.parse(row.run_params_json),
        createdAt: row.created_at,
      });
    },
  },
  {
    method: 'GET',
    match: (p) => (p === '/patterns' ? [] : null),
    handler: (_req, res) => {
      ok(
        res,
        listPatterns(db).map((r) => ({
          id: r.id,
          version: r.version,
          pattern: JSON.parse(r.pattern_json),
          runParams: JSON.parse(r.run_params_json),
          createdAt: r.created_at,
        })),
      );
    },
  },
  {
    method: 'GET',
    match: (p) => {
      const m = p.match(/^\/patterns\/(\d+)$/);
      return m ? [m[1]!] : null;
    },
    handler: (_req, res, _b, _q, params) => {
      const row = getPattern(db, Number(params![0]));
      if (!row) throw new AppError('NOT_FOUND', `模式 id=${params![0]} 不存在`);
      ok(res, {
        id: row.id,
        version: row.version,
        pattern: JSON.parse(row.pattern_json),
        runParams: JSON.parse(row.run_params_json),
        createdAt: row.created_at,
      });
    },
  },
  {
    method: 'POST',
    match: (p) => {
      const m = p.match(/^\/patterns\/(\d+)\/analyses$/);
      return m ? [m[1]!] : null;
    },
    handler: (_req, res, _body, _q, params) => {
      const patternRow = getPattern(db, Number(params![0]));
      if (!patternRow) throw new AppError('NOT_FOUND', `模式 id=${params![0]} 不存在`);
      const result = analyzeSiteswap(JSON.parse(patternRow.pattern_json));
      const report = saveReport(db, patternRow.id, patternRow.version, 'analyze', {}, result);
      ok(res, { reportId: report.id, saved: true, analysis: result });
    },
  },
  {
    method: 'POST',
    match: (p) => {
      const m = p.match(/^\/patterns\/(\d+)\/timelines$/);
      return m ? [m[1]!] : null;
    },
    handler: async (req, res, body, _q, params) => {
      const patternRow = getPattern(db, Number(params![0]));
      if (!patternRow) throw new AppError('NOT_FOUND', `模式 id=${params![0]} 不存在`);
      const b = (body as { startBeat?: unknown; endBeat?: unknown; limit?: unknown }) ?? {};
      const savedPattern = JSON.parse(patternRow.pattern_json) as unknown;
      const result = expandTimeline(savedPattern, b.startBeat, b.endBeat, b.limit);
      const report = saveReport(
        db,
        patternRow.id,
        patternRow.version,
        'timeline',
        { startBeat: result.range.startBeat, endBeat: result.range.endBeat, limit: result.limit },
        result,
      );
      ok(res, { reportId: report.id, saved: true, timeline: result });
    },
  },
  {
    method: 'GET',
    match: (p) => {
      const m = p.match(/^\/patterns\/(\d+)\/reports$/);
      return m ? [m[1]!] : null;
    },
    handler: (_req, res, _b, _q, params) => {
      const patternRow = getPattern(db, Number(params![0]));
      if (!patternRow) throw new AppError('NOT_FOUND', `模式 id=${params![0]} 不存在`);
      ok(res, listReports(db, patternRow.id).map(parseReport));
    },
  },
  {
    method: 'GET',
    match: (p) => {
      const m = p.match(/^\/reports\/(\d+)$/);
      return m ? [m[1]!] : null;
    },
    handler: (_req, res, _b, _q, params) => {
      const row = getReport(db, Number(params![0]));
      if (!row) throw new AppError('NOT_FOUND', `报告 id=${params![0]} 不存在`);
      ok(res, parseReport(row));
    },
  },
  {
    method: 'GET',
    match: (p) => (p === '/reports' ? [] : null),
    handler: (_req, res, _b, query) => {
      const patternId = query.get('patternId');
      ok(res, listReports(db, patternId ? Number(patternId) : undefined).map(parseReport));
    },
  },
];

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const hasBody = (req.method ?? '') === 'POST' || (req.method ?? '') === 'PUT';
    const body = hasBody ? await readJson(req) : {};
    for (const route of routes) {
      if (route.method !== req.method) continue;
      const params = route.match(url.pathname);
      if (!params) continue;
      await route.handler(req, res, body, url.searchParams, params);
      return;
    }
    send(res, 404, errorBody('NOT_FOUND', `没有此路由：${req.method} ${url.pathname}`));
  } catch (err) {
    if (err instanceof AppError) {
      const status = err.code === 'NOT_FOUND' ? 404 : 400;
      send(res, status, errorBody(err.code, err.message, err.details));
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    send(res, 500, errorBody('INTERNAL', message));
  }
});

const requestedPort = process.env.PORT ? Number(process.env.PORT) : 0;

server.listen(requestedPort, '127.0.0.1', () => {
  const addr = server.address() as AddressInfo;
  console.log(`Siteswap 后端已启动: http://127.0.0.1:${addr.port}`);
  console.log(`SQLite 数据文件: ${DB_PATH}`);
  console.log('可用端点: GET /health, POST /analyze, POST /rotate-compare, POST /timeline,');
  console.log('          POST/GET /patterns, GET /patterns/:id,');
  console.log('          POST /patterns/:id/analyses, POST /patterns/:id/timelines,');
  console.log('          GET /patterns/:id/reports, GET /reports, GET /reports/:id');
});
