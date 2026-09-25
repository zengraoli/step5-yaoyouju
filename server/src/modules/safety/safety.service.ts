import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DbService } from '../../db/db.service';
import { ApiException, ErrorCode } from '../../common/api-error';
import {
  OUT_OF_SCOPE_RULES,
  RED_FLAG_RULES,
  RULE_SET_VERSION,
  SafetyAction,
  ScopeCategory,
  ScopeRule,
} from './safety.rules';

export interface SafetyInput {
  user_id?: string;
  /** 待校验文本：症状变化、报告原文、提问等 */
  texts?: string[];
}

export interface MatchedRule {
  rule_code: string;
  label: string;
  severity: string;
  action: SafetyAction;
  advice: string;
  /** 命中的原文片段（用于前端高亮与说明） */
  excerpt: string;
}

export interface SafetyResult {
  safety_flag: 'none' | 'seek_care' | 'stop_personal';
  matched: MatchedRule[];
  rule_set_version: string;
  out_of_scope: null | {
    rule_code: string;
    category: ScopeCategory;
    reply: string;
    followup_question: string;
  };
}

/**
 * 安全规则引擎：被分析编排服务调用（T07）。
 * 命中红旗 → 写 SAFETY_EVENT（规则、严重度、动作、来源）。
 */
@Injectable()
export class SafetyService {
  private readonly logger = new Logger('Safety');

  constructor(private readonly db: DbService) {}

  /** 校验红旗信号；命中即写安全事件 */
  checkRedFlags(input: SafetyInput): SafetyResult {
    const texts = (input.texts ?? []).filter((t) => typeof t === 'string' && t.trim());
    const matched: MatchedRule[] = [];
    for (const rule of RED_FLAG_RULES) {
      for (const text of texts) {
        const hit = rule.patterns.find((p) => p.test(text));
        if (hit) {
          matched.push({
            rule_code: rule.code,
            label: rule.label,
            severity: rule.severity,
            action: rule.action,
            advice: rule.advice,
            excerpt: excerptAround(text, hit),
          });
          break;
        }
      }
    }
    const hasHigh = matched.some((m) => m.severity === 'high');
    const safety_flag: SafetyResult['safety_flag'] =
      matched.length === 0 ? 'none' : hasHigh ? 'stop_personal' : 'seek_care';

    if (matched.length > 0 && input.user_id) {
      for (const m of matched) {
        this.recordEvent(input.user_id, m);
      }
      this.logger.warn(
        `[safety] 命中红旗 ${matched.map((m) => m.rule_code).join(',')}（规则集 ${RULE_SET_VERSION}）`,
      );
    }
    return { safety_flag, matched, rule_set_version: RULE_SET_VERSION, out_of_scope: null };
  }

  /** 服务范围校验：诊断 / 手术 / 用药越界（不写安全事件，直接不答） */
  checkScope(question: string): SafetyResult['out_of_scope'] {
    for (const rule of OUT_OF_SCOPE_RULES) {
      if (rule.patterns.some((p) => p.test(question))) {
        return {
          rule_code: rule.code,
          category: rule.category,
          reply: rule.reply,
          followup_question: rule.followup_question,
        };
      }
    }
    return null;
  }

  /** 供问与解释（T08）使用：先范围校验，再红旗校验 */
  evaluateQuestion(question: string, user_id?: string): SafetyResult {
    const out_of_scope = this.checkScope(question);
    const result = this.checkRedFlags({ user_id, texts: [question] });
    return { ...result, out_of_scope };
  }

  private recordEvent(userId: string, m: MatchedRule): void {
    this.db.app
      .prepare(
        `INSERT INTO safety_event (id, user_id, rule_code, severity, action_taken, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(randomUUID(), userId, m.rule_code, m.severity, m.action, new Date().toISOString());
  }
}

function excerptAround(text: string, re: RegExp): string {
  const idx = text.search(re);
  if (idx < 0) return text.slice(0, 40);
  const start = Math.max(0, idx - 10);
  return text.slice(start, Math.min(text.length, idx + 30));
}

/** 命中红旗时抛出的异常（附带安全提示，供控制器转成 409 + 提示内容） */
export function safetyException(result: SafetyResult): ApiException {
  const high = result.matched.find((m) => m.severity === 'high') ?? result.matched[0];
  return new ApiException(
    result.safety_flag === 'stop_personal' ? ErrorCode.SAFETY_STOP_PERSONAL : ErrorCode.SAFETY_SEEK_CARE,
    high?.advice ?? '检测到需要及时就医的信号，请尽快就医',
  );
}

export type { ScopeRule };
