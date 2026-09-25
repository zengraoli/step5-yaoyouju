import { HttpException, HttpStatus } from '@nestjs/common';

/** 错误码登记表（同步维护 server/docs/errors.md） */
export enum ErrorCode {
  /** 请求参数错误 / 校验失败 */
  BAD_REQUEST = 40000,
  /** 未登录 / 登录态失效 */
  UNAUTHORIZED = 40100,
  /** 无权限 */
  FORBIDDEN = 40300,
  /** 资源不存在 */
  NOT_FOUND = 40400,
  /** 状态冲突（如重复提交、状态机不允许的流转） */
  CONFLICT = 40900,
  /** 触发安全规则：需提示就医 */
  SAFETY_SEEK_CARE = 40910,
  /** 触发安全规则：停止个性化分析 */
  SAFETY_STOP_PERSONAL = 40911,
  /** 服务不可用（模型 / 检索 / 来源校验失败） */
  SERVICE_UNAVAILABLE = 50300,
  /** 服务器内部错误 */
  INTERNAL = 50000,
}

const MESSAGES: Record<number, string> = {
  [ErrorCode.BAD_REQUEST]: '请求参数不正确',
  [ErrorCode.UNAUTHORIZED]: '请先登录',
  [ErrorCode.FORBIDDEN]: '没有权限执行该操作',
  [ErrorCode.NOT_FOUND]: '请求的内容不存在',
  [ErrorCode.CONFLICT]: '当前状态不允许该操作',
  [ErrorCode.SAFETY_SEEK_CARE]: '检测到需要及时就医的信号，请尽快就医',
  [ErrorCode.SAFETY_STOP_PERSONAL]: '已停止个性化分析，请及时就医',
  [ErrorCode.SERVICE_UNAVAILABLE]: '服务暂时不可用，请稍后再试',
  [ErrorCode.INTERNAL]: '服务器内部错误',
};

/** 业务异常：携带中文 message 与登记过的错误码 */
export class ApiException extends HttpException {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message?: string) {
    super(
      { code, message: message ?? MESSAGES[code] ?? '请求处理失败' },
      code >= ErrorCode.SERVICE_UNAVAILABLE
        ? HttpStatus.SERVICE_UNAVAILABLE
        : code >= ErrorCode.INTERNAL
          ? HttpStatus.INTERNAL_SERVER_ERROR
          : code >= ErrorCode.BAD_REQUEST
            ? HttpStatus.BAD_REQUEST
            : HttpStatus.OK,
    );
    this.code = code;
  }
}

export function errorMessage(code: ErrorCode): string {
  return MESSAGES[code] ?? '请求处理失败';
}
