import { resolve } from 'node:path';
import { rmSync } from 'node:fs';
import { openDb, savePatternVersion, saveReport } from './db.js';
import { analyzeSiteswap, rotationShift } from './siteswap.js';
import { expandTimeline } from './timeline.js';

function banner(text: string): void {
  process.stdout.write(`\n========== ${text} ==========\n`);
}

function show(title: string, value: unknown): void {
  process.stdout.write(`\n--- ${title} ---\n`);
  process.stdout.write(JSON.stringify(value, null, 2) + '\n');
}

const dbPath = resolve('data', 'demo.sqlite');
rmSync(dbPath, { force: true });
rmSync(dbPath + '-wal', { force: true });
rmSync(dbPath + '-shm', { force: true });
const db = openDb(dbPath);

banner('演示 1：3 的三球模式 [3]');
const cascade = analyzeSiteswap([3]);
show('分析结果（合法，平均高度=球数=3）', {
  valid: cascade.valid,
  ballCount: cascade.ballCount,
  cycles: cascade.cycles,
});

banner('演示 2：[5,3,1] 合法模式——相位循环与各自球数');
const shower = analyzeSiteswap([5, 3, 1]);
show('映射', shower.mapping);
show('循环分解（0→2→0 两球，1→1 一球，合计 3 球）', shower.cycles);
process.stdout.write('\n中文解释：\n');
for (const line of shower.explanation) process.stdout.write('  ' + line + '\n');

banner('演示 3：[5,3,1] 有限节拍展开，核对每拍至多一个真实落球');
const tl = expandTimeline([5, 3, 1], -4, 8);
show('事件（含负起点、窗口前抛出的在途球）', {
  range: tl.range,
  maxLandPerBeat: tl.maxLandPerBeat,
  truncated: tl.truncated,
  events: tl.events,
});

banner('演示 4：含零模式 [5,0,1]——空拍不产生事件');
const withZero = analyzeSiteswap([5, 0, 1]);
show('分析（零高度固定点贡献 0 球）', {
  valid: withZero.valid,
  ballCount: withZero.ballCount,
  cycles: withZero.cycles,
});
const zeroTl = expandTimeline([5, 0, 1], 0, 9);
show('展开事件里没有任何高度 0 的事件', { eventCount: zeroTl.events.length, maxLandPerBeat: zeroTl.maxLandPerBeat });

banner('演示 5：[3,2,1] 平均为整数但落点冲突');
const conflict = analyzeSiteswap([3, 2, 1]);
show('冲突解释', {
  valid: conflict.valid,
  averageHeight: conflict.averageHeight,
  conflicts: conflict.conflicts,
  uncoveredPhases: conflict.uncoveredPhases,
});
process.stdout.write('\n中文解释：\n');
for (const line of conflict.explanation) process.stdout.write('  ' + line + '\n');

banner('演示 6：旋转等价（原序列不被改写）');
show('[5,3,1] 与 [3,1,5]', rotationShift([5, 3, 1], [3, 1, 5]) !== null ? { rotationEquivalent: true, shift: rotationShift([5, 3, 1], [3, 1, 5]) } : {});

banner('演示 7：截断标记');
const cut = expandTimeline([3], 0, 100, 8);
show(`总数 ${cut.totalCount}，只返回 8 条，truncated=true`, { totalCount: cut.totalCount, returnedCount: cut.returnedCount, truncated: cut.truncated });

banner('演示 8：SQLite 保存模式版本与报告（修改不覆盖旧报告）');
const v1 = savePatternVersion(db, JSON.stringify([5, 3, 1]), { demo: true });
const r1 = saveReport(db, v1.id, v1.version, 'analyze', {}, shower);
const v2 = savePatternVersion(db, JSON.stringify([5, 3, 1]), { demo: 'rerun' });
const r2 = saveReport(db, v2.id, v2.version, 'timeline', { startBeat: -4, endBeat: 8 }, tl);
show('同一输入保存两次：版本 1→2，报告 1 与报告 2 都保留', {
  patternId: v1.id,
  versions: [v1.version, v2.version],
  reportIds: [r1.id, r2.id],
  dbPath,
});

process.stdout.write('\n全部演示完成。\n');
