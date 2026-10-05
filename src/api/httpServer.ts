import { createServer, Server, IncomingMessage, ServerResponse } from 'node:http';
import { createServer as createNetServer, AddressInfo } from 'node:net';
import { Storage } from '../storage/db.js';
import { validateInput, parseStrictInt } from '../core/validate.js';
import {
  analyzePattern,
  buildMapping,
  compareRotation,
  expandTimeline,
} from '../core/siteswap.js';

interface JsonError {
  error: true;
  code: string;
  message: string;
  index?: number;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
  });
  res.end(text);
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > 1_000_000) {
        reject(Object.assign(new Error('请求体过大（上限 1MB）。'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8');
      if (raw.length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(Object.assign(new Error('请求体不是合法 JSON。'), { statusCode: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function patternFromBody(body: Record<string, unknown>): { pattern?: number[]; error?: JsonError } {
  if (!('pattern' in body)) {
    return { error: { error: true, code: 'MISSING_PATTERN', message: '缺少 pattern 字段。' } };
  }
  const invalid = validateInput(body.pattern);
  if (invalid) {
    return { error: { error: true, ...invalid } };
  }
  return { pattern: body.pattern as number[] };
}

/** 选择空闲端口：port=0 时由操作系统分配；也可显式指定。 */
export function findFreePort(preferred = 0): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createNetServer();
    probe.on('error', reject);
    probe.listen(preferred, '127.0.0.1', () => {
      const address = probe.address() as AddressInfo;
      const port = address.port;
      probe.close(() => resolve(port));
    });
  });
}

export function createApp(storage: Storage): Server {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const path = url.pathname.replace(/\/+$/, '') || '/';
      const method = req.method ?? 'GET';

      if (method === 'GET' && path === '/health') {
        sendJson(res, 200, { ok: true });
        return;
      }

      // 分析、映射、循环、展开、旋转比较：直接对请求中的 pattern 计算。
      if (method === 'POST' && (path === '/api/analyze' || path === '/api/validate')) {
        const body = (await readJson(req)) as Record<string, unknown>;
        const picked = patternFromBody(body);
        if (picked.error) {
          sendJson(res, 400, picked.error);
          return;
        }
        sendJson(res, 200, analyzePattern(picked.pattern!));
        return;
      }

      if (method === 'POST' && path === '/api/mapping') {
        const body = (await readJson(req)) as Record<string, unknown>;
        const picked = patternFromBody(body);
        if (picked.error) {
          sendJson(res, 400, picked.error);
          return;
        }
        const mapping = buildMapping(picked.pattern!);
        sendJson(res, 200, { pattern: picked.pattern, mapping });
        return;
      }

      if (method === 'POST' && path === '/api/cycles') {
        const body = (await readJson(req)) as Record<string, unknown>;
        const picked = patternFromBody(body);
        if (picked.error) {
          sendJson(res, 400, picked.error);
          return;
        }
        const analysis = analyzePattern(picked.pattern!);
        if (!analysis.valid) {
          sendJson(res, 422, {
            error: true,
            code: 'INVALID_SITESWAP',
            message: '模式数学上不合法，无法分解相位循环。',
            analysis,
          });
          return;
        }
        sendJson(res, 200, {
          pattern: picked.pattern,
          cycles: analysis.cycles,
          explanation: analysis.cycleExplanation,
        });
        return;
      }

      if (method === 'POST' && path === '/api/expand') {
        const body = (await readJson(req)) as Record<string, unknown>;
        const picked = patternFromBody(body);
        if (picked.error) {
          sendJson(res, 400, picked.error);
          return;
        }
        try {
          const startTime = parseStrictInt(body.startTime ?? 0, 'startTime');
          const endTime = parseStrictInt(
            body.endTime ?? Math.max(startTime + picked.pattern!.length - 1, 0),
            'endTime',
          );
          const limitEvents =
            body.limitEvents === undefined ? undefined : parseStrictInt(body.limitEvents, 'limitEvents');
          const maxTime =
            body.maxTime === undefined ? undefined : parseStrictInt(body.maxTime, 'maxTime');
          sendJson(res, 200, expandTimeline(picked.pattern!, { startTime, endTime, limitEvents, maxTime }));
        } catch (error) {
          sendJson(res, 400, {
            error: true,
            code: 'BAD_RANGE_PARAM',
            message: error instanceof Error ? error.message : '范围参数不合法。',
          });
        }
        return;
      }

      if (method === 'POST' && path === '/api/rotate-compare') {
        const body = (await readJson(req)) as Record<string, unknown>;
        const pickedA = patternFromBody(body);
        if (pickedA.error) {
          sendJson(res, 400, pickedA.error);
          return;
        }
        if (!('other' in body)) {
          sendJson(res, 400, { error: true, code: 'MISSING_OTHER', message: '缺少 other 字段。' });
          return;
        }
        const invalidOther = validateInput(body.other);
        if (invalidOther) {
          sendJson(res, 400, { error: true, ...invalidOther });
          return;
        }
        sendJson(res, 200, compareRotation(pickedA.pattern!, body.other as number[]));
        return;
      }

      // 保存模式
      if (method === 'POST' && path === '/api/patterns') {
        const body = (await readJson(req)) as Record<string, unknown>;
        const picked = patternFromBody(body);
        if (picked.error) {
          sendJson(res, 400, picked.error);
          return;
        }
        const note = typeof body.note === 'string' ? body.note : null;
        const row = storage.savePattern(picked.pattern!, note);
        sendJson(res, 201, row);
        return;
      }

      if (method === 'GET' && path === '/api/patterns') {
        sendJson(res, 200, storage.listPatterns());
        return;
      }

      const patternMatch = /^\/api\/patterns\/(\d+)$/.exec(path);
      if (method === 'GET' && patternMatch) {
        const row = storage.getPattern(Number(patternMatch[1]));
        if (!row) {
          sendJson(res, 404, { error: true, code: 'NOT_FOUND', message: '模式不存在。' });
          return;
        }
        sendJson(res, 200, row);
        return;
      }

      // 对已保存模式执行分析并保存分析结果（旧报告不覆盖）。
      const analyzeMatch = /^\/api\/patterns\/(\d+)\/analyses$/.exec(path);
      if (method === 'POST' && analyzeMatch) {
        const row = storage.getPattern(Number(analyzeMatch[1]));
        if (!row) {
          sendJson(res, 404, { error: true, code: 'NOT_FOUND', message: '模式不存在。' });
          return;
        }
        const pattern = JSON.parse(row.pattern_json) as number[];
        const result = analyzePattern(pattern);
        const saved = storage.saveAnalysis(row.id, pattern, { endpoint: 'analyze' }, result);
        sendJson(res, 201, { analysis: saved, result });
        return;
      }

      if (method === 'GET' && analyzeMatch) {
        const row = storage.getPattern(Number(analyzeMatch[1]));
        if (!row) {
          sendJson(res, 404, { error: true, code: 'NOT_FOUND', message: '模式不存在。' });
          return;
        }
        sendJson(res, 200, storage.listAnalyses(row.id));
        return;
      }

      if (method === 'GET' && path === '/api/analyses') {
        sendJson(res, 200, storage.listAnalyses());
        return;
      }

      const analysisMatch = /^\/api\/analyses\/(\d+)$/.exec(path);
      if (method === 'GET' && analysisMatch) {
        const row = storage.getAnalysis(Number(analysisMatch[1]));
        if (!row) {
          sendJson(res, 404, { error: true, code: 'NOT_FOUND', message: '分析结果不存在。' });
          return;
        }
        sendJson(res, 200, row);
        return;
      }

      // 导出：把一次分析结果以 JSON 文本返回，可重定向保存为文件。
      if (method === 'POST' && path === '/api/export') {
        const body = (await readJson(req)) as Record<string, unknown>;
        const picked = patternFromBody(body);
        if (picked.error) {
          sendJson(res, 400, picked.error);
          return;
        }
        const result = analyzePattern(picked.pattern!);
        const payload = {
          exportedAt: new Date().toISOString(),
          input: picked.pattern,
          result,
        };
        res.writeHead(200, {
          'content-type': 'application/json; charset=utf-8',
          'content-disposition': 'attachment; filename="siteswap-analysis.json"',
        });
        res.end(JSON.stringify(payload, null, 2));
        return;
      }

      sendJson(res, 404, { error: true, code: 'ROUTE_NOT_FOUND', message: `未找到路由：${method} ${path}` });
    } catch (error) {
      sendJson(res, 500, {
        error: true,
        code: 'INTERNAL_ERROR',
        message: error instanceof Error ? error.message : '服务内部错误。',
      });
    }
  });
  return server;
}

export async function startServer(portPreference: number, _dataDir: string, dbPath: string): Promise<{
  server: Server;
  port: number;
  storage: Storage;
}> {
  const port = await findFreePort(portPreference);
  const storage = new Storage(dbPath);
  const server = createApp(storage);
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  return { server, port, storage };
}
