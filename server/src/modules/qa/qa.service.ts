import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DbService } from '../../db/db.service';
import { ApiException, ErrorCode } from '../../common/api-error';
import { SafetyResult, SafetyService } from '../safety/safety.service';
import { LocalEvidenceRetriever } from '../evidence/evidence-retrieval';
import {
  QA_DISCLAIMER,
  QaAnswer,
  QaCitation,
  REASSURANCE_REPLY,
  REASSURANCE_STREAK,
  buildQaAnswer,
  isReassurance,
} from './qa-answer';

/**
 * 问与解释服务（/qa/sessions，App A09 / Web W04）。
 * 流程：保存用户提问 → 安全规则引擎（红旗优先，命中即就医提示并停止本轮解释）
 *       → 服务范围校验（诊断 / 手术 / 用药越界明确不答，可一键加入复诊问题）
 *       → 反复求保证检测（连续 ≥3 次给出稳定解释并结束本轮）
 *       → 基于当前上下文（最新一页分析 + 关联 episode 病程原文 + 证据库）生成本地回答。
 * 消息落库 qa_message（role / content / citations / refused / followup_question）。
 */

interface SessionRow {
  id: string;
  user_id: string;
  episode_id: string | null;
  created_at: string;
}

type MessageRow = {
  id: string;
  session_id: string;
  role: string;
  content: string;
  citations: string | null;
  refused: number;
  followup_question: string | null;
  created_at: string;
};

export interface QaMessageView {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations: QaCitation[];
  refused: boolean;
  followup_question: string | null;
  /** 是否可一键加入复诊问题（越界拒答时提供） */
  add_to_followup: boolean;
  created_at: string;
}

export interface QaSessionListItem {
  id: string;
  episode_id: string | null;
  created_at: string;
  message_count: number;
  last_message: { role: string; content: string; created_at: string } | null;
}

export interface QaSessionDetail {
  id: string;
  episode_id: string | null;
  created_at: string;
  messages: QaMessageView[];
}

export interface AskResult {
  session_id: string;
  user_message_id: string;
  message_id: string;
  reply: string;
  refused: boolean;
  followup_question: string | null;
  add_to_followup: boolean;
  close_round: boolean;
  citations: QaCitation[];
  safety_notice: null;
  disclaimer: string;
  context: {
    episode_id: string | null;
    analysis_id: string | null;
    analysis_version: number | null;
  };
}

export interface QaCloseResult {
  session_id: string;
  episode_id: string | null;
  closed: boolean;
  closed_at: string;
  round_summary: {
    question_count: number;
    answer_count: number;
    refused_count: number;
    followup_questions: string[];
    citation_count: number;
    summary_text: string;
  };
  disclaimer: string;
}

/** 就医提示内容（结构与 SafetyNoticeController.emergencyNotice / 分析就医提示一致，附带 matched） */
interface QaSafetyNotice {
  title: string;
  headline: string;
  body: string;
  matched: {
    rule_code: string;
    label: string;
    severity: string;
    action: string;
    advice: string;
    excerpt: string;
  }[];
  actions: { type: string; label: string }[];
  bring_list: string[];
  footer_note: string;
  rule_set_version: string;
}

@Injectable()
export class QaService {
  private readonly logger = new Logger('Qa');

  constructor(
    private readonly db: DbService,
    private readonly safety: SafetyService,
  ) {}

  // ---------- 会话 ----------

  /** 创建会话（可关联 episode）；episode 必须是本人的 */
  create(userId: string, input: { episode_id?: string | null }): QaSessionListItem {
    const episodeId = input.episode_id?.trim() || null;
    if (episodeId) this.ownedEpisode(userId, episodeId);
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db.app
      .prepare(`INSERT INTO qa_session (id, user_id, episode_id, created_at) VALUES (?, ?, ?, ?)`)
      .run(id, userId, episodeId, now);
    this.logger.log(`[qa] 创建会话 ${id}${episodeId ? `（episode ${episodeId}）` : ''}`);
    return { id, episode_id: episodeId, created_at: now, message_count: 0, last_message: null };
  }

  /** 当前用户的会话历史（含最近一条消息摘要与时间） */
  list(userId: string): QaSessionListItem[] {
    const rows = this.db.app
      .prepare(
        `SELECT s.id, s.episode_id, s.created_at,
                (SELECT COUNT(*) FROM qa_message m WHERE m.session_id = s.id) AS message_count,
                (SELECT m.role FROM qa_message m WHERE m.session_id = s.id
                  ORDER BY m.created_at DESC, m.rowid DESC LIMIT 1) AS last_role,
                (SELECT m.content FROM qa_message m WHERE m.session_id = s.id
                  ORDER BY m.created_at DESC, m.rowid DESC LIMIT 1) AS last_content,
                (SELECT m.created_at FROM qa_message m WHERE m.session_id = s.id
                  ORDER BY m.created_at DESC, m.rowid DESC LIMIT 1) AS last_at
         FROM qa_session s WHERE s.user_id = ? ORDER BY s.created_at DESC, s.rowid DESC`,
      )
      .all(userId) as {
      id: string;
      episode_id: string | null;
      created_at: string;
      message_count: number;
      last_role: string | null;
      last_content: string | null;
      last_at: string | null;
    }[];
    return rows.map((r) => ({
      id: r.id,
      episode_id: r.episode_id ?? null,
      created_at: r.created_at,
      message_count: r.message_count ?? 0,
      last_message:
        r.last_content && r.last_at
          ? {
              role: r.last_role ?? 'assistant',
              content: excerpt(r.last_content),
              created_at: r.last_at,
            }
          : null,
    }));
  }

  /** 会话详情与全部消息（含 citations、是否拒答、是否带复诊问题） */
  get(userId: string, sessionId: string): QaSessionDetail {
    const session = this.ownedSession(userId, sessionId);
    return {
      id: session.id,
      episode_id: session.episode_id ?? null,
      created_at: session.created_at,
      messages: this.messagesOf(sessionId),
    };
  }

  // ---------- 提问与回答 ----------

  ask(userId: string, sessionId: string, content: string): AskResult {
    const question = (content ?? '').trim();
    if (!question) {
      throw new ApiException(ErrorCode.BAD_REQUEST, '提问内容不能为空');
    }
    const session = this.ownedSession(userId, sessionId);

    // 1. 用户消息落库
    const userMessageId = this.insertMessage(sessionId, 'user', question, null, false, null);

    // 2. 安全规则引擎：红旗优先（命中即就医提示，本轮不再生成解释；消息仍保存为系统提示）
    const safety = this.safety.evaluateQuestion(question, userId);
    if (safety.matched.length > 0) {
      const notice = this.buildNotice(safety);
      this.insertMessage(sessionId, 'assistant', notice.body, null, false, null);
      const high = safety.matched.find((m) => m.severity === 'high') ?? safety.matched[0];
      this.logger.warn(
        `[qa] 会话 ${sessionId} 命中红旗 ${safety.matched.map((m) => m.rule_code).join(',')}，本轮不生成解释`,
      );
      throw new ApiException(
        safety.safety_flag === 'stop_personal'
          ? ErrorCode.SAFETY_STOP_PERSONAL
          : ErrorCode.SAFETY_SEEK_CARE,
        high?.advice ?? '检测到需要及时就医的信号，请尽快就医',
        notice,
      );
    }

    // 3. 服务范围校验：诊断 / 手术 / 用药越界 → 明确不答（不加载分析上下文，直接拒答）
    if (safety.out_of_scope) {
      const oos = safety.out_of_scope;
      const messageId = this.insertMessage(
        sessionId,
        'assistant',
        oos.reply,
        [],
        true,
        oos.followup_question,
      );
      this.logger.log(`[qa] 会话 ${sessionId} 越界拒答（${oos.rule_code} ${oos.category}）`);
      return {
        session_id: sessionId,
        user_message_id: userMessageId,
        message_id: messageId,
        reply: oos.reply,
        refused: true,
        followup_question: oos.followup_question,
        add_to_followup: true,
        close_round: false,
        citations: [],
        safety_notice: null,
        disclaimer: QA_DISCLAIMER,
        context: {
          episode_id: session.episode_id ?? null,
          analysis_id: null,
          analysis_version: null,
        },
      };
    }

    // 4. 反复求保证：同一会话内连续 ≥3 次求保证类问题 → 稳定解释并结束本轮
    if (this.reassuranceStreak(sessionId) >= REASSURANCE_STREAK) {
      const reply = `${REASSURANCE_REPLY}\n\n${QA_DISCLAIMER}`;
      const messageId = this.insertMessage(sessionId, 'assistant', reply, [], false, null);
      this.logger.log(`[qa] 会话 ${sessionId} 连续求保证，结束本轮`);
      return {
        session_id: sessionId,
        user_message_id: userMessageId,
        message_id: messageId,
        reply,
        refused: false,
        followup_question: null,
        add_to_followup: false,
        close_round: true,
        citations: [],
        safety_notice: null,
        disclaimer: QA_DISCLAIMER,
        context: {
          episode_id: session.episode_id ?? null,
          analysis_id: null,
          analysis_version: null,
        },
      };
    }

    // 5. 正常回答：基于当前上下文（最新一页分析 sections + 关联 episode 的 care_event 原文）
    const { answer, context } = this.generate(session, question);
    const messageId = this.insertMessage(sessionId, 'assistant', answer.reply, answer.citations, false, null);
    return {
      session_id: sessionId,
      user_message_id: userMessageId,
      message_id: messageId,
      reply: answer.reply,
      refused: false,
      followup_question: null,
      add_to_followup: false,
      close_round: false,
      citations: answer.citations,
      safety_notice: null,
      disclaimer: QA_DISCLAIMER,
      context,
    };
  }

  /** 结束本轮（用户主动结束）：返回本轮小结 */
  close(userId: string, sessionId: string): QaCloseResult {
    const session = this.ownedSession(userId, sessionId);
    const messages = this.messagesOf(sessionId);
    const userMessages = messages.filter((m) => m.role === 'user');
    const assistantMessages = messages.filter((m) => m.role === 'assistant');
    const refusedCount = assistantMessages.filter((m) => m.refused).length;
    const followupQuestions = [
      ...new Set(
        assistantMessages
          .map((m) => m.followup_question)
          .filter((q): q is string => typeof q === 'string' && q.length > 0),
      ),
    ];
    const citationCount = assistantMessages.reduce((n, m) => n + m.citations.length, 0);
    const summaryText =
      `本轮共提问 ${userMessages.length} 次，回答 ${assistantMessages.length} 次；` +
      `其中 ${refusedCount} 次属于诊断 / 手术 / 用药范围，未作回答；` +
      `待加入复诊的问题 ${followupQuestions.length} 个。以上为系统整理的本轮小结，仅供参考，不作诊断。`;
    this.logger.log(`[qa] 会话 ${sessionId} 结束本轮（提问 ${userMessages.length} 次）`);
    return {
      session_id: sessionId,
      episode_id: session.episode_id ?? null,
      closed: true,
      closed_at: new Date().toISOString(),
      round_summary: {
        question_count: userMessages.length,
        answer_count: assistantMessages.length,
        refused_count: refusedCount,
        followup_questions: followupQuestions,
        citation_count: citationCount,
        summary_text: summaryText,
      },
      disclaimer: QA_DISCLAIMER,
    };
  }

  // ---------- 内部 ----------

  /** 生成回答：最新一页分析 + 关联 episode 病程原文 + 证据库受控检索 */
  private generate(
    session: SessionRow,
    question: string,
  ): { answer: QaAnswer; context: AskResult['context'] } {
    const analysis = this.latestAnalysis(session.user_id, session.episode_id);
    const episodeId = session.episode_id ?? analysis?.episode_id ?? null;
    const events = episodeId ? this.episodeEvents(episodeId) : [];
    // 证据库受控检索（收敛到 evidence 模块，只检索启用中的证据文档）
    const evidence = new LocalEvidenceRetriever(this.db.app).search(question, 5).results;
    const answer = buildQaAnswer({
      question,
      evidence,
      analysis: analysis
        ? { id: analysis.id, version: analysis.version, explain: analysis.explain }
        : null,
      events,
    });
    return {
      answer,
      context: {
        episode_id: episodeId,
        analysis_id: analysis?.id ?? null,
        analysis_version: analysis?.version ?? null,
      },
    };
  }

  /** 同一会话内连续（末尾）的求保证类用户提问数 */
  private reassuranceStreak(sessionId: string): number {
    const rows = this.db.app
      .prepare(
        `SELECT content FROM qa_message WHERE session_id=? AND role='user'
         ORDER BY created_at DESC, rowid DESC`,
      )
      .all(sessionId) as { content: string }[];
    let n = 0;
    for (const r of rows) {
      if (!isReassurance(r.content)) break;
      n += 1;
    }
    return n;
  }

  /** 最新一次一页分析：优先会话关联的 episode，否则该用户最新一次 */
  private latestAnalysis(
    userId: string,
    episodeId: string | null,
  ): { id: string; version: number; episode_id: string; explain: { text: string }[] } | null {
    const sql = episodeId
      ? `SELECT a.id, a.version, a.episode_id, a.sections FROM analysis a
         JOIN episode e ON e.id = a.episode_id
         WHERE e.user_id = ? AND a.episode_id = ? ORDER BY a.created_at DESC LIMIT 1`
      : `SELECT a.id, a.version, a.episode_id, a.sections FROM analysis a
         JOIN episode e ON e.id = a.episode_id
         WHERE e.user_id = ? ORDER BY a.created_at DESC LIMIT 1`;
    const row = (episodeId
      ? this.db.app.prepare(sql).get(userId, episodeId)
      : this.db.app.prepare(sql).get(userId)) as
      | { id: string; version: number; episode_id: string; sections: string | null }
      | undefined;
    if (!row) return null;
    const sections = row.sections ? parseJson(row.sections) : null;
    const rawExplain = (sections as { explain?: unknown } | null)?.explain;
    const explain: { text: string }[] = Array.isArray(rawExplain)
      ? rawExplain
          .map((e) => {
            const text = (e as { text?: unknown } | null)?.text;
            return { text: typeof text === 'string' ? text : '' };
          })
          .filter((e) => e.text.length > 0)
      : [];
    return { id: row.id, version: row.version, episode_id: row.episode_id, explain };
  }

  /** 关联 episode 的病程事件原文（回答的确定性上下文） */
  private episodeEvents(episodeId: string): {
    id: string;
    event_type: string;
    source_type: string;
    raw_text: string | null;
  }[] {
    return this.db.app
      .prepare(
        `SELECT id, event_type, source_type, raw_text FROM care_event
         WHERE episode_id=? ORDER BY occurred_at ASC, rowid ASC`,
      )
      .all(episodeId) as {
      id: string;
      event_type: string;
      source_type: string;
      raw_text: string | null;
    }[];
  }

  private messagesOf(sessionId: string): QaMessageView[] {
    const rows = this.db.app
      .prepare(
        `SELECT id, session_id, role, content, citations, refused, followup_question, created_at
         FROM qa_message WHERE session_id=? ORDER BY created_at ASC, rowid ASC`,
      )
      .all(sessionId) as MessageRow[];
    return rows.map((r) => this.messageView(r));
  }

  private messageView(row: MessageRow): QaMessageView {
    const citations = row.citations ? parseJson(row.citations) : null;
    const refused = row.refused === 1;
    const followup = row.followup_question ?? null;
    return {
      id: row.id,
      role: row.role === 'user' ? 'user' : 'assistant',
      content: row.content,
      citations: Array.isArray(citations) ? (citations as QaCitation[]) : [],
      refused,
      followup_question: followup,
      add_to_followup: refused && Boolean(followup),
      created_at: row.created_at,
    };
  }

  private insertMessage(
    sessionId: string,
    role: 'user' | 'assistant',
    content: string,
    citations: QaCitation[] | null,
    refused: boolean,
    followupQuestion: string | null,
  ): string {
    const id = randomUUID();
    this.db.app
      .prepare(
        `INSERT INTO qa_message (id, session_id, role, content, citations, refused, followup_question, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        sessionId,
        role,
        content,
        citations ? JSON.stringify(citations) : null,
        refused ? 1 : 0,
        followupQuestion,
        new Date().toISOString(),
      );
    return id;
  }

  /** 就医提示（结构与 SafetyNoticeController.emergencyNotice 一致，附带 matched 规则） */
  private buildNotice(result: SafetyResult): QaSafetyNotice {
    const high = result.matched.find((m) => m.severity === 'high');
    const labels = result.matched.map((m) => m.label);
    return {
      title: '需要及时寻求专业帮助',
      headline: high ? '建议尽快就医' : '建议及时就医评估',
      body: `你的提问包含需要${high ? '尽快' : '及时'}就医的信号：${labels.join('、')}。这类变化需要医生及时评估，本产品无法替你判断严重程度，本轮不再生成解释。`,
      matched: result.matched.map((m) => ({
        rule_code: m.rule_code,
        label: m.label,
        severity: m.severity,
        action: m.action,
        advice: m.advice,
        excerpt: m.excerpt,
      })),
      actions: [
        { type: 'call', label: '拨打 120 / 前往急诊' },
        { type: 'hospital', label: '查找附近医院' },
        { type: 'doctor', label: '联系我的主治医生（已保存）' },
      ],
      bring_list: ['已录入的检查报告原文', '症状开始时间与最近变化记录', '正在使用的药物与既有医嘱'],
      footer_note: '此提示由临床审定规则触发，不是诊断结论；请以医生的评估为准。',
      rule_set_version: result.rule_set_version,
    };
  }

  private ownedSession(userId: string, sessionId: string): SessionRow {
    const row = this.db.app.prepare('SELECT * FROM qa_session WHERE id=?').get(sessionId) as
      | SessionRow
      | undefined;
    if (!row || row.user_id !== userId) {
      throw new ApiException(ErrorCode.NOT_FOUND, '会话不存在');
    }
    return row;
  }

  private ownedEpisode(userId: string, episodeId: string): void {
    const ep = this.db.app.prepare('SELECT id, user_id FROM episode WHERE id=?').get(episodeId) as
      | { id: string; user_id: string }
      | undefined;
    if (!ep || ep.user_id !== userId) {
      throw new ApiException(ErrorCode.NOT_FOUND, '病程不存在');
    }
  }
}

/** 列表中的消息摘要（截断，避免整段原文撑爆列表） */
function excerpt(content: string, max = 60): string {
  const text = content.replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
