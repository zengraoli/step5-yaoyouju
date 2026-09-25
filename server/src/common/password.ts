import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * 后台口令哈希与安全比较（T14）。
 * 演示实现：sha256('yaoyouju:' + 口令)，与种子数据（seed.ts）保持同一算法；
 * 登录校验用常量时间比较，避免时序侧信道。生产环境应改用慢哈希（如 bcrypt / scrypt）。
 */
const PASSWORD_SALT = 'yaoyouju:';

export function hashAdminPassword(password: string): string {
  return createHash('sha256').update(`${PASSWORD_SALT}${password}`).digest('hex');
}

/** 常量时间比较；长度不一致时直接判负（timingSafeEqual 要求等长） */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
