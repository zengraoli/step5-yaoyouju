import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

/**
 * 请求上下文（T14 / 验收反馈第 16 条）。
 * 每个 HTTP 请求生成一个 request_id，写入响应头 `X-Request-Id`，
 * 并随审计日志落库，便于把「界面操作」与「审计记录」一一对应。
 */
const storage = new AsyncLocalStorage<{ requestId: string }>();

export function runWithRequestId<T>(requestId: string, fn: () => T): T {
  return storage.run({ requestId }, fn);
}

/** 当前请求 ID；无请求上下文（Worker / 脚本）时返回 null */
export function currentRequestId(): string | null {
  return storage.getStore()?.requestId ?? null;
}

/** 生成请求 ID（可复用的短随机串） */
export function newRequestId(): string {
  return randomUUID().replace(/-/g, '').slice(0, 16);
}

export const REQUEST_ID_HEADER = 'X-Request-Id';
