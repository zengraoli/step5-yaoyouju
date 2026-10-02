import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DbService } from '../../db/db.service';
import { ApiException, ErrorCode } from '../../common/api-error';
import {
  OUT_OF_SCOPE_RULES,
  RED_FLAG_RULES,
  RULE_SET_VERSION,
  RedFlagRule,
  SafetyAction,
  ScopeCategory,
  ScopeRule,
  matchesRedFlagRule,
  matchesScopeRule,
  normalizeSafetyText,
  redFlagExcerpt,
} from './safety.rules';

export interface SafetyInput {
  user_id?: string;
  /** 关联病程（写入安全事件，便于按病程复查） */
  episode_id?: string;
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
        if (matchesRedFlagRule(rule, text)) {
          matched.push({
            rule_code: rule.code,
            label: rule.label,
            severity: rule.severity,
            action: rule.action,
            advice: rule.advice,
            excerpt: redFlagExcerpt(rule, text),
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
        this.recordEvent(input.user_id, input.episode_id, m);
      }
      this.logger.warn(
        `[safety] 命中红旗 ${matched.map((m) => m.rule_code).join(',')}（规则集 ${RULE_SET_VERSION}）`,
      );
    }
    return { safety_flag, matched, rule_set_version: RULE_SET_VERSION, out_of_scope: null };
  }

  /** 服务范围校验：诊断 / 手术 / 用药 / 预后越界（不写安全事件，直接不答） */
  checkScope(question: string): SafetyResult['out_of_scope'] {
    for (const rule of OUT_OF_SCOPE_RULES) {
      if (matchesScopeRule(rule, question)) {
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

  /** 供问与解释（T08）使用：先范围校验，再红旗校验；命中红旗写安全事件并关联病程 */
  evaluateQuestion(question: string, user_id?: string, episode_id?: string): SafetyResult {
    const out_of_scope = this.checkScope(question);
    const result = this.checkRedFlags({ user_id, episode_id, texts: [question] });
    return { ...result, out_of_scope };
  }

  /** 病程已记录的安全事件（生成分析前复查：既有红旗不能被绕过） */
  episodeRedFlagEvents(episodeId: string): { rule_code: string; severity: string; label: string }[] {
    const rows = this.db.app
      .prepare(
        `SELECT rule_code, severity FROM safety_event
         WHERE episode_id = ? AND severity = 'high' ORDER BY created_at ASC`,
      )
      .all(episodeId) as { rule_code: string; severity: string }[];
    return rows.map((r) => ({
      rule_code: r.rule_code,
      severity: r.severity,
      label: RED_FLAG_RULES.find((x) => x.code === r.rule_code)?.label ?? r.rule_code,
    }));
  }

  /**
   * 还没有任何病历时（先开问答 / 记录今天）命中的高危红旗：未关联病程。
   * 生成分析前同样要复查，避免用户「先问一句再建病程」绕过产品红线第 3 条。
   */
  unlinkedHighEvents(userId: string): { rule_code: string; severity: string; label: string }[] {
    const rows = this.db.app
      .prepare(
        `SELECT rule_code, severity FROM safety_event
          WHERE user_id = ? AND episode_id IS NULL AND severity = 'high' ORDER BY created_at ASC`,
      )
      .all(userId) as { rule_code: string; severity: string }[];
    return rows.map((r) => ({
      rule_code: r.rule_code,
      severity: r.severity,
      label: RED_FLAG_RULES.find((x) => x.code === r.rule_code)?.label ?? r.rule_code,
    }));
  }

  /** 新建病程时，把之前未关联病程的高危红旗挂到新病程上（红旗不被流程顺序绕过） */
  attachUnlinkedEvents(userId: string, episodeId: string): number {
    const res = this.db.app
      .prepare(
        `UPDATE safety_event SET episode_id = ? WHERE user_id = ? AND episode_id IS NULL AND severity = 'high'`,
      )
      .run(episodeId, userId);
    return Number(res.changes ?? 0);
  }

  private recordEvent(userId: string, episodeId: string | undefined, m: MatchedRule): void {
    this.db.app
      .prepare(
        `INSERT INTO safety_event (id, user_id, episode_id, rule_code, severity, action_taken, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(randomUUID(), userId, episodeId ?? null, m.rule_code, m.severity, m.action, new Date().toISOString());
  }
}

/** 命中红旗时抛出的异常（附带安全提示，供控制器转成 409 + 提示内容） */
export function safetyException(result: SafetyResult): ApiException {
  const high = result.matched.find((m) => m.severity === 'high') ?? result.matched[0];
  return new ApiException(
    result.safety_flag === 'stop_personal' ? ErrorCode.SAFETY_STOP_PERSONAL : ErrorCode.SAFETY_SEEK_CARE,
    high?.advice ?? '检测到需要及时就医的信号，请尽快就医',
  );
}

export type { RedFlagRule, ScopeRule };
export { normalizeSafetyText };
