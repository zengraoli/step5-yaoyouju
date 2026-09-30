import { ApiException, ErrorCode } from './api-error';
/** 时间工具：存储与传输用 UTC ISO8601，界面按北京时间（UTC+8）显示 */
export function beijingNow(): Date {
  return new Date();
}

/** UTC ISO 字符串 → 北京日期 YYYY-MM-DD */
export function beijingDate(iso?: string): string {
  const d = iso ? new Date(iso) : new Date();
  const shifted = new Date(d.getTime() + 8 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

/** 今天的北京日期 */
export function todayBeijing(): string {
  return beijingDate();
}

/** 归一化日期 / 时间输入为 UTC ISO8601；仅日期按北京时间当天 00:00 处理 */
export function normalizeInstant(input: string | Date): string {
  if (input instanceof Date) return input.toISOString();
  const s = String(input).trim();
  if (!s) {
    throw new ApiException(ErrorCode.BAD_REQUEST, '时间不能为空');
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(`${s}T00:00:00.000+08:00`);
    if (Number.isNaN(d.getTime())) {
      throw new ApiException(ErrorCode.BAD_REQUEST, '日期格式应为 YYYY-MM-DD');
    }
    return d.toISOString();
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) {
    throw new ApiException(ErrorCode.BAD_REQUEST, '时间格式应为 UTC ISO8601（如 2026-09-01T08:00:00.000Z）');
  }
  return d.toISOString();
}
