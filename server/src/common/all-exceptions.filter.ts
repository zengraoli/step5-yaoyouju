import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { ErrorCode } from './api-error';

/** 状态码对应的默认错误码与中文文案 */
const DEFAULTS: Record<number, { code: ErrorCode; message: string }> = {
  400: { code: ErrorCode.BAD_REQUEST, message: '请求参数不正确' },
  401: { code: ErrorCode.UNAUTHORIZED, message: '请先登录' },
  403: { code: ErrorCode.FORBIDDEN, message: '没有权限执行该操作' },
  404: { code: ErrorCode.NOT_FOUND, message: '请求的内容不存在' },
  409: { code: ErrorCode.CONFLICT, message: '当前状态不允许该操作' },
  429: { code: ErrorCode.BAD_REQUEST, message: '请求过于频繁，请稍后再试' },
  500: { code: ErrorCode.INTERNAL, message: '服务器内部错误' },
  503: { code: ErrorCode.SERVICE_UNAVAILABLE, message: '服务暂时不可用，请稍后再试' },
};

/** 全局异常过滤：错误统一返回 { code, data: null, message }，message 为中文 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exception');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code: number = ErrorCode.INTERNAL;
    let message = '服务器内部错误';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const def = DEFAULTS[status];
      if (def) {
        code = def.code;
        message = def.message;
      }
      const body = exception.getResponse();
      if (body && typeof body === 'object') {
        const b = body as { code?: number; message?: string | string[] };
        if (typeof b.code === 'number') code = b.code;
        if (Array.isArray(b.message) && b.message.length > 0) {
          message = b.message.join('；');
        } else if (typeof b.message === 'string' && /[\u4e00-\u9fa5]/.test(b.message)) {
          // 仅保留自定义的中文文案，NestJS 内置英文文案统一替换为登记表文案
          message = b.message;
        }
      }
    } else if (exception instanceof Error) {
      this.logger.error(exception.message, exception.stack);
      message = '服务器内部错误';
    }

    if (!Number.isInteger(code) || code === 0) {
      code = status >= 500 ? ErrorCode.INTERNAL : ErrorCode.BAD_REQUEST;
    }
    if (status >= 500) {
      this.logger.error(`[${code}] ${message}`);
    }

    res.status(status).json({ code, data: null, message });
  }
}
