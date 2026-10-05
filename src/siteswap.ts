import { AppError } from './errors.js';
import { LIMITS } from './config.js';

/** 输入校验：必须是整数数组，长度 1..16，高度 0..12。返回规范化后的数字数组。 */
export function validatePatternInput(input: unknown): number[] {
  if (!Array.isArray(input)) {
    throw new AppError('INVALID_PATTERN', '输入必须是整数数组，例如 [5,3,1]');
  }
  if (input.length < LIMITS.minLength || input.length > LIMITS.maxLength) {
    throw new AppError(
      'INVALID_LENGTH',
      `序列长度必须在 ${LIMITS.minLength} 到 ${LIMITS.maxLength} 之间，当前长度为 ${input.length}`,
    );
  }
  const heights: number[] = [];
  for (const raw of input) {
    if (typeof raw !== 'number' || Number.isNaN(raw)) {
      throw new AppError('NON_INTEGER_VALUE', '序列中的每一项必须是数字');
    }
    if (!Number.isInteger(raw)) {
      throw new AppError('NON_INTEGER_VALUE', `高度必须是整数，发现非整数：${raw}`);
    }
    if (raw < 0) {
      throw new AppError('NEGATIVE_VALUE', `高度不能为负数，发现：${raw}`);
    }
    if (raw < LIMITS.minHeight || raw > LIMITS.maxHeight) {
      throw new AppError(
        'HEIGHT_OUT_OF_RANGE',
        `高度必须在 ${LIMITS.minHeight} 到 ${LIMITS.maxHeight} 之间，发现：${raw}`,
      );
    }
    heights.push(raw);
  }
  return heights;
}

export interface MapEntry {
  /** 原始周期内位置（0 起），保留用户输入顺序，不做旋转。 */
  position: number;
  height: number;
  /** 落点相位 (position + height) mod L。 */
  landingPhase: number;
}

export interface ConflictGroup {
  /** 发生冲突的落点相位。 */
  phase: number;
  /** 映射到该相位的所有原始位置。 */
  positions: number[];
  /** 上述位置对应的高度。 */
  heights: number[];
}

export interface PhaseCycle {
  /** 按位置升序输出的相位循环，例如 [0,2,1] 表示 0→2→1→0。 */
  phases: number[];
  /** 与 phases 一一对应的原始抛出高度。 */
  heights: number[];
  /** 循环内高度总和。 */
  heightSum: number;
  /** 该循环对应的球数 = heightSum / L（必为非负整数）。 */
  balls: number;
  /** 是否为零高度固定点（空拍）。 */
  isZeroFixedPoint: boolean;
}

export interface SiteswapAnalysis {
  pattern: number[];
  periodLength: number;
  mapping: MapEntry[];
  valid: boolean;
  averageHeight: number;
  averageIsInteger: boolean;
  ballCount: number | null;
  conflicts: ConflictGroup[];
  uncoveredPhases: number[];
  cycles: PhaseCycle[];
  explanation: string[];
  /** 最小基本周期（合法且非零时有效，否则为 null）。 */
  minimalPeriod: number | null;
  minimalBase: number[] | null;
  isRepeatedPeriod: boolean;
}

/** 最小正周期：最小 d（d 整除 L）使 h[i] = h[i+d] 对所有 i 成立。全零也算周期 1。 */
export function minimalBasicPeriod(pattern: number[]): { period: number; base: number[] } {
  const l = pattern.length;
  for (let d = 1; d < l; d++) {
    if (l % d !== 0) continue;
    let ok = true;
    for (let i = 0; i < l; i++) {
      if (pattern[i] !== pattern[(i + d) % l]) {
        ok = false;
        break;
      }
    }
    if (ok) return { period: d, base: pattern.slice(0, d) };
  }
  return { period: l, base: pattern.slice() };
}

/** 循环旋转比较：相同多重集按周期拼接判等。返回从 a 到 b 的旋转量（b[k] = a[(shift+k)%L]），未找到返回 null。 */
export function rotationShift(a: number[], b: number[]): number | null {
  if (a.length !== b.length) return null;
  const l = a.length;
  outer: for (let shift = 0; shift < l; shift++) {
    for (let k = 0; k < l; k++) {
      if (b[k] !== a[(shift + k) % l]) continue outer;
    }
    return shift;
  }
  return null;
}

export function analyzeSiteswap(rawInput: unknown): SiteswapAnalysis {
  const pattern = validatePatternInput(rawInput);
  const l = pattern.length;
  const sum = pattern.reduce((acc, h) => acc + h, 0);
  const averageHeight = sum / l;
  const averageIsInteger = Number.isInteger(averageHeight);

  const mapping: MapEntry[] = pattern.map((height, position) => ({
    position,
    height,
    landingPhase: (position + height) % l,
  }));

  const buckets = new Map<number, number[]>();
  for (const entry of mapping) {
    const list = buckets.get(entry.landingPhase) ?? [];
    list.push(entry.position);
    buckets.set(entry.landingPhase, list);
  }

  const conflicts: ConflictGroup[] = [];
  const covered = new Set<number>();
  for (let phase = 0; phase < l; phase++) {
    const positions = buckets.get(phase) ?? [];
    if (positions.length > 1) {
      conflicts.push({
        phase,
        positions: [...positions],
        heights: positions.map((p) => pattern[p]!),
      });
    }
    if (positions.length === 1) covered.add(phase);
  }
  const uncoveredPhases: number[] = [];
  for (let phase = 0; phase < l; phase++) {
    if (buckets.get(phase) === undefined) uncoveredPhases.push(phase);
  }
  uncoveredPhases.sort((x, y) => x - y);

  const valid = conflicts.length === 0;
  const explanation: string[] = [];
  const cycles: PhaseCycle[] = [];
  let ballCount: number | null = null;
  let minimalPeriod: number | null = null;
  let minimalBase: number[] | null = null;
  let isRepeatedPeriod = false;

  explanation.push(
    `长度 L=${l}，第 i 拍抛出高度 h_i 的球在 (i+h_i) mod ${l} 号相位落下；高度 0 表示该拍无球可抛。`,
  );
  explanation.push(`高度总和为 ${sum}，平均高度 = ${sum}/${l} = ${averageHeight}。`);
  if (!averageIsInteger) {
    explanation.push('平均高度不是整数，无法对应整数个球；即使如此仍继续检查落点映射。');
  }

  if (!valid) {
    for (const c of conflicts) {
      explanation.push(
        `冲突：相位 ${c.phase} 同时是位置 ${c.positions.join('、')}（高度 ${c.heights.join(
          '、',
        )}）的落点，一个相位不能同时接住两个球。`,
      );
    }
    if (uncoveredPhases.length > 0) {
      explanation.push(`没有被任何落点覆盖的相位：${uncoveredPhases.join('、')}。`);
    }
    explanation.push('仅平均高度为整数并不能保证合法，例如 [3,2,1] 平均为 2 但落点冲突。');
  } else {
    const visited = new Array<boolean>(l).fill(false);
    for (let start = 0; start < l; start++) {
      if (visited[start]) continue;
      const phases: number[] = [];
      let cur = start;
      while (!visited[cur]) {
        visited[cur] = true;
        phases.push(cur);
        cur = mapping[cur]!.landingPhase;
      }
      // 双射下从未访问点出发必然回到起点，构成完整循环。
      const heights = phases.map((p) => pattern[p]!);
      const heightSum = heights.reduce((a, b) => a + b, 0);
      const remainder = heightSum % l;
      const balls = heightSum / l;
      cycles.push({
        phases,
        heights,
        heightSum,
        balls,
        isZeroFixedPoint: phases.length === 1 && heights[0] === 0,
      });
      explanation.push(
        `循环 ${phases.join('→')}→${phases[0]}：高度 ${heights.join(
          '+',
        )}=${heightSum}，除以 L=${l} 余数为 ${remainder}，对应 ${balls} 个球。` +
          (remainder === 0
            ? '余数为零是因为沿循环走一圈总位移是 L 的整数倍（每步位移即高度，终点相位回到起点）。'
            : ''),
      );
    }
    cycles.sort((a, b) => a.phases[0]! - b.phases[0]!);
    const cycleBalls = cycles.reduce((acc, c) => acc + c.balls, 0);
    explanation.push(
      `各循环球数之和 ${cycles.map((c) => c.balls).join('+')}=${cycleBalls}，与平均高度 ${averageHeight} 一致。`,
    );
    const zeroFixed = cycles.filter((c) => c.isZeroFixedPoint).length;
    if (zeroFixed > 0) {
      explanation.push(`其中 ${zeroFixed} 个零高度固定点不生成真实抛接事件，贡献 0 个球。`);
    }
    // 高度 0..12、长度 1..16 时平均球数天然不超过 12，上限常量保留供未来扩展。
    ballCount = averageHeight;
    const mp = minimalBasicPeriod(pattern);
    minimalPeriod = mp.period;
    minimalBase = mp.base;
    isRepeatedPeriod = mp.period < l;
    if (isRepeatedPeriod) {
      explanation.push(
        `该周期是重复周期：最小基本周期为 [${mp.base.join(',')}]（长度 ${mp.period}），重复 ${l / mp.period} 次。`,
      );
    }
  }

  return {
    pattern,
    periodLength: l,
    mapping,
    valid,
    averageHeight,
    averageIsInteger,
    ballCount,
    conflicts,
    uncoveredPhases,
    cycles,
    explanation,
    minimalPeriod,
    minimalBase,
    isRepeatedPeriod,
  };
}
