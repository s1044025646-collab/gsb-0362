import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzePattern, expandTimeline, compareRotation } from '../src/core/siteswap.js';
import { validateInput } from '../src/core/validate.js';

/**
 * 独立交叉核验器：不依赖生产代码的落点映射，
 * 逐拍、逐周期枚举每个抛出及其绝对落下时刻，直接统计每个落拍上的球数。
 */
function independentLandings(
  pattern: number[],
  start: number,
  end: number,
): { perBeat: Map<number, number>; inFlightFromBefore: number } {
  const length = pattern.length;
  const perBeat = new Map<number, number>();
  let inFlightFromBefore = 0;
  // 覆盖区间所需的抛拍周期范围（抛出可在很早以前，h<=12）。
  const firstThrowCycle = Math.floor((start - 12) / length) - 1;
  const lastThrowCycle = Math.floor(end / length) + 1;
  for (let cycle = firstThrowCycle; cycle <= lastThrowCycle; cycle++) {
    for (let position = 0; position < length; position++) {
      const height = pattern[position];
      if (height === 0) continue;
      const throwTime = cycle * length + position;
      const landTime = throwTime + height;
      if (landTime >= start && landTime <= end) {
        perBeat.set(landTime, (perBeat.get(landTime) ?? 0) + 1);
        if (throwTime < start) inFlightFromBefore += 1;
      }
    }
  }
  return { perBeat, inFlightFromBefore };
}

test('3 是合法三球模式', () => {
  const result = analyzePattern([3]);
  assert.equal(result.valid, true);
  assert.equal(result.ballCount, 3);
  assert.deepEqual(result.mapping[0], { position: 0, height: 3, landingPhase: 0 });
  assert.equal(result.cycles[0].balls, 3);
});

test('5,3,1 合法且相位循环球数正确', () => {
  const result = analyzePattern([5, 3, 1]);
  assert.equal(result.valid, true);
  assert.equal(result.ballCount, 3);
  assert.deepEqual(
    result.mapping.map((m) => m.landingPhase),
    [2, 1, 0],
  );
  const ballSum = result.cycles.reduce((acc, c) => acc + c.balls, 0);
  assert.equal(ballSum, 3);
  for (const cycle of result.cycles) assert.equal(cycle.heightSum % 3, 0);
});

test('含零模式 5,0,1 合法且零高度固定点球数为 0', () => {
  const result = analyzePattern([5, 0, 1]);
  assert.equal(result.valid, true);
  assert.equal(result.ballCount, 2);
  const zeroCycle = result.cycles.find((c) => c.zeroFixedPoint);
  assert.ok(zeroCycle);
  assert.equal(zeroCycle!.balls, 0);
  assert.equal(result.cycles.reduce((acc, c) => acc + c.balls, 0), 2);
});

test('3,2,1 平均数为整数但落点冲突，给出冲突与未覆盖相位', () => {
  const result = analyzePattern([3, 2, 1]);
  assert.equal(result.valid, false);
  assert.equal(result.average, 2);
  assert.deepEqual(
    result.mapping.map((m) => m.landingPhase),
    [0, 0, 0],
  );
  assert.deepEqual(result.conflicts, [{ phase: 0, positions: [0, 1, 2] }]);
  assert.deepEqual(result.uncoveredPhases, [1, 2]);
  assert.ok(result.reasons.some((reason) => reason.includes('落点冲突')));
});

test('全零是合法的零球模式', () => {
  const result = analyzePattern([0, 0, 0]);
  assert.equal(result.valid, true);
  assert.equal(result.ballCount, 0);
  assert.equal(result.cycles.length, 3);
  assert.ok(result.cycles.every((c) => c.zeroFixedPoint && c.balls === 0));
});

test('长度一与最高高度边界', () => {
  assert.equal(analyzePattern([0]).valid, true);
  assert.equal(analyzePattern([12]).valid, true);
  assert.equal(validateInput([13])!.code, 'HEIGHT_OUT_OF_RANGE');
});

test('重复周期识别', () => {
  const comparison = compareRotation([5, 3, 1, 5, 3, 1], [5, 3, 1, 5, 3, 1]);
  assert.equal(comparison.fundamentalPeriod, 3);
  assert.deepEqual(comparison.fundamentalBlock, [5, 3, 1]);
  assert.equal(comparison.repetitions, 2);
  assert.equal(compareRotation([7], [7]).fundamentalPeriod, 1);
});

test('旋转等价判定保留原序列不旋转', () => {
  const comparison = compareRotation([5, 3, 1], [3, 1, 5]);
  assert.equal(comparison.rotationallyEquivalent, true);
  assert.equal(comparison.offset, 2);
  assert.deepEqual(comparison.pattern, [5, 3, 1]);
  assert.equal(compareRotation([5, 3, 1], [5, 1, 3]).rotationallyEquivalent, false);
});

test('非整数平均不合法但属于正常分析结果', () => {
  const result = analyzePattern([4, 1]);
  assert.equal(result.valid, false);
  assert.equal(result.averageIsInteger, false);
  assert.equal(result.ballCount, null);
});

const invalidInputs: Array<{ name: string; input: unknown; code: string }> = [
  { name: '空数组', input: [], code: 'EMPTY_PATTERN' },
  { name: '负数', input: [1, -1], code: 'HEIGHT_OUT_OF_RANGE' },
  { name: '小数', input: [1, 2.5], code: 'NOT_INTEGER' },
  { name: '范围外高度', input: [13], code: 'HEIGHT_OUT_OF_RANGE' },
  { name: '过长', input: new Array(17).fill(1), code: 'LENGTH_OUT_OF_RANGE' },
  { name: '非数组', input: '31', code: 'NOT_ARRAY' },
];

for (const item of invalidInputs) {
  test(`输入校验拒绝：${item.name}`, () => {
    assert.equal(validateInput(item.input)!.code, item.code);
  });
}

test('展开 5,3,1 稳定区间，与独立枚举的每拍落球数一致', () => {
  const pattern = [5, 3, 1];
  for (const rangeEnd of [5, 11, 30]) {
    const expansion = expandTimeline(pattern, { startTime: 0, endTime: rangeEnd });
    const independent = independentLandings(pattern, 0, rangeEnd);
    for (let time = 0; time <= rangeEnd; time++) {
      assert.equal(
        expansion.landingsPerBeat[String(time)] ?? 0,
        independent.perBeat.get(time) ?? 0,
        `第 ${time} 拍落球数不一致`,
      );
    }
    assert.equal(expansion.atMostOneLandingPerBeat, true);
  }
});

test('负起点区间覆盖窗口左边界在途事件', () => {
  const pattern = [3];
  const expansion = expandTimeline(pattern, { startTime: -2, endTime: 3 });
  const independent = independentLandings(pattern, -2, 3);
  assert.equal(expansion.inFlightFromBefore, independent.inFlightFromBefore);
  assert.ok(expansion.inFlightFromBefore > 0);
  // t=-2 时有球落下，它抛于 t=-5（窗口开始之前）。
  assert.equal(expansion.landingsPerBeat['-2'] ?? 0, 1);
  assert.ok(
    expansion.events.some(
      (event) => event.kind === 'landing' && event.time === -2 && event.pairedTime === -5,
    ),
  );
});

test('冲突模式的展开也能在枚举中暴露同一拍多个真实落球', () => {
  const pattern = [3, 2, 1];
  const expansion = expandTimeline(pattern, { startTime: 0, endTime: 8 });
  const independent = independentLandings(pattern, 0, 8);
  let foundConflictBeat = false;
  for (const [beat, count] of Object.entries(expansion.landingsPerBeat)) {
    assert.equal(count, independent.perBeat.get(Number(beat)));
    if (count > 1) foundConflictBeat = true;
  }
  assert.ok(foundConflictBeat);
  assert.equal(expansion.atMostOneLandingPerBeat, false);
});

test('截断标记明确且枚举不完整时不假装完整', () => {
  const expansion = expandTimeline([3], { startTime: 0, endTime: 23, limitEvents: 6 });
  assert.equal(expansion.truncatedByLimit, true);
  assert.equal(expansion.events.length, 6);
  assert.ok(expansion.enumeratedThrough < 23);
});

test('maxTime 截断与负区间上限校验', () => {
  const expansion = expandTimeline([3], { startTime: 0, endTime: 100, maxTime: 5 });
  assert.equal(expansion.truncatedByMaxTime, true);
  assert.equal(expansion.enumeratedThrough, 5);
  assert.throws(() => expandTimeline([3], { startTime: 10, endTime: 0 }), /不能大于/);
});

test('多个周期交叉核验：随机合法/非法模式逐拍枚举一致', () => {
  const patterns = [
    [3],
    [5, 3, 1],
    [5, 0, 1],
    [4, 4, 1],
    [7, 1],
    [3, 2, 1],
    [0, 0, 0],
    [6, 0],
  ];
  for (const pattern of patterns) {
    const expansion = expandTimeline(pattern, { startTime: -13, endTime: 40 });
    const independent = independentLandings(pattern, -13, 40);
    for (let time = -13; time <= 40; time++) {
      assert.equal(
        expansion.landingsPerBeat[String(time)] ?? 0,
        independent.perBeat.get(time) ?? 0,
      );
    }
    if (analyzePattern(pattern).valid) {
      assert.equal(expansion.atMostOneLandingPerBeat, true);
      assert.equal(expansion.inFlightFromBefore, independent.inFlightFromBefore);
    }
  }
});
