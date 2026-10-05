import { LIMITS, ValidationError, ErrorCode } from './types.js';

function fail(code: ErrorCode, message: string, index?: number): ValidationError {
  return { code, message, ...(index === undefined ? {} : { index }) };
}

/**
 * 校验原始输入。通过返回 null；否则返回第一个确定性的错误（错误码固定，顺序固定）。
 * 注意：数学上不合法（如落点冲突）不属于输入校验错误，由 analyze 给出分析结果。
 */
export function validateInput(input: unknown): ValidationError | null {
  if (!Array.isArray(input)) {
    return fail('NOT_ARRAY', '输入必须是整数数组。');
  }
  if (input.length === 0) {
    return fail('EMPTY_PATTERN', '序列不能为空，长度需在 1 到 16 之间。');
  }
  if (input.length < LIMITS.MIN_LENGTH || input.length > LIMITS.MAX_LENGTH) {
    return fail(
      'LENGTH_OUT_OF_RANGE',
      `序列长度需在 ${LIMITS.MIN_LENGTH} 到 ${LIMITS.MAX_LENGTH} 之间，收到 ${input.length}。`,
    );
  }
  for (let i = 0; i < input.length; i++) {
    const value = input[i];
    if (typeof value !== 'number' || !Number.isInteger(value)) {
      return fail('NOT_INTEGER', `第 ${i} 项不是整数（小数与其他类型均拒绝）。`, i);
    }
  }
  for (let i = 0; i < input.length; i++) {
    const value = input[i] as number;
    if (value < LIMITS.MIN_HEIGHT || value > LIMITS.MAX_HEIGHT) {
      return fail(
        'HEIGHT_OUT_OF_RANGE',
        `第 ${i} 项高度 ${value} 超出范围 ${LIMITS.MIN_HEIGHT} 到 ${LIMITS.MAX_HEIGHT}（负数同样拒绝）。`,
        i,
      );
    }
  }
  const sum = (input as number[]).reduce((acc, h) => acc + h, 0);
  const length = input.length;
  if (sum % length === 0 && sum / length > LIMITS.MAX_BALLS) {
    return fail(
      'BALL_COUNT_OUT_OF_RANGE',
      `平均球数 ${sum / length} 超过上限 ${LIMITS.MAX_BALLS}。`,
    );
  }
  return null;
}

/** 解析范围参数（节拍/条数/上限）：只接受整数，拒绝小数与溢出字符串。 */
export function parseStrictInt(value: unknown, field: string): number {
  if (typeof value === 'number') {
    if (Number.isInteger(value) && Number.isSafeInteger(value)) return value;
    throw new RangeError(`${field} 必须是安全整数，收到 ${String(value)}。`);
  }
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) {
    const parsed = Number(value.trim());
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  throw new RangeError(`${field} 必须是整数，收到 ${String(value)}。`);
}
