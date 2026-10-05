/**
 * 核心分析所用的类型定义。
 *
 * 约定：
 * - 节拍（beat）为整数，0 是参考周期的第一拍，可为负。
 * - 相位（phase）为节拍对周期长度 L 取模的结果，范围 [0, L-1]。
 * - 高度 h 是整数节拍数：在节拍 t 抛出的球在 t+h 落下，h=0 表示该拍没有球可抛。
 */

export const LIMITS = {
  MIN_LENGTH: 1,
  MAX_LENGTH: 16,
  MIN_HEIGHT: 0,
  MAX_HEIGHT: 12,
  /** 平均高度即球数，设上限以防误输入产生不合理的结果。 */
  MAX_BALLS: 12,
  /** 有限节拍区间与输出条数、时间的安全上限。 */
  MAX_WINDOW: 100000,
  MAX_EVENTS: 10000,
  MAX_TIME: 1_000_000,
} as const;

/** 错误码：校验类错误（输入本身的问题），不与服务内部错误混同。 */
export type ErrorCode =
  | 'NOT_ARRAY'
  | 'EMPTY_PATTERN'
  | 'LENGTH_OUT_OF_RANGE'
  | 'NOT_INTEGER'
  | 'HEIGHT_OUT_OF_RANGE'
  | 'BALL_COUNT_OUT_OF_RANGE';

export interface ValidationError {
  code: ErrorCode;
  message: string;
  /** 出错位置（数组下标），无法定位时省略。 */
  index?: number;
}

/** 单拍落点映射项。 */
export interface MappingEntry {
  /** 原始周期内位置（下标），报告中始终保留用户原序。 */
  position: number;
  height: number;
  /** 落点相位 (position + height) mod L。 */
  landingPhase: number;
}

/** 落点冲突的结构化解释。 */
export interface Conflict {
  /** 发生冲突的落点相位。 */
  phase: number;
  /** 所有映射到该相位的原始位置。 */
  positions: number[];
}

/** 相位排列分解出的一个循环。 */
export interface PhaseCycle {
  /** 循环访问的相位，固定从循环内最小相位开始，顺序固定。 */
  phases: number[];
  /** 与相位一一对应的高度序列（来源拍的高度）。 */
  heights: number[];
  /** 循环内高度之和。 */
  heightSum: number;
  /** 该循环对应球数 heightSum / L。 */
  balls: number;
  /** 是否为零高度固定点。 */
  zeroFixedPoint: boolean;
}

/** 分析结果：合法与不合法模式都会返回本结构（valid 区分）。 */
export interface AnalysisResult {
  pattern: number[];
  periodLength: number;
  sum: number;
  /** 平均高度 = 球数（可能不是整数）。 */
  average: number;
  ballCount: number | null;
  averageIsInteger: boolean;
  valid: boolean;
  /** 不合法原因（valid=false 时给出），合法时为空数组。 */
  reasons: string[];
  mapping: MappingEntry[];
  conflicts: Conflict[];
  /** 未被任何落点覆盖的相位。 */
  uncoveredPhases: number[];
  /** 仅在合法且平均数为整数时给出循环分解。 */
  cycles: PhaseCycle[];
  /** 中文解释：为什么循环高度和必被 L 整除、循环球数之和等于总球数。 */
  cycleExplanation: string;
}

export type EventKind = 'throw' | 'landing';

/** 有限节拍区间内的一次抛接事件。 */
export interface TimelineEvent {
  time: number;
  kind: EventKind;
  sourcePosition: number;
  height: number;
  phase: number;
  /** 落事件给出对应的抛出时刻（可能在区间开始之前）。 */
  pairedTime?: number;
}

export interface ExpansionResult {
  pattern: number[];
  periodLength: number;
  startTime: number;
  endTime: number;
  limitEvents: number;
  maxTime: number;
  events: TimelineEvent[];
  truncatedByLimit: boolean;
  truncatedByMaxTime: boolean;
  /** 枚举覆盖到的最晚时刻（截断判定以此为准，不假装完整）。 */
  enumeratedThrough: number;
  /** 稳定区间内每拍真实落球是否至多一个。 */
  atMostOneLandingPerBeat: boolean;
  /** 每拍真实落球数（核对用），键为节拍字符串。 */
  landingsPerBeat: Record<string, number>;
  /** 区间开始前已在空中、并在区间内落下的事件数量。 */
  inFlightFromBefore: number;
}

export interface RotationComparison {
  pattern: number[];
  other: number[];
  rotationallyEquivalent: boolean;
  /** 若等价，使 other 旋转后等于 pattern 的偏移量（0..L-1）；否则 null。 */
  offset: number | null;
  fundamentalPeriod: number;
  fundamentalBlock: number[];
  repetitions: number;
}
