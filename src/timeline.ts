import { AppError } from './errors.js';
import { LIMITS } from './config.js';
import { analyzeSiteswap } from './siteswap.js';

export interface ThrowEvent {
  type: 'throw';
  /** 抛出的绝对整数节拍。 */
  time: number;
  /** 周期内相位 = ((time mod L)+L) mod L。 */
  phase: number;
  height: number;
  /** 该球落下的绝对节拍 = time + height。 */
  landsAt: number;
  /** true 表示抛出发生在窗口开始之前（在途球）。 */
  throwBeforeWindow: boolean;
}

export interface LandEvent {
  type: 'land';
  time: number;
  phase: number;
  height: number;
  /** 对应抛出的绝对节拍。 */
  thrownAt: number;
  /** true 表示抛出发生在窗口开始之前（左边界在途事件）。 */
  throwBeforeWindow: boolean;
}

export type TimelineEvent = ThrowEvent | LandEvent;

export interface TimelineResult {
  pattern: number[];
  periodLength: number;
  valid: boolean;
  ballCount: number | null;
  range: { startBeat: number; endBeat: number };
  events: TimelineEvent[];
  truncated: boolean;
  totalCount: number;
  returnedCount: number;
  limit: number;
  perBeatLandCounts: { beat: number; landCount: number }[];
  maxLandPerBeat: number;
  note: string;
}

function checkInt(raw: unknown, name: string): number {
  if (typeof raw !== 'number' || !Number.isInteger(raw)) {
    throw new AppError('INVALID_RANGE', `${name} 必须是整数`);
  }
  return raw;
}

/**
 * 离线展开有限节拍区间 [startBeat, endBeat) 内的事件。
 * 为覆盖窗口开始前已在空中的球，抛球搜索起点向前回溯最多 maxHeight 拍。
 * 纯计算，不等待真实时间。
 */
export function expandTimeline(
  rawPattern: unknown,
  rawStart: unknown,
  rawEnd: unknown,
  rawLimit?: unknown,
): TimelineResult {
  const analysis = analyzeSiteswap(rawPattern);
  const startBeat = checkInt(rawStart, 'startBeat');
  const endBeat = checkInt(rawEnd, 'endBeat');
  if (Math.abs(startBeat) > LIMITS.maxTimeAbs || Math.abs(endBeat) > LIMITS.maxTimeAbs) {
    throw new AppError(
      'INVALID_RANGE',
      `节拍绝对值不能超过 ${LIMITS.maxTimeAbs}（防止无界展开）`,
    );
  }
  if (endBeat <= startBeat) {
    throw new AppError('INVALID_RANGE', 'endBeat 必须大于 startBeat（区间为 [startBeat, endBeat)）');
  }

  let limit: number = LIMITS.defaultLimit;
  if (rawLimit !== undefined && rawLimit !== null) {
    limit = checkInt(rawLimit, 'limit');
    if (limit < 1 || limit > LIMITS.maxLimit) {
      throw new AppError('INVALID_LIMIT', `limit 必须在 1 到 ${LIMITS.maxLimit} 之间`);
    }
  }

  const pattern = analysis.pattern;
  const l = pattern.length;
  const maxHeight = LIMITS.maxHeight;
  const events: TimelineEvent[] = [];

  if (analysis.valid) {
    // 抛出节拍搜索范围：从 startBeat-maxHeight（覆盖在途球）到 endBeat-1。
    for (let t = startBeat - maxHeight; t < endBeat; t++) {
      const phase = ((t % l) + l) % l;
      const h = pattern[phase]!;
      if (h === 0) continue; // 零高度不生成真实事件
      const before = t < startBeat;
      if (t >= startBeat) {
        events.push({
          type: 'throw',
          time: t,
          phase,
          height: h,
          landsAt: t + h,
          throwBeforeWindow: false,
        });
      }
      const landTime = t + h;
      if (landTime >= startBeat && landTime < endBeat) {
        events.push({
          type: 'land',
          time: landTime,
          phase: ((landTime % l) + l) % l,
          height: h,
          thrownAt: t,
          throwBeforeWindow: before,
        });
      }
    }
  }

  // 排序：先按时间，再按类型（land 在 throw 前仅为稳定输出；同拍冲突时两者都保留）。
  events.sort((a, b) => a.time - b.time || a.type.localeCompare(b.type));

  const landMap = new Map<number, number>();
  for (const ev of events) {
    if (ev.type === 'land') landMap.set(ev.time, (landMap.get(ev.time) ?? 0) + 1);
  }
  const perBeatLandCounts = [...landMap.entries()]
    .map(([beat, landCount]) => ({ beat, landCount }))
    .sort((x, y) => x.beat - y.beat);
  const maxLandPerBeat = perBeatLandCounts.reduce((m, x) => Math.max(m, x.landCount), 0);

  const totalCount = events.length;
  const truncated = totalCount > limit;
  const sliced = truncated ? events.slice(0, limit) : events;

  return {
    pattern,
    periodLength: l,
    valid: analysis.valid,
    ballCount: analysis.ballCount,
    range: { startBeat, endBeat },
    events: sliced,
    truncated,
    totalCount,
    returnedCount: sliced.length,
    limit,
    perBeatLandCounts,
    maxLandPerBeat,
    note: analysis.valid
      ? '离线计算：包含窗口开始前抛出、在窗口内落下的在途球（throwBeforeWindow=true）。窗口裁剪不代表落点冲突。'
      : '模式数学上不合法，不生成抛接事件；请先查看 /analyze 的冲突解释。',
  };
}
