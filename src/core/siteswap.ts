import {
  AnalysisResult,
  Conflict,
  MappingEntry,
  PhaseCycle,
  RotationComparison,
  TimelineEvent,
  ExpansionResult,
  LIMITS,
} from './types.js';

function mod(value: number, length: number): number {
  return ((value % length) + length) % length;
}

/** 构造落点映射表，严格保留用户原始位置顺序，不做旋转或改写。 */
export function buildMapping(pattern: number[]): MappingEntry[] {
  const length = pattern.length;
  return pattern.map((height, position) => ({
    position,
    height,
    landingPhase: mod(position + height, length),
  }));
}

function findConflicts(mapping: MappingEntry[], length: number): {
  conflicts: Conflict[];
  uncovered: number[];
  collision: boolean;
} {
  const buckets = new Map<number, number[]>();
  for (const entry of mapping) {
    const list = buckets.get(entry.landingPhase);
    if (list) list.push(entry.position);
    else buckets.set(entry.landingPhase, [entry.position]);
  }
  const conflicts: Conflict[] = [];
  for (let phase = 0; phase < length; phase++) {
    const positions = buckets.get(phase);
    if (positions && positions.length > 1) {
      conflicts.push({ phase, positions: [...positions].sort((a, b) => a - b) });
    }
  }
  const uncovered: number[] = [];
  for (let phase = 0; phase < length; phase++) {
    if (!buckets.has(phase)) uncovered.push(phase);
  }
  return { conflicts, uncovered, collision: conflicts.length > 0 };
}

/**
 * 把合法落点排列分解为互不相交循环。
 * 每个循环固定从循环内最小相位开始；循环之间按首个相位升序，保证相同输入输出顺序恒定。
 */
export function decomposeCycles(pattern: number[], mapping: MappingEntry[]): PhaseCycle[] {
  const length = pattern.length;
  const f = new Map<number, number>();
  for (const entry of mapping) f.set(entry.position, entry.landingPhase);
  const heightAt = (position: number): number => pattern[position];

  const visited = new Set<number>();
  const cycles: PhaseCycle[] = [];
  for (let start = 0; start < length; start++) {
    if (visited.has(start)) continue;
    const raw: number[] = [];
    let current = start;
    while (!visited.has(current)) {
      visited.add(current);
      raw.push(current);
      current = f.get(current)!;
    }
    const minIndex = raw.indexOf(Math.min(...raw));
    const ordered = [...raw.slice(minIndex), ...raw.slice(0, minIndex)];
    const heights = ordered.map((phase) => heightAt(phase));
    const heightSum = heights.reduce((acc, h) => acc + h, 0);
    cycles.push({
      phases: ordered,
      heights,
      heightSum,
      balls: heightSum / length,
      zeroFixedPoint: ordered.length === 1 && heightAt(ordered[0]) === 0,
    });
  }
  cycles.sort((a, b) => a.phases[0] - b.phases[0]);
  return cycles;
}

/**
 * 分析一个异步 siteswap 序列。
 * 数学不合法（平均数非整数、落点冲突）返回 valid=false 与原因，而非抛出异常。
 */
export function analyzePattern(patternInput: readonly number[]): AnalysisResult {
  const pattern = [...patternInput];
  const length = pattern.length;
  const sum = pattern.reduce((acc, h) => acc + h, 0);
  const average = sum / length;
  const averageIsInteger = Number.isInteger(average);
  const ballCount = averageIsInteger ? average : null;
  const mapping = buildMapping(pattern);
  const { conflicts, uncovered, collision } = findConflicts(mapping, length);

  const reasons: string[] = [];
  if (!averageIsInteger) {
    reasons.push(
      `平均高度 ${sum}/${length} = ${average} 不是整数：siteswap 的平均高度必须等于整数球数。`,
    );
  }
  if (collision) {
    const detail = conflicts
      .map((c) => `相位 ${c.phase} 被位置 ${c.positions.join('、')} 同时落入`)
      .join('；');
    reasons.push(`落点冲突：${detail}。每拍至多一个球，同一相位不允许两个落点。`);
  }
  if (uncovered.length > 0) {
    reasons.push(`以下相位没有任何落点覆盖：${uncovered.join('、')}。`);
  }

  const valid = reasons.length === 0;
  let cycles: PhaseCycle[] = [];
  let cycleExplanation = '';
  if (valid) {
    cycles = decomposeCycles(pattern, mapping);
    cycleExplanation = buildCycleExplanation(cycles, length, ballCount!);
  }

  return {
    pattern,
    periodLength: length,
    sum,
    average,
    ballCount,
    averageIsInteger,
    valid,
    reasons,
    mapping,
    conflicts,
    uncoveredPhases: uncovered,
    cycles,
    cycleExplanation,
  };
}

function buildCycleExplanation(cycles: PhaseCycle[], length: number, totalBalls: number): string {
  const lines: string[] = [];
  lines.push(
    '沿任意相位循环 p0→p1→…→pk−1→p0，每步有 h(pj) = (p(j+1) − pj) + kj·L（kj 为非负整数，L 为周期长度）。',
  );
  lines.push(
    '把循环内所有高度相加时，相位差逐项望远镜式抵消，总和 = (k0 + k1 + … + k(k−1))·L，因此必被 L 整除，余数为 0。',
  );
  for (const cycle of cycles) {
    if (cycle.zeroFixedPoint) {
      lines.push(
        `循环 [${cycle.phases.join(' → ')}] 是零高度固定点：高度和为 0，对应球数 0，不产生真实抛接。`,
      );
    } else {
      lines.push(
        `循环 [${cycle.phases.join(' → ')}] 高度和 ${cycle.heightSum} = ${cycle.balls}×${length}，对应球数 ${cycle.balls}。`,
      );
    }
  }
  const cycleBallSum = cycles.reduce((acc, c) => acc + c.balls, 0);
  lines.push(
    `各循环球数之和 ${cycleBallSum} 与平均高度 sum(h)/L = ${totalBalls} 相等，核对${
      cycleBallSum === totalBalls ? '通过' : '失败'
    }。`,
  );
  return lines.join('\n');
}

/** 最小基本周期：能重复拼出原序列的最短前缀长度。 */
export function fundamentalPeriod(pattern: readonly number[]): {
  period: number;
  block: number[];
  repetitions: number;
} {
  const length = pattern.length;
  for (let period = 1; period <= length; period++) {
    if (length % period !== 0) continue;
    let repeats = true;
    for (let i = period; i < length; i++) {
      if (pattern[i] !== pattern[i % period]) {
        repeats = false;
        break;
      }
    }
    if (repeats) {
      return { period, block: [...pattern.slice(0, period)], repetitions: length / period };
    }
  }
  return { period: length, block: [...pattern], repetitions: 1 };
}

/** 循环旋转比较：other 旋转 offset 拍后（offset 拍成为新首项）等于 pattern 即等价。原序列不被修改。 */
export function compareRotation(
  patternInput: readonly number[],
  otherInput: readonly number[],
): RotationComparison {
  const pattern = [...patternInput];
  const other = [...otherInput];
  let equivalent = false;
  let offset: number | null = null;
  if (pattern.length === other.length) {
    const length = pattern.length;
    for (let candidate = 0; candidate < length; candidate++) {
      const rotated = Array.from({ length }, (_unused, i) => other[(i + candidate) % length]);
      if (rotated.every((value, i) => value === pattern[i])) {
        equivalent = true;
        offset = candidate;
        break;
      }
    }
  }
  const fundamental = fundamentalPeriod(pattern);
  return {
    pattern,
    other,
    rotationallyEquivalent: equivalent,
    offset,
    fundamentalPeriod: fundamental.period,
    fundamentalBlock: fundamental.block,
    repetitions: fundamental.repetitions,
  };
}

export interface ExpandOptions {
  startTime: number;
  endTime: number;
  limitEvents?: number;
  maxTime?: number;
}

/**
 * 在有限整数节拍区间 [startTime, endTime] 上离线枚举抛接事件。
 * 不等待真实时间。区间开始前已在空中的球也计入其在区间内的落下，
 * 因此窗口左边界裁剪不会被误判为落点冲突。
 */
export function expandTimeline(
  patternInput: readonly number[],
  options: ExpandOptions,
): ExpansionResult {
  const pattern = [...patternInput];
  const length = pattern.length;
  const limitEvents = options.limitEvents ?? LIMITS.MAX_EVENTS;
  const maxTime = options.maxTime ?? LIMITS.MAX_TIME;
  if (options.startTime > options.endTime) {
    throw new RangeError(
      `startTime(${options.startTime}) 不能大于 endTime(${options.endTime})。`,
    );
  }
  if (options.endTime - options.startTime + 1 > LIMITS.MAX_WINDOW) {
    throw new RangeError(`区间长度超过上限 ${LIMITS.MAX_WINDOW} 拍。`);
  }
  if (maxTime > LIMITS.MAX_TIME) {
    throw new RangeError(`maxTime 不能超过 ${LIMITS.MAX_TIME}。`);
  }
  if (limitEvents > LIMITS.MAX_EVENTS) {
    throw new RangeError(`limitEvents 不能超过 ${LIMITS.MAX_EVENTS}。`);
  }

  const effectiveEnd = Math.min(options.endTime, maxTime);
  const events: TimelineEvent[] = [];
  const landingsPerBeat: Record<string, number> = {};
  let inFlightFromBefore = 0;
  let truncatedByLimit = false;

  const push = (event: TimelineEvent): boolean => {
    if (events.length >= limitEvents) {
      truncatedByLimit = true;
      return false;
    }
    events.push(event);
    return true;
  };

  // 抛事件：枚举所有落在区间内的抛拍。来源周期 k 可为负（负起点区间）。
  for (let time = options.startTime; time <= effectiveEnd; time++) {
    const position = mod(time, length);
    const height = pattern[position];
    if (height > 0) {
      if (!push({ time, kind: 'throw', sourcePosition: position, height, phase: position })) break;
    }
  }

  // 落事件：对区间内每个落拍 time，找其来源抛拍 throwTime（满足 time-throwTime = h）。
  // throwTime 可能早于 startTime：即区间开始前已在空中的球。
  for (let time = options.startTime; time <= effectiveEnd; time++) {
    if (truncatedByLimit) break;
    const landingPosition = mod(time, length);
    // 合法 siteswap 中每个相位恰有一个来源位置；对任意输入也可反查所有可能来源。
    for (let position = 0; position < length; position++) {
      const height = pattern[position];
      if (height === 0) continue;
      if (mod(position + height, length) !== landingPosition) continue;
      // throwTime ≡ position (mod L)，且 throwTime + height = time。
      const throwTime = time - height;
      if (mod(throwTime, length) !== position) continue;
      if (throwTime < options.startTime) inFlightFromBefore += 1;
      const ok = push({
        time,
        kind: 'landing',
        sourcePosition: position,
        height,
        phase: landingPosition,
        pairedTime: throwTime,
      });
      if (!ok) break;
      landingsPerBeat[String(time)] = (landingsPerBeat[String(time)] ?? 0) + 1;
    }
  }

  events.sort((a, b) => {
    if (a.time !== b.time) return a.time - b.time;
    if (a.kind === 'landing' && b.kind === 'throw') return -1;
    if (a.kind === 'throw' && b.kind === 'landing') return 1;
    return 0;
  });

  const atMostOne = Object.values(landingsPerBeat).every((count) => count <= 1);
  return {
    pattern,
    periodLength: length,
    startTime: options.startTime,
    endTime: options.endTime,
    limitEvents,
    maxTime,
    events,
    truncatedByLimit,
    truncatedByMaxTime: effectiveEnd < options.endTime,
    enumeratedThrough: truncatedByLimit
      ? events.length > 0
        ? events[events.length - 1].time
        : options.startTime - 1
      : effectiveEnd,
    atMostOneLandingPerBeat: atMostOne,
    landingsPerBeat,
    inFlightFromBefore,
  };
}
