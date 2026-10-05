import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expandTimeline } from '../timeline.js';
import { analyzeSiteswap } from '../siteswap.js';

test('[3] 稳定区间每拍至多一个真实落球', () => {
  const r = expandTimeline([3], 0, 24);
  assert.equal(r.valid, true);
  assert.equal(r.maxLandPerBeat, 1);
  assert.equal(r.perBeatLandCounts.length, 24);
  assert.equal(r.truncated, false);
});

test('负起点区间与左边界在途事件', () => {
  const r = expandTimeline([3], -4, 2);
  const inFlightLands = r.events.filter((e) => e.type === 'land' && e.throwBeforeWindow);
  assert.ok(inFlightLands.length >= 1);
  assert.ok(inFlightLands.every((e) => (e as { thrownAt: number }).thrownAt < -4));
  assert.ok(r.note.includes('在途球'));
});

test('[5,3,1] 逐拍落球不超过一个，且落球相位与分析一致', () => {
  const r = expandTimeline([5, 3, 1], 0, 30);
  assert.equal(r.maxLandPerBeat, 1);
  const analysis = analyzeSiteswap([5, 3, 1]);
  for (const ev of r.events) {
    if (ev.type !== 'land') continue;
    assert.equal(ev.phase, ((ev.time % 3) + 3) % 3);
    assert.ok(analysis.mapping.some((m) => m.landingPhase === ev.phase && m.height === ev.height));
  }
});

test('零高度不生成事件', () => {
  const r = expandTimeline([5, 0, 1], 0, 12);
  assert.equal(r.events.every((e) => e.height !== 0), true);
});

test('截断明确标记 truncated，不假装完整', () => {
  const r = expandTimeline([3], 0, 100, 10);
  assert.equal(r.truncated, true);
  assert.equal(r.totalCount, 200);
  assert.equal(r.returnedCount, 10);
});

test('非法模式不生成事件但返回说明，不抛内部错误', () => {
  const r = expandTimeline([3, 2, 1], 0, 10);
  assert.equal(r.valid, false);
  assert.equal(r.events.length, 0);
});

test('非法范围参数返回校验错误', () => {
  assert.throws(() => expandTimeline([3], 5, 5), (e: unknown) => (e as { code: string }).code === 'INVALID_RANGE');
  assert.throws(() => expandTimeline([3], 0, 10, 0), (e: unknown) => (e as { code: string }).code === 'INVALID_LIMIT');
});

/**
 * 独立交叉核验：不用分析引擎的映射结论，
 * 直接逐拍在很长的整数时间轴上模拟抛出并检查每个节拍的落球数。
 */
test('独立逐时刻暴力枚举：多个周期内每个节拍落球数 ≤ 1', () => {
  const cases = [[3], [5, 3, 1], [4, 4, 1], [5, 0, 1], [7, 4, 4], [0, 0, 0], [9, 7, 5, 3, 1]];
  for (const pattern of cases) {
    const l = pattern.length;
    const landing = new Map<number, number>();
    const throws: { t: number; h: number }[] = [];
    for (let t = -20; t < 100; t++) {
      const h = pattern[((t % l) + l) % l]!;
      if (h > 0) throws.push({ t, h });
    }
    for (const { t, h } of throws) {
      const land = t + h;
      if (land >= 0 && land < 80) landing.set(land, (landing.get(land) ?? 0) + 1);
    }
    for (const [beat, count] of landing) {
      assert.ok(count <= 1, `模式 ${JSON.stringify(pattern)} 在节拍 ${beat} 有 ${count} 个落球`);
    }
    const engine = analyzeSiteswap(pattern);
    assert.equal(engine.valid, true, `引擎应判定 ${JSON.stringify(pattern)} 合法`);
  }
});

test('暴力枚举同时确认 [3,2,1] 在长轴上确实出现同拍两球', () => {
  const pattern = [3, 2, 1];
  const l = 3;
  const landing = new Map<number, number>();
  for (let t = -10; t < 60; t++) {
    const h = pattern[((t % l) + l) % l]!;
    if (h > 0) {
      const land = t + h;
      landing.set(land, (landing.get(land) ?? 0) + 1);
    }
  }
  assert.ok([...landing.values()].some((c) => c >= 2));
});
