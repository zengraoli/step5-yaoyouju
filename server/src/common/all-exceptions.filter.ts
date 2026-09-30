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
  413: { code: ErrorCode.BAD_REQUEST, message: '内容过长，请分段提交' },
  429: { code: ErrorCode.BAD_REQUEST, message: '请求过于频繁，请稍后再试' },
  500: { code: ErrorCode.INTERNAL, message: '服务器内部错误' },
  503: { code: ErrorCode.SERVICE_UNAVAILABLE, message: '服务暂时不可用，请稍后再试' },
};

/** 参数字段中文名（校验失败提示用，避免出现英文字段名） */
const FIELD_LABELS: Record<string, string> = {
  phone: '手机号',
  code: '验证码',
  scope: '同意范围',
  title: '标题',
  onset_date: '起病日期',
  onset_certainty: '起病确定度',
  status: '状态',
  event_type: '事件类型',
  occurred_at: '发生时间',
  source_type: '来源类型',
  raw_text: '原文内容',
  verify_status: '核实状态',
  date: '日期',
  sit_minutes: '能坐时长',
  planned_activity_done: '计划活动完成情况',
  sleep_impact: '睡眠影响程度',
  top_worry: '最担心的问题',
  leg_change: '腿部变化',
  skipped: '是否跳过记录',
  episode_id: '病程',
  symptom_change: '症状变化',
  report_text: '报告原文',
  question: '提问内容',
  content: '内容',
  format: '格式',
  sections: '摘要内容',
  text: '内容',
  model_name: '模型名称',
  reason: '原因',
  key: '开关',
  enabled: '开关状态',
  name: '名称',
  role: '角色',
  password: '密码',
  totp_code: '动态验证码',
  page: '页码',
  page_size: '每页数量',
  category: '类别',
  description: '描述',
  severity: '严重度',
  help_type: '帮助类型',
  id: 'ID',
};

/**
 * 把 class-validator 的英文校验信息翻译为中文（验收反馈第 31 条）。
 * 无法识别的统一收敛为「xxx 格式不正确」，保证用户端永远看不到英文校验信息。
 */
export function translateValidationMessage(message: string): string {
  if (/[\u4e00-\u9fa5]/.test(message)) {
    return message;
  }
  const m = /^([A-Za-z0-9_]+)\s+(.*)$/.exec(message.trim());
  if (!m) return '请求参数不正确';
  const field = FIELD_LABELS[m[1]] ?? m[1];
  const rest = m[2];
  if (/must be (a|an) string/.test(rest)) return `${field}应为文本`;
  if (/must be (a|an) number/.test(rest)) return `${field}应为数字`;
  if (/must be (a|an) boolean/.test(rest)) return `${field}应为「是」或「否」`;
  if (/must be (a|an) email/.test(rest)) return `${field}应为正确的邮箱地址`;
  if (/must be one of/.test(rest)) return `${field}的取值不在可选范围内`;
  if (/must not be greater than (\d+)/.test(rest)) {
    const n = /must not be greater than (\d+)/.exec(rest)![1];
    return `${field}不能大于 ${n}`;
  }
  if (/must not be less than (\d+)/.test(rest)) {
    const n = /must not be less than (\d+)/.exec(rest)![1];
    return `${field}不能小于 ${n}`;
  }
  if (/should not be empty/.test(rest)) return `${field}不能为空`;
  if (/must be a valid ISO 8601/.test(rest) || /must be a Date/.test(rest)) return `${field}应为有效的时间格式`;
  if (/must be a UUID/.test(rest)) return `${field}格式不正确`;
  if (/must be an integer/.test(rest)) return `${field}应为整数`;
  if (/must be longer than or equal to (\d+)/.test(rest)) {
    return `${field}长度不足`;
  }
  if (/must be shorter than or equal to (\d+)/.test(rest)) {
    const n = /must be shorter than or equal to (\d+)/.exec(rest)![1];
    return `${field}长度不能超过 ${n} 个字符`;
  }
  return `${field}格式不正确`;
}

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
    let data: unknown = null;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const def = DEFAULTS[status];
      if (def) {
        code = def.code;
        message = def.message;
      }
      const body = exception.getResponse();
      if (body && typeof body === 'object') {
        const b = body as { code?: number; message?: string | string[]; data?: unknown };
        if (typeof b.code === 'number') code = b.code;
        // 透传结构化数据（如安全提示内容）；未提供时保持 null
        if ('data' in b) data = b.data;
        if (Array.isArray(b.message) && b.message.length > 0) {
          message = b.message.map((m) => translateValidationMessage(String(m))).join('；');
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

    res.status(status).json({ code, data, message });
  }
}
