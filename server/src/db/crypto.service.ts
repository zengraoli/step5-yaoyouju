import { createCipheriv, createDecipheriv, createHmac, randomBytes, scryptSync } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * 身份隔离库字段加密（AES-256-GCM）。
 * 密钥从环境变量 IDENTITY_ENCRYPTION_KEY（base64，32 字节）读取；
 * 未设置时生成随机开发密钥并写入 server/data/.dev-key（该目录不提交仓库），
 * 仅用于本地演示，生产环境必须显式配置环境变量。
 * 密文格式：v1.<iv-base64>.<tag-base64>.<ciphertext-base64>
 */
export class FieldCrypto {
  private constructor(private readonly key: Buffer) {}

  static fromEnv(dataDir: string): FieldCrypto {
    const raw = process.env.IDENTITY_ENCRYPTION_KEY;
    if (raw && raw.trim()) {
      const key = Buffer.from(raw.trim(), 'base64');
      if (key.length !== 32) {
        throw new Error('IDENTITY_ENCRYPTION_KEY 必须是 32 字节（base64）');
      }
      return new FieldCrypto(key);
    }
    // 开发密钥：持久化到 data 目录，保证重启后仍可解密
    const keyFile = path.join(dataDir, '.dev-key');
    let key: Buffer;
    if (fs.existsSync(keyFile)) {
      key = Buffer.from(fs.readFileSync(keyFile, 'utf8').trim(), 'base64');
    } else {
      key = randomBytes(32);
      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(keyFile, key.toString('base64'), { mode: 0o600 });
    }
    if (key.length !== 32) key = scryptSync(key.toString('base64'), 'yaoyouju-dev', 32);
    return new FieldCrypto(key);
  }

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `v1.${iv.toString('base64')}.${tag.toString('base64')}.${enc.toString('base64')}`;
  }

  decrypt(payload: string): string {
    const parts = payload.split('.');
    if (parts.length !== 4 || parts[0] !== 'v1') {
      throw new Error('密文格式不正确');
    }
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(parts[1], 'base64'));
    decipher.setAuthTag(Buffer.from(parts[2], 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(parts[3], 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }

  /** 盲索引：同一手机号得到稳定哈希，用于查找（不存储明文） */
  blindIndex(value: string): string {
    return createHmac('sha256', this.key).update(`phone:${value}`).digest('base64url');
  }

  /** 手机号脱敏：138****1234 */
  static maskPhone(phone: string): string {
    if (!/^\d{11}$/.test(phone)) return phone;
    return `${phone.slice(0, 3)}****${phone.slice(7)}`;
  }
}
