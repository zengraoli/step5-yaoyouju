import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DbService } from '../../db/db.service';
import { FieldCrypto } from '../../db/crypto.service';
import { ApiException, ErrorCode } from '../../common/api-error';
import { AuditService } from '../../common/audit.service';
import { RULE_SET_VERSION } from '../safety/safety.rules';
import { AdminContext } from '../admin/admin-auth.service';
import { permissionsOf } from '../admin/admin.constants';
import { ConfirmationService } from '../admin/confirmation.service';

/**
 * 反馈与质量服务（/feedback + /admin/feedback，App A16 / Web W08 / 后台 B06）。
 *
 * 产品红线（docs/brief.md 第 5 条）：
 * 1. 反馈与举报**不自动进入训练或内容库**——本服务只写 feedback / feedback_handling 表，
 *    没有任何向 content_item / content_version / evidence_doc / evidence_chunk / 模型训练相关表写入的逻辑；
 * 2. 查看用户原始内容需**单条授权**——未授权时详情只返回「未授权，不可查看」，
 *    授权记录授权人、时间与范围并写审计日志（只追加）。
 *
 * 错误举报自动附带四类版本（B06）：分析版本、模型版本、内容版本、规则集版本。
 */

/** 帮助类型反馈的三种取值（App A16） */
export const HELP_TYPES = ['看懂了', '知道下一步', '都不好'] as const;
export type HelpType = (typeof HELP_TYPES)[number];

/** 初筛结论（运营编辑 / 超级管理可做，不看原文） */
export const TRIAGE_ACTIONS = ['待临床复核', '无需处理', '关闭'] as const;

/** 举报分类（示例值，允许其他中文描述） */
export const REPORT_CATEGORIES = ['解释与报告不符', '来源缺失', '内容出错', '其他'] as const;

/** 严重度：high=可能造成健康风险/安全相关；medium=解释与报告不符/来源问题；low=其他 */
export const SEVERITIES = ['high', 'medium', 'low'] as const;
export type Severity = (typeof SEVERITIES)[number];

/** 严重度排序权重（队列按 high > medium > low 排序） */
export const SEVERITY_ORDER: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

/** 分类 → 建议严重度（用户未显式指定 severity 时按此分级） */
const CATEGORY_SEVERITY: Record<string, Severity> = {
  解释与报告不符: 'medium',
  来源缺失: 'medium',
  内容出错: 'low',
  其他: 'low',
};

/** 处置动作（B06） */
export const HANDLING_ACTIONS = ['转内容修正', '转模型复盘', '已回复用户', '无需处理', '关闭'] as const;
export type HandlingAction = (typeof HANDLING_ACTIONS)[number];

/** 处置动作 → 反馈处理状态 */
const ACTION_TO_STATUS: Record<HandlingAction, string> = {
  转内容修正: '处理中',
  转模型复盘: '处理中',
  已回复用户: '已处理',
  无需处理: '无需处理',
  关闭: '已关闭',
};

/** 处理状态（帮助类型反馈固定为「已收到」，不进举报处置队列） */
export const FEEDBACK_STATUSES = ['已收到', '待处理', '处理中', '已处理', '无需处理', '已关闭'] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

/** 未授权时用户原始内容的占位文案（单条授权后才返回真实内容） */
export const UNAUTHORIZED_RAW_CONTENT = '未授权，不可查看';

/** 产品红线标注：随返回结构明确告知前端与调用方 */
export const FEEDBACK_REDLINE = {
  auto_ingest: false,
  note: '反馈与举报仅用于产品改进，不自动进入训练或内容库',
} as const;

/** 四类版本快照（report_meta JSON） */
export interface ReportVersions {
  /** 分析版本：analysis.version */
  analysis_version: number | null;
  analysis_id: string | null;
  /** 模型版本：model_release 的 model_name + prompt_version */
  model: { model_release_id: string; model_name: string; prompt_version: string } | null;
  /** 内容版本：content_item.current_status + 当前 content_version.version */
  content: { content_item_id: string; current_status: string; version: number | null } | null;
  /** 规则集版本：安全规则引擎 RULE_SET_VERSION */
  rule_set_version: string;
}

/** 用户原始内容快照（授权后可见） */
export interface RawContentSnapshot {
  /** 用户录入原文（自述 / 报告原文 / 医生记录） */
  records: { source_type: string; occurred_at: string; raw_text: string }[];
  /** 被举报内容（内容举报时） */
  reported_content: {
    type: 'content_item';
    id: string;
    title: string;
    current_status: string;
    script: string | null;
  } | null;
  note: string;
}

export interface CreateHelpFeedbackInput {
  analysis_id: string;
  help_type: HelpType;
  unsolved_question?: string;
}

export interface CreateErrorReportInput {
  analysis_id?: string;
  content_item_id?: string;
  category: string;
  description: string;
  severity?: Severity;
}

export interface AuthorizeViewInput {
  scope?: string;
}

export interface HandleFeedbackInput {
  action: HandlingAction;
  comment: string;
}

export interface FeedbackQueueQuery {
  /** 类型筛选：feedback=帮助类型反馈；error_report=错误举报 */
  type?: string;
  /** 状态筛选（见 FEEDBACK_STATUSES） */
  status?: string;
}

/** 列表项（用户端 /feedback/mine） */
export interface FeedbackView {
  id: string;
  type: 'feedback' | 'error_report';
  analysis_id: string | null;
  content_item_id: string | null;
  help_type: string | null;
  unsolved_question: string | null;
  category: string | null;
  description: string | null;
  severity: string | null;
  status: string;
  /** 四类版本（仅错误举报） */
  versions: ReportVersions | null;
  created_at: string;
  redline: { readonly auto_ingest: false; readonly note: string };
}

/** 队列项（后台 B06）：附带四类版本与受影响范围 */
export interface FeedbackQueueItem extends FeedbackView {
  /** 受影响范围：看到该分析 / 引用该内容的用户（演示实现：脱敏手机号） */
  affected_users: { user_id: string; phone_masked: string }[];
}

/** 后台详情 */
export interface FeedbackDetail extends FeedbackQueueItem {
  /** 用户原始内容：未授权时返回「未授权，不可查看」 */
  raw_content: RawContentSnapshot | typeof UNAUTHORIZED_RAW_CONTENT;
  authorization: {
    authorized: boolean;
    by: string | null;
    at: string | null;
    scope: string | null;
  };
  handling: {
    id: string;
    action: string;
    comment: string | null;
    actor_id: string | null;
    created_at: string;
  }[];
  redline: { readonly auto_ingest: false; readonly note: string };
}

type FeedbackRow = {
  id: string;
  user_id: string | null;
  analysis_id: string | null;
  content_item_id: string | null;
  help_type: string | null;
  unsolved_question: string | null;
  is_error_report: number;
  category: string | null;
  description: string | null;
  severity: string | null;
  status: string;
  report_meta: string | null;
  raw_content: string | null;
  authorized_by: string | null;
  authorized_at: string | null;
  authorize_scope: string | null;
  authorize_expires_at: string | null;
  authorize_revoked_at: string | null;
  approve_by: string | null;
  created_at: string;
};

type AnalysisRow = {
  id: string;
  episode_id: string;
  version: number;
  model_release_id: string | null;
};

type ContentItemRow = {
  id: string;
  title: string;
  current_status: string;
};

/** 单条授权有效期：7 天（到期自动失效，可提前撤回） */
export const AUTHORIZE_TTL_DAYS = 7;
const AUTHORIZE_TTL_MS = AUTHORIZE_TTL_DAYS * 24 * 3600 * 1000;

/** 文本里的完整手机号脱敏（后台任一角色都不应看到） */
function maskPhone(text: string): string {
  return text.replace(/(1[3-9]\d)\d{4}(\d{4})/g, '$1****$2');
}

/** 用户原始内容里的手机号脱敏（后台拿到授权也不应看到完整手机号） */
function maskSensitive<T>(value: T): T {
  const json = JSON.stringify(value) ?? '""';
  const masked = json.replace(/(1[3-9]\d)\d{4}(\d{4})/g, '$1****$2');
  return JSON.parse(masked) as T;
}

@Injectable()
export class FeedbackService {
  private readonly logger = new Logger('Feedback');

  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly confirmations: ConfirmationService,
  ) {}

  // ---------- 用户端（App A16 / Web W08） ----------

  /**
   * 帮助类型反馈：看懂了 / 知道下一步 / 都不好 + 未解决的问题。
   * 落库 feedback（is_error_report=0），不进入任何训练或内容库。
   */
  createHelpFeedback(userId: string, input: CreateHelpFeedbackInput): FeedbackView {
    const helpType = (input.help_type ?? '').trim();
    if (!HELP_TYPES.includes(helpType as HelpType)) {
      throw new ApiException(ErrorCode.BAD_REQUEST, `帮助类型必须是：${HELP_TYPES.join(' / ')}`);
    }
    const analysis = this.ownedAnalysis(userId, input.analysis_id);
    const id = randomUUID();
    const now = new Date().toISOString();
    const question = input.unsolved_question?.trim() || null;
    this.db.app
      .prepare(
        `INSERT INTO feedback (id, user_id, analysis_id, help_type, unsolved_question, is_error_report, status, created_at)
         VALUES (?, ?, ?, ?, ?, 0, '已收到', ?)`,
      )
      .run(id, userId, analysis.id, helpType, question, now);
    this.audit.append(userId, 'feedback.create', `feedback:${id}`, {
      help_type: helpType,
      analysis_id: analysis.id,
    });
    this.logger.log(`[feedback] 用户提交帮助类型反馈 ${id}（${helpType}，analysis ${analysis.id}）`);
    return this.view(this.load(id));
  }

  /**
   * 错误举报：落库 feedback（is_error_report=1），自动附带四类版本
   * （分析版本 / 模型版本 / 内容版本 / 规则集版本），并快照用户原始内容（授权后可见）。
   * 举报与反馈不自动进入训练或内容库（产品红线）。
   */
  createErrorReport(userId: string, input: CreateErrorReportInput): FeedbackView {
    const analysisId = input.analysis_id?.trim() || null;
    const contentItemId = input.content_item_id?.trim() || null;
    if (!analysisId && !contentItemId) {
      throw new ApiException(ErrorCode.BAD_REQUEST, '请选择要举报的分析或内容');
    }
    const description = (input.description ?? '').trim();
    if (!description) {
      throw new ApiException(ErrorCode.BAD_REQUEST, '请填写举报说明');
    }
    const category = (input.category ?? '').trim();
    if (!category) {
      throw new ApiException(ErrorCode.BAD_REQUEST, '请选择举报分类');
    }
    // 分析必须存在且属于当前用户（越权举报按不存在处理）
    const analysis = analysisId ? this.ownedAnalysis(userId, analysisId) : null;
    // 内容举报：内容必须存在（已下线 / 已撤回的内容同样允许举报）
    const content = contentItemId ? this.loadContentItem(contentItemId) : null;

    const severityInput = (input.severity ?? '').trim();
    if (severityInput && !SEVERITIES.includes(severityInput as Severity)) {
      throw new ApiException(ErrorCode.BAD_REQUEST, `严重度必须是：${SEVERITIES.join(' / ')}`);
    }
    const severity: Severity = severityInput
      ? (severityInput as Severity)
      : (CATEGORY_SEVERITY[category] ?? 'low');

    const versions = this.buildVersions(analysis, content);
    const rawContent = this.snapshotRawContent(analysis, content);

    const id = randomUUID();
    const now = new Date().toISOString();
    this.db.app
      .prepare(
        `INSERT INTO feedback
           (id, user_id, analysis_id, content_item_id, help_type, unsolved_question, is_error_report,
            category, description, severity, status, report_meta, raw_content, created_at)
         VALUES (?, ?, ?, ?, NULL, NULL, 1, ?, ?, ?, '待处理', ?, ?, ?)`,
      )
      .run(
        id,
        userId,
        analysis?.id ?? null,
        content?.id ?? null,
        category,
        description,
        severity,
        JSON.stringify(versions),
        JSON.stringify(rawContent),
        now,
      );
    this.audit.append(userId, 'feedback.create_report', `feedback:${id}`, {
      category,
      severity,
      analysis_id: analysis?.id ?? null,
      content_item_id: content?.id ?? null,
      versions,
    });
    this.logger.log(
      `[feedback] 用户提交错误举报 ${id}（${category}，severity=${severity}，analysis ${analysis?.id ?? '-'}，content ${content?.id ?? '-'}）`,
    );
    return this.view(this.load(id));
  }

  /** 我提交的反馈与举报列表（含处理状态；不含他人反馈） */
  listMine(userId: string): FeedbackView[] {
    const rows = this.db.app
      .prepare(`SELECT * FROM feedback WHERE user_id=? ORDER BY created_at DESC, rowid DESC`)
      .all(userId) as FeedbackRow[];
    return rows.map((r) => this.view(r));
  }

  /** 单条反馈 / 举报详情（仅本人；他人反馈一律 404） */
  detailMine(userId: string, id: string): FeedbackDetail {
    const row = this.load(id);
    if (row.user_id !== userId) {
      throw new ApiException(ErrorCode.NOT_FOUND, '反馈不存在');
    }
    return {
      ...this.queueItem(row),
      raw_content: this.rawContentOf(row),
      authorization: this.authorizationOf(row),
      handling: this.handlingRecords(id),
      redline: FEEDBACK_REDLINE,
    };
  }

  /**
   * 队列统计（B06 顶部卡片）：待处理 / 临床复核中 / 已关闭，以及平均处理时长。
   * 平均值由 feedback_handling 的首条处置记录与反馈创建时间差算出（没有记录时为 null）。
   */
  stats() {
    const rows = this.db.app
      .prepare(`SELECT severity, status FROM feedback WHERE is_error_report = 1`)
      .all() as { severity: string | null; status: string }[];
    const closedStatuses = ['已关闭', '无需处理', '已处理'];
    const pending = rows.filter((r) => !closedStatuses.includes(r.status));
    const handled = this.db.app
      .prepare(
        `SELECT f.created_at AS created_at, MIN(h.created_at) AS handled_at
         FROM feedback f JOIN feedback_handling h ON h.feedback_id = f.id
         GROUP BY f.id`,
      )
      .all() as { created_at: string; handled_at: string }[];
    const avgDays = (min: number, max: number): number | null => {
      const slice = handled.filter((r) => {
        const d = (new Date(r.handled_at).getTime() - new Date(r.created_at).getTime()) / (24 * 3600 * 1000);
        return d >= min && d < max;
      });
      if (slice.length === 0) return null;
      return (
        Math.round(
          (slice.reduce(
            (sum, r) => sum + (new Date(r.handled_at).getTime() - new Date(r.created_at).getTime()),
            0,
          ) /
            slice.length /
            (24 * 3600 * 1000)) *
            10,
        ) / 10
      );
    };
    return {
      pending: pending.length,
      pending_high: pending.filter((r) => r.severity === 'high').length,
      pending_medium: pending.filter((r) => r.severity === 'medium').length,
      pending_low: pending.filter((r) => r.severity === 'low').length,
      reviewing: rows.filter((r) => r.status === '临床复核中').length,
      closed: rows.filter((r) => closedStatuses.includes(r.status)).length,
      avg_review_days: avgDays(0, 7),
      avg_closed_days: avgDays(7, 365),
    };
  }

  // ---------- 后台（B06；T35 复用；登录鉴权完善留待 T14 / T35） ----------

  /**
   * 举报与反馈队列：按严重度分级排序（high > medium > low，帮助类型反馈排最后），
   * 支持按类型（feedback / error_report）与状态筛选；每条自动附带四类版本与受影响范围。
   *
   * 注意：后台登录鉴权（账号 + TOTP + 角色权限）在 T14 / T35 实现，
   * 本任务先用全局登录守卫占位（见 AdminFeedbackController 注释）。
   */
  queue(query: FeedbackQueueQuery = {}): FeedbackQueueItem[] {
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (query.type === 'feedback' || query.type === 'error_report') {
      where.push('is_error_report = ?');
      params.push(query.type === 'error_report' ? 1 : 0);
    }
    if (query.status) {
      where.push('status = ?');
      params.push(query.status);
    }
    const sql = `SELECT * FROM feedback${
      where.length ? ' WHERE ' + where.join(' AND ') : ''
    }
      ORDER BY CASE severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 WHEN 'low' THEN 2 ELSE 3 END,
               created_at DESC, rowid DESC`;
    const rows = this.db.app.prepare(sql).all(...params) as FeedbackRow[];
    return rows.map((r) => this.queueItem(r));
  }

  /**
   * 后台详情：四类版本、受影响范围、处理记录。
   * 用户原始内容默认隐藏（「未授权，不可查看」），单条授权后可见。
   */
  detail(id: string, actorId?: string, canViewRaw = true): FeedbackDetail {
    const row = this.load(id);
    // 每次读取举报详情都写审计（B10「每次读取写审计」；验收反馈第 32 条）
    if (actorId) {
      this.audit.append(actorId, 'feedback.read', `feedback:${id}`, { severity: row.severity });
    }
    return {
      ...this.queueItem(row),
      raw_content: canViewRaw ? this.rawContentOf(row) : UNAUTHORIZED_RAW_CONTENT,
      authorization: this.authorizationOf(row),
      handling: this.handlingRecords(id),
      redline: FEEDBACK_REDLINE,
    };
  }

  /**
   * 单条授权查看用户原始内容：临床审核发起 → 超级管理员审批后生效。
   * - 授权仅对本条举报生效，不是全局授权；
   * - 有效期 7 天，到期自动失效；
   * - 可随时撤回；每次授权 / 撤回 / 读取都写审计（只追加）。
   */
  authorizeView(
    id: string,
    actorId: string,
    input: AuthorizeViewInput & { confirmation_id?: string } = {},
  ): FeedbackDetail {
    const row = this.load(id);
    const nowDate = new Date();
    const now = nowDate.toISOString();
    const scope = input.scope?.trim() || '本条举报的用户原始内容';
    const gate = this.confirmations.prepare(
      'feedback.authorize',
      id,
      `举报原文 #${id.slice(0, 6)} · ${row.severity || '举报'}`,
      input.confirmation_id ? '另一人已确认的单条授权：' + scope : '单条授权：' + scope,
      this.adminById(actorId),
      input.confirmation_id,
      { scope },
    );
    if (!gate.proceed) {
      throw new ApiException(
        ErrorCode.CONFLICT,
        '已提交「举报原文单条授权」申请（需' +
          (gate.confirmation?.requirement ?? '超级管理员') +
          '审批后生效，' +
          AUTHORIZE_TTL_DAYS +
          ' 天后自动失效）',
        { confirmation_id: gate.confirmation?.id ?? null, requirement: gate.confirmation?.requirement ?? null },
      );
    }
    // 以申请时的授权范围为准，忽略确认人请求里的范围
    const effScope =
      gate.confirmation && typeof gate.confirmation.payload.scope === 'string' && gate.confirmation.payload.scope.trim()
        ? gate.confirmation.payload.scope
        : scope;
    const expiresAt = new Date(nowDate.getTime() + AUTHORIZE_TTL_MS).toISOString();
    this.db.app
      .prepare(
        `UPDATE feedback SET authorized_by=?, authorized_at=?, authorize_scope=?, authorize_expires_at=?, authorize_revoked_at=NULL WHERE id=?`,
      )
      .run(gate.confirmation!.requested_by, now, effScope, expiresAt, id);
    this.db.app.prepare('UPDATE feedback SET approve_by = ? WHERE id = ?').run(actorId, id);
    this.audit.append(actorId, 'feedback.authorize_view', `feedback:${id}`, {
      requested_by: gate.confirmation!.requested_by,
      approved_by: actorId,
      scope: effScope,
      severity: row.severity,
      authorized_at: now,
      expires_at: expiresAt,
      confirmation_id: gate.confirmation?.id ?? null,
    });
    this.logger.log(`[feedback] ${actorId} 单条授权查看举报 ${id} 的用户原始内容（范围：${effScope}）`);
    if (gate.confirmation) this.confirmations.markApplied(gate.confirmation.id);
    return this.detail(id, actorId);
  }

  /** 撤回单条授权（立即生效，写审计） */
  revokeAuthorization(id: string, actorId: string): FeedbackDetail {
    const row = this.load(id);
    if (!row.authorized_at) {
      throw new ApiException(ErrorCode.CONFLICT, '该举报还没有单条授权记录');
    }
    this.db.app
      .prepare(`UPDATE feedback SET authorize_scope = ?, authorize_revoked_at = ? WHERE id = ?`)
      .run('已撤回', new Date().toISOString(), id);
    this.audit.append(actorId, 'feedback.authorize_revoke', `feedback:${id}`, {});
    return this.detail(id, actorId);
  }

  /** 后台账号上下文（双人确认需要角色与权限） */
  private adminById(id: string): AdminContext {
    const row = this.db.app
      .prepare(
        `SELECT u.id, u.name, r.name AS role_name FROM admin_user u JOIN role r ON r.id = u.role_id WHERE u.id = ?`,
      )
      .get(id) as { id: string; name: string; role_name: string } | undefined;
    return {
      id,
      name: row?.name ?? '未知账号',
      role: { id: '', name: row?.role_name ?? '未知角色' },
      permissions: row ? permissionsOf(row.role_name) : [],
      mfa_enabled: true,
    };
  }

  /**
   * 处置动作与处理记录：写 feedback_handling（新表，记录只追加）并更新反馈状态，同时写审计。
   * 转内容修正 / 转模型复盘由对应团队在线下跟进，本服务不自动改写内容库或模型（红线）。
   */
  handle(id: string, actorId: string, input: HandleFeedbackInput): FeedbackDetail {
    const row = this.load(id);
    const comment = (input.comment ?? '').trim();
    if (!comment) {
      throw new ApiException(ErrorCode.BAD_REQUEST, '请填写处理记录');
    }
    if (!HANDLING_ACTIONS.includes(input.action)) {
      throw new ApiException(ErrorCode.BAD_REQUEST, `处置动作必须是：${HANDLING_ACTIONS.join(' / ')}`);
    }
    const status = ACTION_TO_STATUS[input.action];
    const handlingId = randomUUID();
    const now = new Date().toISOString();
    this.withTx(() => {
      this.db.app
        .prepare(
          `INSERT INTO feedback_handling (id, feedback_id, actor_id, action, comment, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(handlingId, id, actorId, input.action, comment, now);
      this.db.app.prepare(`UPDATE feedback SET status=? WHERE id=?`).run(status, id);
      this.audit.append(actorId, 'feedback.handle', `feedback:${id}`, {
        action: input.action,
        comment,
        status,
        handling_id: handlingId,
      });
    });
    this.logger.log(`[feedback] 举报 ${id} 被处置：${input.action}（${row.severity ?? 'help'} → ${status}）`);
    return this.detail(id);
  }

  // ---------- 内部 ----------

  private view(row: FeedbackRow): FeedbackView {
    return {
      id: row.id,
      type: row.is_error_report === 1 ? 'error_report' : 'feedback',
      analysis_id: row.analysis_id,
      content_item_id: row.content_item_id,
      help_type: row.help_type,
      unsolved_question: row.unsolved_question,
      category: row.category,
      description: row.description,
      severity: row.severity,
      status: row.status,
      versions: row.report_meta ? (JSON.parse(row.report_meta) as ReportVersions) : null,
      created_at: row.created_at,
      redline: FEEDBACK_REDLINE,
    };
  }

  private queueItem(row: FeedbackRow): FeedbackQueueItem {
    const item = { ...this.view(row), affected_users: this.affectedUsers(row) };
    // 后台任一角色都不应看到完整手机号（含举报原话里的联系方式）
    return {
      ...item,
      description: item.description ? maskPhone(item.description) : null,
      unsolved_question: item.unsolved_question ? maskPhone(item.unsolved_question) : null,
    };
  }

  /** 举报初筛（运营编辑 / 超级管理）：只流转状态，不看原文、不做临床复核 */
  triage(id: string, actorId: string, input: { action: string; comment: string }): FeedbackDetail {
    const row = this.load(id);
    const comment = (input.comment ?? '').trim();
    if (!comment) throw new ApiException(ErrorCode.BAD_REQUEST, '请填写初筛记录');
    if (!TRIAGE_ACTIONS.includes(input.action as (typeof TRIAGE_ACTIONS)[number])) {
      throw new ApiException(ErrorCode.BAD_REQUEST, `初筛结论必须是：${TRIAGE_ACTIONS.join(' / ')}`);
    }
    const status = input.action;
    this.db.app.prepare('UPDATE feedback SET status=? WHERE id=?').run(status, id);
    this.db.app
      .prepare(
        `INSERT INTO feedback_handling (id, feedback_id, actor_id, action, comment, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(randomUUID(), id, actorId, `初筛：${input.action}`, comment, new Date().toISOString());
    this.audit.append(actorId, 'feedback.triage', `feedback:${id}`, {
      action: input.action,
      status,
      comment,
      severity: row.severity,
    });
    this.logger.log(`[feedback] 举报 ${id.slice(0, 8)}… 初筛：${input.action}`);
    return this.detail(id, actorId);
  }

  private rawContentOf(row: FeedbackRow): RawContentSnapshot | typeof UNAUTHORIZED_RAW_CONTENT {
    // 产品红线：未授权 / 已过期 / 已撤回时用户原始内容不可见；授权后手机号也脱敏
    const expired = Boolean(row.authorize_expires_at && row.authorize_expires_at < new Date().toISOString());
    const revoked = Boolean(row.authorize_revoked_at);
    if (!row.authorized_at || expired || revoked || !row.raw_content) return UNAUTHORIZED_RAW_CONTENT;
    try {
      return maskSensitive(JSON.parse(row.raw_content) as RawContentSnapshot);
    } catch {
      return UNAUTHORIZED_RAW_CONTENT;
    }
  }

  private authorizationOf(row: FeedbackRow) {
    const expired = Boolean(row.authorize_expires_at && row.authorize_expires_at < new Date().toISOString());
    const revoked = Boolean(row.authorize_revoked_at);
    return {
      authorized: Boolean(row.authorized_at) && !expired && !revoked,
      by: row.authorized_by,
      approved_by: row.approve_by,
      at: row.authorized_at,
      scope: row.authorize_scope,
      expires_at: row.authorize_expires_at,
      expired,
      revoked,
      revoked_at: row.authorize_revoked_at,
      can_revoke: Boolean(row.authorized_at) && !expired && !revoked,
      ttl_days: AUTHORIZE_TTL_DAYS,
    };
  }

  private handlingRecords(feedbackId: string): FeedbackDetail['handling'] {
    return this.db.app
      .prepare(
        `SELECT id, action, comment, actor_id, created_at FROM feedback_handling
         WHERE feedback_id=? ORDER BY created_at ASC, rowid ASC`,
      )
      .all(feedbackId) as FeedbackDetail['handling'];
  }

  /**
   * 受影响范围：该分析被哪些用户看到（演示实现：分析所属 episode 的用户脱敏手机号）；
   * 内容举报附带引用该内容的分析所属用户。
   */
  private affectedUsers(row: FeedbackRow): { user_id: string; phone_masked: string }[] {
    const userIds = new Set<string>();
    if (row.analysis_id) {
      const ep = this.db.app
        .prepare(
          `SELECT e.user_id AS user_id FROM analysis a JOIN episode e ON e.id = a.episode_id WHERE a.id=?`,
        )
        .get(row.analysis_id) as { user_id: string } | undefined;
      if (ep) userIds.add(ep.user_id);
    }
    if (row.content_item_id) {
      for (const uid of this.usersReferencingContent(row.content_item_id)) userIds.add(uid);
    }
    return [...userIds].map((user_id) => ({ user_id, phone_masked: this.maskedPhone(user_id) }));
  }

  /** 引用了该内容的用户（演示实现：解析 analysis.sections.videos 的 content_item_id） */
  private usersReferencingContent(contentItemId: string): string[] {
    const rows = this.db.app
      .prepare(
        `SELECT e.user_id AS user_id, a.sections AS sections
         FROM analysis a JOIN episode e ON e.id = a.episode_id`,
      )
      .all() as { user_id: string; sections: string | null }[];
    const out: string[] = [];
    for (const r of rows) {
      if (!r.sections) continue;
      let videos: { content_item_id?: string }[] = [];
      try {
        const sections = JSON.parse(r.sections) as { videos?: { content_item_id?: string }[] };
        videos = Array.isArray(sections.videos) ? sections.videos : [];
      } catch {
        continue;
      }
      if (videos.some((v) => v?.content_item_id === contentItemId)) out.push(r.user_id);
    }
    return out;
  }

  /** 手机号脱敏（138****1234）；查不到身份信息时返回占位 */
  private maskedPhone(userId: string): string {
    const profile = this.db.identity
      .prepare('SELECT phone_enc FROM identity_profile WHERE user_id=?')
      .get(userId) as { phone_enc: string } | undefined;
    if (!profile) return '未知用户';
    try {
      return FieldCrypto.maskPhone(this.db.crypto.decrypt(profile.phone_enc));
    } catch {
      return '未知用户';
    }
  }

  /** 四类版本快照：分析版本 / 模型版本 / 内容版本 / 规则集版本 */
  private buildVersions(analysis: AnalysisRow | null, content: ContentItemRow | null): ReportVersions {
    let model: ReportVersions['model'] = null;
    if (analysis?.model_release_id) {
      const mr = this.db.app
        .prepare('SELECT id, model_name, prompt_version FROM model_release WHERE id=?')
        .get(analysis.model_release_id) as
        | { id: string; model_name: string; prompt_version: string }
        | undefined;
      if (mr) model = { model_release_id: mr.id, model_name: mr.model_name, prompt_version: mr.prompt_version };
    }
    let contentVersion: ReportVersions['content'] = null;
    if (content) {
      const current = this.db.app
        .prepare(
          `SELECT version FROM content_version WHERE item_id=? ORDER BY version DESC, rowid DESC LIMIT 1`,
        )
        .get(content.id) as { version: number } | undefined;
      contentVersion = {
        content_item_id: content.id,
        current_status: content.current_status,
        version: current?.version ?? null,
      };
    }
    return {
      analysis_version: analysis ? analysis.version : null,
      analysis_id: analysis?.id ?? null,
      model,
      content: contentVersion,
      rule_set_version: RULE_SET_VERSION,
    };
  }

  /** 用户原始内容快照：该分析所属病程的用户录入原文 + 被举报内容脚本 */
  private snapshotRawContent(analysis: AnalysisRow | null, content: ContentItemRow | null): RawContentSnapshot {
    let records: RawContentSnapshot['records'] = [];
    if (analysis) {
      const rows = this.db.app
        .prepare(
          `SELECT source_type, occurred_at, raw_text FROM care_event
           WHERE episode_id=? AND raw_text IS NOT NULL AND raw_text != ''
           ORDER BY occurred_at ASC, rowid ASC LIMIT 20`,
        )
        .all(analysis.episode_id) as {
        source_type: string;
        occurred_at: string;
        raw_text: string;
      }[];
      records = rows.map((r) => ({
        source_type: r.source_type,
        occurred_at: r.occurred_at,
        raw_text: r.raw_text,
      }));
    }
    let reported_content: RawContentSnapshot['reported_content'] = null;
    if (content) {
      const current = this.db.app
        .prepare(
          `SELECT script FROM content_version WHERE item_id=? ORDER BY version DESC, rowid DESC LIMIT 1`,
        )
        .get(content.id) as { script: string | null } | undefined;
      reported_content = {
        type: 'content_item',
        id: content.id,
        title: content.title,
        current_status: content.current_status,
        script: current?.script ?? null,
      };
    }
    return {
      records,
      reported_content,
      note: '用户原始内容快照：仅在本条举报被单条授权后对后台可见',
    };
  }

  private load(id: string): FeedbackRow {
    const row = this.db.app.prepare(`SELECT * FROM feedback WHERE id=?`).get(id) as
      | FeedbackRow
      | undefined;
    if (!row) {
      throw new ApiException(ErrorCode.NOT_FOUND, '反馈不存在');
    }
    return row;
  }

  private ownedAnalysis(userId: string, analysisId: string): AnalysisRow {
    const row = this.db.app
      .prepare(
        `SELECT a.id, a.episode_id, a.version, a.model_release_id
         FROM analysis a JOIN episode e ON e.id = a.episode_id WHERE a.id = ?`,
      )
      .get(analysisId) as AnalysisRow | undefined;
    if (!row) {
      throw new ApiException(ErrorCode.NOT_FOUND, '分析不存在');
    }
    const owner = this.db.app
      .prepare('SELECT user_id FROM episode WHERE id=?')
      .get(row.episode_id) as { user_id: string } | undefined;
    if (!owner || owner.user_id !== userId) {
      // 越权引用他人分析：按不存在处理，不暴露他人数据
      throw new ApiException(ErrorCode.NOT_FOUND, '分析不存在');
    }
    return row;
  }

  private loadContentItem(contentItemId: string): ContentItemRow {
    const row = this.db.app
      .prepare(`SELECT id, title, current_status FROM content_item WHERE id=?`)
      .get(contentItemId) as ContentItemRow | undefined;
    if (!row) {
      throw new ApiException(ErrorCode.NOT_FOUND, '内容不存在');
    }
    return row;
  }

  private withTx<T>(fn: () => T): T {
    this.db.app.exec('BEGIN');
    try {
      const result = fn();
      this.db.app.exec('COMMIT');
      return result;
    } catch (err) {
      try {
        this.db.app.exec('ROLLBACK');
      } catch {
        // 事务可能已因错误自动回滚
      }
      throw err;
    }
  }
}
