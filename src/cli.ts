#!/usr/bin/env node
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
import { openDb, savePatternVersion, saveReport, listPatterns, getPattern, listReports, getReport, parseReport } from './db.js';
import { analyzeSiteswap, rotationShift } from './siteswap.js';
import { expandTimeline } from './timeline.js';
import { AppError } from './errors.js';

const DATA_DIR = resolve(process.env.SITESWAP_DATA_DIR ?? 'data');
const db = openDb(resolve(DATA_DIR, 'siteswap.sqlite'));

function parsePatternArg(arg: string): number[] {
  try {
    const value = JSON.parse(arg);
    return analyzeSiteswap(value).pattern;
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError('INVALID_PATTERN', '无法解析模式，请使用 JSON 数组，例如 "[5,3,1]"');
  }
}

function print(value: unknown): void {
  process.stdout.write(JSON.stringify(value, null, 2) + '\n');
}

function flag(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  return idx >= 0 ? args[idx + 1] : undefined;
}

const HELP = `Siteswap 本地分析 CLI

用法:
  node dist/cli.js analyze "[5,3,1]"            完整分析（校验/映射/冲突/循环/球数/最小周期）
  node dist/cli.js validate "[5,3,1]"           只做输入与合法性校验
  node dist/cli.js mapping "[3,2,1]"            查看落点相位映射与冲突
  node dist/cli.js cycles "[5,3,1]"             查看相位循环分解与各循环球数
  node dist/cli.js rotate "[5,3,1]" "[3,1,5]"   判断两序列是否循环旋转等价
  node dist/cli.js expand "[3]" --start -4 --end 8 [--limit 50]
                                                离线展开有限节拍区间（支持负起点与在途球）
  node dist/cli.js save "[5,3,1]" [--run-params '{"note":"demo"}']
                                                保存模式版本（相同输入版本号 +1，不覆盖旧报告）
  node dist/cli.js list                         列出已保存模式
  node dist/cli.js report <patternId> analyze   保存该模式的分析报告
  node dist/cli.js report <patternId> timeline --start -2 --end 6
                                                保存该模式的节拍展开报告
  node dist/cli.js reports [patternId]          列出报告（可按模式过滤）
  node dist/cli.js export <reportId> [--out file.json]
                                                导出已保存报告（默认打印到标准输出）

环境变量:
  SITESWAP_DATA_DIR   数据目录（默认 ./data）
`;

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    process.stdout.write(HELP);
    return;
  }

  switch (command) {
    case 'analyze': {
      print(analyzeSiteswap(JSON.parse(args[0] ?? 'null')));
      return;
    }
    case 'validate': {
      const a = analyzeSiteswap(JSON.parse(args[0] ?? 'null'));
      print({ pattern: a.pattern, valid: a.valid, averageIsInteger: a.averageIsInteger, ballCount: a.ballCount });
      return;
    }
    case 'mapping': {
      const a = analyzeSiteswap(JSON.parse(args[0] ?? 'null'));
      print({ pattern: a.pattern, mapping: a.mapping, conflicts: a.conflicts, uncoveredPhases: a.uncoveredPhases, valid: a.valid });
      return;
    }
    case 'cycles': {
      const a = analyzeSiteswap(JSON.parse(args[0] ?? 'null'));
      print({ valid: a.valid, averageHeight: a.averageHeight, cycles: a.cycles, explanation: a.explanation });
      return;
    }
    case 'rotate': {
      const a = analyzeSiteswap(JSON.parse(args[0] ?? 'null'));
      const b = analyzeSiteswap(JSON.parse(args[1] ?? 'null'));
      const shift = rotationShift(a.pattern, b.pattern);
      print({
        a: a.pattern,
        b: b.pattern,
        rotationEquivalent: shift !== null,
        rotationShift: shift,
        note: shift === null ? '不是循环旋转关系' : `a 左移 ${shift} 位得到 b`,
      });
      return;
    }
    case 'expand': {
      const pattern = JSON.parse(args[0] ?? 'null');
      const start = Number(flag(args, '--start') ?? '0');
      const end = Number(flag(args, '--end') ?? '8');
      const limitRaw = flag(args, '--limit');
      print(expandTimeline(pattern, start, end, limitRaw === undefined ? undefined : Number(limitRaw)));
      return;
    }
    case 'save': {
      const pattern = parsePatternArg(args[0] ?? 'null');
      const runParams = flag(args, '--run-params') ? JSON.parse(flag(args, '--run-params')!) : {};
      const row = savePatternVersion(db, JSON.stringify(pattern), runParams);
      print({ saved: true, id: row.id, version: row.version, pattern, runParams });
      return;
    }
    case 'list': {
      print(listPatterns(db).map((r) => ({ id: r.id, version: r.version, pattern: JSON.parse(r.pattern_json) })));
      return;
    }
    case 'report': {
      const id = Number(args[0]);
      const kind = args[1];
      const row = getPattern(db, id);
      if (!row) throw new AppError('NOT_FOUND', `模式 id=${id} 不存在`);
      const pattern = JSON.parse(row.pattern_json);
      if (kind === 'analyze') {
        const result = analyzeSiteswap(pattern);
        const report = saveReport(db, row.id, row.version, 'analyze', {}, result);
        print({ saved: true, reportId: report.id, result });
      } else if (kind === 'timeline') {
        const start = Number(flag(args, '--start') ?? '0');
        const end = Number(flag(args, '--end') ?? '8');
        const result = expandTimeline(pattern, start, end);
        const report = saveReport(db, row.id, row.version, 'timeline', { startBeat: start, endBeat: end, limit: result.limit }, result);
        print({ saved: true, reportId: report.id, result });
      } else {
        throw new AppError('INVALID_JSON', 'report 子命令必须是 analyze 或 timeline');
      }
      return;
    }
    case 'reports': {
      const id = args[0] ? Number(args[0]) : undefined;
      print(listReports(db, id).map(parseReport));
      return;
    }
    case 'export': {
      const reportId = Number(args[0]);
      const row = getReport(db, reportId);
      if (!row) throw new AppError('NOT_FOUND', `报告 id=${reportId} 不存在`);
      const parsed = parseReport(row);
      const out = flag(args, '--out');
      if (out) {
        writeFileSync(out, JSON.stringify(parsed, null, 2), 'utf8');
        print({ exported: true, path: resolve(out) });
      } else {
        print(parsed);
      }
      return;
    }
    default:
      throw new AppError('INVALID_JSON', `未知命令：${command}\n\n${HELP}`);
  }
}

main().catch((err: unknown) => {
  if (err instanceof AppError) {
    process.stderr.write(`错误 [${err.code}] ${err.message}\n`);
  } else if (err instanceof SyntaxError) {
    process.stderr.write(`错误 [INVALID_JSON] 模式参数不是合法 JSON 数组\n`);
  } else {
    process.stderr.write(`错误 [INTERNAL] ${err instanceof Error ? err.message : String(err)}\n`);
  }
  process.exitCode = 1;
});
