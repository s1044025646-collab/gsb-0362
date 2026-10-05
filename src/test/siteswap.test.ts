import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSiteswap, rotationShift, minimalBasicPeriod } from '../siteswap.js';

test('3 球级联 [3]：合法，一个循环 1 个球×…实际球数 3', () => {
  const a = analyzeSiteswap([3]);
  assert.equal(a.valid, true);
  assert.equal(a.ballCount, 3);
  assert.equal(a.cycles.length, 1);
  assert.equal(a.cycles[0]!.balls, 3);
});

test('[5,3,1] 合法，循环分解各自球数 1，总和 3', () => {
  const a = analyzeSiteswap([5, 3, 1]);
  assert.equal(a.valid, true);
  assert.equal(a.ballCount, 3);
  assert.deepEqual(
    a.cycles.map((c) => c.phases),
    [
      [0, 2],
      [1],
    ],
  );
  assert.deepEqual(a.cycles.map((c) => c.balls), [2, 1]);
  assert.equal(a.cycles[0]!.heightSum, 6);
  assert.equal(a.cycles[1]!.heightSum, 3);
});

test('含零模式 [5,0,1]：零高度固定点贡献 0 球', () => {
  const a = analyzeSiteswap([5, 0, 1]);
  assert.equal(a.valid, true);
  assert.equal(a.ballCount, 2);
  const zeroCycle = a.cycles.find((c) => c.isZeroFixedPoint);
  assert.ok(zeroCycle);
  assert.equal(zeroCycle!.balls, 0);
  assert.equal(a.cycles.reduce((s, c) => s + c.balls, 0), 2);
});

test('[3,2,1] 平均为整数但落点冲突', () => {
  const a = analyzeSiteswap([3, 2, 1]);
  assert.equal(a.valid, false);
  assert.equal(a.averageIsInteger, true);
  assert.deepEqual(a.conflicts.map((c) => c.phase), [0]);
  assert.deepEqual(a.conflicts[0]!.positions, [0, 1, 2]);
  assert.deepEqual(a.uncoveredPhases, [1, 2]);
});

test('全零是合法的零球模式', () => {
  const a = analyzeSiteswap([0, 0, 0]);
  assert.equal(a.valid, true);
  assert.equal(a.ballCount, 0);
  assert.equal(a.cycles.every((c) => c.balls === 0), true);
});

test('长度 1 与最高高度 12', () => {
  assert.equal(analyzeSiteswap([0]).ballCount, 0);
  const h = analyzeSiteswap([12]);
  assert.equal(h.valid, true);
  assert.equal(h.ballCount, 12);
});

test('重复周期识别：[3,3,3] 最小周期 1', () => {
  const a = analyzeSiteswap([3, 3, 3]);
  assert.equal(a.isRepeatedPeriod, true);
  assert.equal(a.minimalPeriod, 1);
  assert.deepEqual(a.minimalBase, [3]);
  const b = analyzeSiteswap([5, 3, 1]);
  assert.equal(b.isRepeatedPeriod, false);
  assert.equal(b.minimalPeriod, 3);
});

test('循环旋转等价判定，且不改变原序列', () => {
  assert.equal(rotationShift([5, 3, 1], [3, 1, 5]), 1);
  assert.equal(rotationShift([5, 3, 1], [5, 1, 3]), null);
  assert.equal(rotationShift([3], [3, 3]), null);
  const a = analyzeSiteswap([3, 1, 5]);
  assert.deepEqual(a.pattern, [3, 1, 5]);
});

test('非整数平均 [3,1]', () => {
  const a = analyzeSiteswap([3, 1]);
  // [3,1] 平均 2 且映射为双射，是合法模式；非整数平均的判定改用真正的例子。
  assert.equal(a.averageIsInteger, true);
  assert.equal(a.valid, true);
  assert.equal(a.ballCount, 2);
  const b = analyzeSiteswap([4, 3]);
  assert.equal(b.averageIsInteger, false);
  assert.equal(b.valid, false);
  assert.equal(b.ballCount, null);
});

test('最小周期工具函数边界', () => {
  assert.deepEqual(minimalBasicPeriod([4, 4, 4, 4]).base, [4]);
  assert.equal(minimalBasicPeriod([4, 2]).period, 2);
  assert.equal(minimalBasicPeriod([0, 0, 0]).period, 1);
});

const rejectCases: [unknown, string][] = [
  [[], 'INVALID_LENGTH'],
  [[-1], 'NEGATIVE_VALUE'],
  [[1.5], 'NON_INTEGER_VALUE'],
  [[13], 'HEIGHT_OUT_OF_RANGE'],
  [[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3, 4, 5], 'INVALID_LENGTH'],
  [['3'], 'NON_INTEGER_VALUE'],
  ['[3]', 'INVALID_PATTERN'],
];

for (const [input, code] of rejectCases) {
  test(`拒绝非法输入 ${JSON.stringify(input)} -> ${code}`, () => {
    assert.throws(
      () => analyzeSiteswap(input),
      (err: unknown) => (err as { code?: string }).code === code,
    );
  });
}

test('边界：[12,12,12] 合法且为重复周期', () => {
  assert.equal(analyzeSiteswap([12, 12, 12]).ballCount, 12);
  const six = analyzeSiteswap([12, 12, 12, 12, 12, 12]);
  assert.equal(six.ballCount, 12);
  assert.equal(six.isRepeatedPeriod, true);
});
