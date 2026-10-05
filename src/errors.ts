export type ErrorCode =
  | 'INVALID_PATTERN'
  | 'INVALID_LENGTH'
  | 'HEIGHT_OUT_OF_RANGE'
  | 'NON_INTEGER_VALUE'
  | 'NEGATIVE_VALUE'
  | 'TOO_MANY_BALLS'
  | 'INVALID_RANGE'
  | 'INVALID_LIMIT'
  | 'NOT_FOUND'
  | 'INVALID_JSON'
  | 'INTERNAL';

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details?: unknown;
  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.details = details;
  }
}

export interface ErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    details?: unknown;
  };
}

export function errorBody(code: ErrorCode, message: string, details?: unknown): ErrorBody {
  return { error: { code, message, ...(details === undefined ? {} : { details }) } };
}
