#!/usr/bin/env node
import { resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { Storage } from '../storage/db.js';
import { validateInput, parseStrictInt } from '../core/validate.js';
import {
  analyzePattern,
  buildMapping,
  compareRotation,
  expandTimeline,
} from '../core/siteswap.js';
import { startServer } from '../api/httpServer.js';
import { runDemo } from './demo.js';

function parseJsonArray(raw: string): number[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new CliError('BAD_JSON', '参数不是合法 JSON，请使用例如 [3] 或 [5,3,1] 的整数数组。');
  }
  const invalid = validateInput(parsed);
  if (invalid) throw new CliError(invalid.code, invalid.message, invalid.index);
  return parsed as number[];
}

class CliError extends Error {
 constructor(readonly code: string, message: string, readonly index?: number) {
    super(message);
  }
}

function option(args: string[], name: string): string | undefined {
  const at = args.indexOf(name);
  return at >= 0 && at + 1 < args.length ? args[at + 1] : undefined;
}

function defaultDbPath(): string {
  return resolve(process.cwd(), 'data', 'siteswap.sqlite');
}

function openStorage(args: string[]): Storage {
  const dbPath = option(args, '--db') ?? defaultDbPath();
  mkdirSync(resolve(dbPath, '..'), { recursive: true });
  return new Storage(dbPath);
}

function print(value: unknown): void {
  process.stdout.write(JSON.stringify(value, null, 2) + '\n');
}

function printAnalysisSummary(result: ReturnType<typeof analyzePattern>): void {
  process.stdout.write(`\n序列 ${JSON.stringify(result.pattern)}（长度 ${result.periodLength}）\n`);
  process.stdout.write(
    `高度和 ${result.sum}，平均高度 ${result.average}，球数 ${
      result.ballCount ?? '（非整数）'
    }\n`,
  );
  process.stdout.write(`结论：${result.valid ? '合法 ✅' : '不合法 ❌'}\n`);
  for (const reason of result.reasons) process.stdout.write(`  原因：${reason}\n`);
  if (result.valid) {
    process.stdout.write('落点映射：\n');
    for (const entry of result.mapping) {
      process.stdout.write(
        `  位置 ${entry.position}（高度 ${entry.height}） → 相位 ${entry.landingPhase}\n`,
      );
    }
    process.stdout.write('相位循环：\n');
    for (const cycle of result.cycles) {
      process.stdout.write(
        `  [${cycle.phases.join(' → ')}] 高度 [${cycle.heights.join(',')}]，高度和 ${
          cycle.heightSum
        }，球数 ${cycle.balls}${cycle.zeroFixedPoint ? '（零高度固定点）' : ''}\n`,
      );
    }
    process.stdout.write('\n循环余数解释：\n');
    for (const line of result.cycleExplanation.split('\n')) {
      process.stdout.write(`  ${line}\n`);
    }
  } else {
    process.stdout.write('落点映射：\n');
    for (const entry of result.mapping) {
      process.stdout.write(
        `  位置 ${entry.position}（高度 ${entry.height}） → 相位 ${entry.landingPhase}\n`,
      );
    }
    if (result.conflicts.length > 0) {
      process.stdout.write('冲突：\n');
      for (const conflict of result.conflicts) {
        process.stdout.write(
          `  相位 ${conflict.phase} ← 位置 ${conflict.positions.join('、')}\n`,
        );
      }
    }
    if (result.uncoveredPhases.length > 0) {
      process.stdout.write(`未覆盖相位：${result.uncoveredPhases.join('、')}\n`);
    }
  }
  process.stdout.write('\n完整 JSON：\n');
  print(result);
}

async function main(argv: string[]): Promise<number> {
  const [command = '', ...rest] = argv;

  switch (command) {
    case 'analyze':
    case 'validate': {
      if (!rest[0] || rest[0].startsWith('--')) {
        throw new CliError('MISSING_ARGUMENT', '用法：siteswap analyze <json数组>');
      }
      const pattern = parseJsonArray(rest[0]);
      printAnalysisSummary(analyzePattern(pattern));
      return 0;
    }
    case 'mapping': {
      const pattern = parseJsonArray(rest[0]);
      print({ pattern, mapping: buildMapping(pattern) });
      return 0;
    }
    case 'rotate-compare': {
      const a = parseJsonArray(rest[0]);
      const b = parseJsonArray(rest[1]);
      print(compareRotation(a, b));
      return 0;
    }
    case 'expand': {
      const pattern = parseJsonArray(rest[0]);
      const startTime = parseStrictInt(option(rest, '--start') ?? 0, 'startTime');
      const endTime = parseStrictInt(
        option(rest, '--end') ?? String(Math.max(startTime + pattern.length - 1, 0)),
        'endTime',
      );
      const limitEvents = option(rest, '--limit')
        ? parseStrictInt(option(rest, '--limit'), 'limitEvents')
        : undefined;
      const maxTime = option(rest, '--max-time')
        ? parseStrictInt(option(rest, '--max-time'), 'maxTime')
        : undefined;
      print(expandTimeline(pattern, { startTime, endTime, limitEvents, maxTime }));
      return 0;
    }
    case 'save': {
      const pattern = parseJsonArray(rest[0]);
      const storage = openStorage(rest);
      try {
        const note = option(rest, '--note') ?? null;
        print(storage.savePattern(pattern, note));
      } finally {
        storage.close();
      }
      return 0;
    }
    case 'list': {
      const storage = openStorage(rest);
      try {
        print(storage.listPatterns());
      } finally {
        storage.close();
      }
      return 0;
    }
    case 'get': {
      const storage = openStorage(rest);
      try {
        const id = Number(rest[0]);
        const row = storage.getPattern(id);
        if (!row) throw new CliError('NOT_FOUND', `模式 ${id} 不存在。`);
        print(row);
      } finally {
        storage.close();
      }
      return 0;
    }
    case 'save-analysis': {
      const storage = openStorage(rest);
      try {
        const id = Number(rest[0]);
        const row = storage.getPattern(id);
        if (!row) throw new CliError('NOT_FOUND', `模式 ${id} 不存在。`);
        const pattern = JSON.parse(row.pattern_json) as number[];
        const result = analyzePattern(pattern);
        print(storage.saveAnalysis(id, pattern, { endpoint: 'cli-analyze' }, result));
      } finally {
        storage.close();
      }
      return 0;
    }
    case 'analyses': {
      const storage = openStorage(rest);
      try {
        const patternId = rest[0] && !rest[0].startsWith('--') ? Number(rest[0]) : undefined;
        print(storage.listAnalyses(patternId));
      } finally {
        storage.close();
      }
      return 0;
    }
    case 'export': {
      const pattern = parseJsonArray(rest[0]);
      const out = option(rest, '--out');
      const payload = {
        exportedAt: new Date().toISOString(),
        input: pattern,
        result: analyzePattern(pattern),
      };
      const text = JSON.stringify(payload, null, 2);
      if (out) {
        writeFileSync(out, text, 'utf-8');
        process.stdout.write(`已导出到 ${out}\n`);
      } else {
        process.stdout.write(text + '\n');
      }
      return 0;
    }
    case 'serve': {
      const portPref = Number(option(rest, '--port') ?? process.env.PORT ?? 0) || 0;
      const dbPath = option(rest, '--db') ?? defaultDbPath();
      const { port, storage } = await startServer(portPref, resolve(dbPath, '..'), dbPath);
      process.stdout.write(`Siteswap 后端已启动：http://127.0.0.1:${port}（数据文件 ${dbPath}）\n`);
      return new Promise<number>((resolvePromise) => {
        const shutdown = (): void => {
          storage.close();
          resolvePromise(0);
        };
        process.on('SIGINT', shutdown);
        process.on('SIGTERM', shutdown);
      });
    }
    case 'demo': {
      await runDemo();
      return 0;
    }
    case '--help':
    case '-h':
    case 'help':
    case '': {
      process.stdout.write(helpText());
      return command === '' ? 2 : 0;
    }
    default:
      throw new CliError('UNKNOWN_COMMAND', `未知命令：${command}`);
  }
}

function helpText(): string {
  return [
    'Siteswap 分析后端 CLI（仅本地、仅后端）',
    '',
    '用法：siteswap <命令> [参数]',
    '',
    '  analyze <json>              校验并分析序列（合法/不合法都返回分析结果）',
    '  validate <json>             同 analyze，作为校验入口',
    '  mapping <json>              只查看落点映射',
    '  rotate-compare <a> <b>      循环旋转比较与最小基本周期识别',
    '  expand <json> [--start --end --limit --max-time]  离线展开有限节拍',
    '  save <json> [--note 文本] [--db 路径]              保存模式到 SQLite',
    '  list [--db 路径]            列出已保存模式',
    '  get <id>                    查看已保存模式',
    '  save-analysis <id>          对已保存模式生成并保存分析（不覆盖旧报告）',
    '  analyses [patternId]        列出分析结果',
    '  export <json> [--out 文件]  导出分析结果 JSON',
    '  serve [--port 端口] [--db 路径]                    启动 HTTP API（默认空闲端口）',
    '  demo                        运行完整中文演示',
    '',
  ].join('\n');
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    if (error instanceof CliError) {
      process.stderr.write(`错误 [${error.code}]：${error.message}\n`);
      process.exit(2);
    }
    process.stderr.write(`错误 [INTERNAL_ERROR]：${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
