import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DbService } from '../../db/db.service';
import { ApiException, ErrorCode } from '../../common/api-error';
import { AuditService } from '../../common/audit.service';
import { SwitchesService } from '../switches/switches.service';

/**
 * 内容库服务（用户端 /contents + 审核状态机，docs/system-design.md 第 4 节）。
 * 状态机（非法流转一律 40900 + 中文说明）：
 *   草稿 → 待医学审核（提交审核，附脚本 / 依据 / 适用范围）
 *   待医学审核 → 已审定（临床审核通过，记录审核人与范围）/ 草稿（退回，记录意见）
 *   已审定 → 已发布（发布，生成版本号，写审计；发布人与审核人不能是同一人）
 *   已发布 → 已下线（一键下线，定位引用）/ 已撤回（发现严重问题）/ 更正中（需要更正）
 *   更正中 → 待医学审核（提交新版本）
 *   已撤回 / 已下线 → 更正中（修订后重审）
 * 产品红线：内容带适用范围与不适用范围、版本号、审核记录；下线立即生效（用户端 404）。
 * 后台（B03 / B04，T31-T39）复用同一服务的状态流转方法，本任务只暴露用户端接口。
 */

/** 内容审核状态（与 docs/system-design.md 第 4 节一致） */
export const CONTENT_STATUSES = [
  '草稿',
  '待医学审核',
  '已审定',
  '已发布',
  '已撤回',
  '已下线',
  '更正中',
] as const;
export type ContentStatus = (typeof CONTENT_STATUSES)[number];

/** 状态机动作 */
export const CONTENT_ACTIONS = [
  'submitForReview',
  'approve',
  'reject',
  'publish',
  'takeOffline',
  'withdraw',
  'markCorrecting',
  'resubmit',
] as const;
export type ContentAction = (typeof CONTENT_ACTIONS)[number];

/** 合法流转表：不在表内的（状态, 动作）组合一律 40900 */
const TRANSITIONS: Record<ContentStatus, Partial<Record<ContentAction, ContentStatus>>> = {
  草稿: { submitForReview: '待医学审核' },
  待医学审核: { approve: '已审定', reject: '草稿' },
  已审定: { publish: '已发布' },
  已发布: { markCorrecting: '更正中', takeOffline: '已下线', withdraw: '已撤回' },
  已撤回: { markCorrecting: '更正中' },
  已下线: { markCorrecting: '更正中' },
  更正中: { resubmit: '待医学审核' },
};

/** 动作的中文说明（用于 40900 文案，如「当前状态为草稿，不能直接发布」） */
const ACTION_LABELS: Record<ContentAction, string> = {
  submitForReview: '提交审核',
  approve: '审核通过',
  reject: '退回修改',
  publish: '直接发布',
  takeOffline: '一键下线',
  withdraw: '撤回',
  markCorrecting: '标记更正中',
  resubmit: '提交新版本',
};

/** 审核记录决策（与 seed.ts 已有取值保持一致） */
const DECISION = {
  submit: '提交审核',
  approve: '通过',
  reject: '退回',
  publish: '发布',
  offline: '下线',
  withdraw: '撤回',
  correcting: '更正中',
} as const;

/** 演示推荐规则的关键词词表：按用户 episode 记录匹配适用范围 */
const SCOPE_KEYWORDS = [
  '腰痛', '腰背痛', '久坐', '椎间盘', '腿麻', '放射', '麻木', '无力', '就医', '运动',
  '锻炼', '休息', '报告', '睡眠', '搬重物', '急性', '复诊', '坐下', '酸痛', '加重',
  '大小便', '床垫', '坐姿', '卧床',
];

/** 用户端内容免责声明（与产品红线一致：不作诊断） */
export const CONTENT_DISCLAIMER = '内容均经医学审核后发布，仅供参考，不作诊断';

type ContentItemRow = {
  id: string;
  type: string;
  title: string;
  applicable_scope: string | null;
  not_applicable: string | null;
  current_status: string;
  offline_switch: number;
  created_at: string;
};

type ContentVersionRow = {
  id: string;
  item_id: string;
  version: number;
  script: string | null;
  asset_key: string | null;
  subtitle_text: string | null;
  model_asset_version: string | null;
  published_at: string | null;
};

type ReviewRecordRow = {
  id: string;
  target_id: string;
  target_type: string;
  reviewer_id: string | null;
  decision: string;
  review_scope: string | null;
  comment: string | null;
  reviewed_at: string;
};

/** 列表项：适用范围、不适用范围、当前版本号、推荐理由（App A13 / Web W07） */
export interface ContentListItem {
  id: string;
  type: string;
  title: string;
  applicable_scope: string;
  not_applicable: string;
  /** 当前版本号（已发布版本） */
  version: number | null;
  published_at: string | null;
  recommend_reason: string;
}

export interface ContentVersionView {
  version: number;
  script: string;
  subtitle_text: string;
  asset_key: string | null;
  published_at: string | null;
  /** 是否为当前生效（已发布）版本 */
  is_current: boolean;
}

export interface ReviewRecordView {
  id: string;
  decision: string;
  review_scope: string | null;
  comment: string | null;
  reviewer_id: string | null;
  reviewer_name: string | null;
  reviewed_at: string;
}

/** 详情：当前版本脚本、字幕与文字替代、审核记录、版本链（App A15 / Web W07 抽屉） */
export interface ContentDetail {
  id: string;
  type: string;
  title: string;
  applicable_scope: string;
  not_applicable: string;
  current_status: ContentStatus;
  /** 下线开关（1 = 已下线，用户端立即不可见） */
  offline: boolean;
  current_version: {
    version: number;
    script: string;
    subtitle_text: string;
    asset_key: string | null;
    published_at: string;
  } | null;
  versions: ContentVersionView[];
  review_records: ReviewRecordView[];
  disclaimer: string;
}

/** 引用定位：哪些分析引用了该内容（analysis.sections.videos 的 content_item_id） */
export interface ContentVideoRef {
  content_item_id: string;
  title: string;
  reason: string;
}

export interface ContentReference {
  analysis_id: string;
  episode_id: string;
  analysis_version: number;
  created_at: string;
  videos: ContentVideoRef[];
}

export interface ReferenceReport {
  /** 引用该内容的分析数量 */
  count: number;
  analyses: ContentReference[];
  /** 定位来源（演示实现：分析 sections.videos） */
  source: string;
}

export interface TakeOfflineResult {
  content: ContentDetail;
  references: ReferenceReport;
}

export interface ContentDraftInput {
  type: string;
  title: string;
  applicable_scope?: string | null;
  not_applicable?: string | null;
  script?: string | null;
  subtitle_text?: string | null;
  asset_key?: string | null;
}

export interface SubmitReviewInput {
  script?: string | null;
  subtitle_text?: string | null;
  asset_key?: string | null;
  applicable_scope?: string | null;
  not_applicable?: string | null;
  /** 依据（写入审核记录） */
  evidence?: string | null;
}

export interface ApproveInput {
  review_scope?: string | null;
  comment?: string | null;
}

export interface RejectInput {
  comment: string;
}

export interface ReasonInput {
  reason?: string | null;
}

@Injectable()
export class ContentsService {
  private readonly logger = new Logger('Contents');

  constructor(
    private readonly db: DbService,
    private readonly switches: SwitchesService,
    private readonly audit: AuditService,
  ) {}

  // ---------- 用户端 ----------

  /**
   * 已发布内容列表：只返回已发布且未下线内容。
   * - 支持按类型筛选；
   * - 「视频推荐」开关关闭时视频推荐位为空（不报错）；
   * - 「案例卡片」开关关闭时类型为案例的内容不返回；
   * - 每条带适用范围、不适用范围、当前版本号与推荐理由。
   */
  listPublished(userId: string | null, type?: string): ContentListItem[] {
    const videoOn = this.switches.isEnabled('视频推荐');
    const caseOn = this.switches.isEnabled('案例卡片');
    const keywords = userId ? this.userKeywords(userId) : [];
    const rows = this.db.app
      .prepare(
        `SELECT * FROM content_item
         WHERE current_status='已发布' AND offline_switch=0
         ORDER BY created_at ASC, rowid ASC`,
      )
      .all() as ContentItemRow[];
    const items: ContentListItem[] = [];
    for (const row of rows) {
      if (type && row.type !== type) continue;
      if (row.type === '视频' && !videoOn) continue;
      if (row.type === '案例' && !caseOn) continue;
      const current = this.currentPublishedVersion(row.id);
      items.push({
        id: row.id,
        type: row.type,
        title: row.title,
        applicable_scope: row.applicable_scope ?? '',
        not_applicable: row.not_applicable ?? '',
        version: current?.version ?? null,
        published_at: current?.published_at ?? null,
        recommend_reason: this.recommendReason(row, keywords),
      });
    }
    return items;
  }

  /** 内容详情：当前版本脚本、字幕与文字替代、审核记录、版本链；非已发布 / 已下线一律 404 */
  detail(id: string): ContentDetail {
    const item = this.loadItem(id);
    if (item.current_status !== '已发布' || item.offline_switch === 1) {
      throw new ApiException(ErrorCode.NOT_FOUND, '内容不存在或已下线');
    }
    return this.detailOf(item);
  }

  // ---------- 状态机（运营编辑 / 临床审核；后台 T31-T39 复用） ----------

  /** 运营编辑创建草稿（同时写入第一个版本） */
  createDraft(actorId: string, input: ContentDraftInput): ContentDetail {
    const type = (input.type ?? '').trim();
    const title = (input.title ?? '').trim();
    if (!type) throw new ApiException(ErrorCode.BAD_REQUEST, '内容类型不能为空');
    if (!title) throw new ApiException(ErrorCode.BAD_REQUEST, '内容标题不能为空');
    const now = new Date().toISOString();
    const itemId = randomUUID();
    this.withTx(() => {
      this.db.app
        .prepare(
          `INSERT INTO content_item (id, type, title, applicable_scope, not_applicable, current_status, offline_switch, created_at)
           VALUES (?, ?, ?, ?, ?, '草稿', 0, ?)`,
        )
        .run(
          itemId,
          type,
          title,
          input.applicable_scope ?? null,
          input.not_applicable ?? null,
          now,
        );
      this.insertVersion(itemId, 1, input, null);
      this.audit.append(actorId, 'content.create_draft', `content_item:${itemId}`, {
        type,
        title,
        status: '草稿',
      });
    });
    this.logger.log(`[contents] ${actorId} 创建草稿 ${itemId}（${type}《${title}》）`);
    return this.detailOf(this.loadItem(itemId));
  }

  /** 编辑草稿：仅草稿状态可编辑（更正中用 resubmit 提交新版本） */
  updateDraft(actorId: string, itemId: string, input: Partial<ContentDraftInput>): ContentDetail {
    const item = this.loadItem(itemId);
    if (item.current_status !== '草稿') {
      throw new ApiException(
        ErrorCode.CONFLICT,
        `当前状态为${item.current_status}，不能编辑草稿内容`,
      );
    }
    const title = input.title === undefined ? item.title : input.title.trim();
    if (!title) throw new ApiException(ErrorCode.BAD_REQUEST, '内容标题不能为空');
    const type = input.type === undefined ? item.type : input.type.trim();
    if (!type) throw new ApiException(ErrorCode.BAD_REQUEST, '内容类型不能为空');
    this.withTx(() => {
      this.db.app
        .prepare(
          `UPDATE content_item SET type=?, title=?, applicable_scope=?, not_applicable=? WHERE id=?`,
        )
        .run(
          type,
          title,
          input.applicable_scope === undefined ? item.applicable_scope : input.applicable_scope,
          input.not_applicable === undefined ? item.not_applicable : input.not_applicable,
          itemId,
        );
      const draft = this.latestVersion(itemId);
      if (draft && !draft.published_at) {
        this.db.app
          .prepare(`UPDATE content_version SET script=?, subtitle_text=?, asset_key=? WHERE id=?`)
          .run(
            input.script === undefined ? draft.script : input.script,
            input.subtitle_text === undefined ? draft.subtitle_text : input.subtitle_text,
            input.asset_key === undefined ? draft.asset_key : input.asset_key,
            draft.id,
          );
      }
      this.audit.append(actorId, 'content.update_draft', `content_item:${itemId}`, { title });
    });
    return this.detailOf(this.loadItem(itemId));
  }

  /** 草稿 → 待医学审核：提交审核（附脚本 / 依据 / 适用范围） */
  submitForReview(actorId: string, itemId: string, input: SubmitReviewInput = {}): ContentDetail {
    const item = this.loadItem(itemId);
    const to = this.transition(item, 'submitForReview');
    const scope = input.applicable_scope?.trim() || item.applicable_scope?.trim() || '';
    if (!scope) {
      throw new ApiException(ErrorCode.BAD_REQUEST, '提交审核前必须填写适用范围');
    }
    this.withTx(() => {
      this.applyDraftEdits(itemId, input);
      this.db.app
        .prepare(`UPDATE content_item SET applicable_scope=?, not_applicable=?, current_status=? WHERE id=?`)
        .run(
          scope,
          input.not_applicable === undefined ? item.not_applicable : input.not_applicable,
          to,
          itemId,
        );
      this.writeReview(itemId, actorId, DECISION.submit, '医学准确性', input.evidence ?? null);
      this.audit.append(actorId, 'content.submit_review', `content_item:${itemId}`, {
        from: item.current_status,
        to,
        evidence: input.evidence ?? null,
      });
    });
    this.logger.log(`[contents] ${itemId} 提交审核（${item.current_status} → ${to}）`);
    return this.detailOf(this.loadItem(itemId));
  }

  /** 待医学审核 → 已审定：临床审核通过（记录审核人与范围） */
  approve(reviewerId: string, itemId: string, input: ApproveInput = {}): ContentDetail {
    const item = this.loadItem(itemId);
    const to = this.transition(item, 'approve');
    this.withTx(() => {
      this.setStatus(itemId, to);
      this.writeReview(
        itemId,
        reviewerId,
        DECISION.approve,
        input.review_scope?.trim() || '医学准确性',
        input.comment ?? null,
      );
      this.audit.append(reviewerId, 'content.approve', `content_item:${itemId}`, {
        from: item.current_status,
        to,
        review_scope: input.review_scope?.trim() || '医学准确性',
      });
    });
    this.logger.log(`[contents] ${itemId} 审核通过（${item.current_status} → ${to}）`);
    return this.detailOf(this.loadItem(itemId));
  }

  /** 待医学审核 → 草稿：退回修改（必须记录意见） */
  reject(reviewerId: string, itemId: string, input: RejectInput): ContentDetail {
    const comment = (input.comment ?? '').trim();
    if (!comment) {
      throw new ApiException(ErrorCode.BAD_REQUEST, '退回修改必须填写审核意见');
    }
    const item = this.loadItem(itemId);
    const to = this.transition(item, 'reject');
    this.withTx(() => {
      this.setStatus(itemId, to);
      this.writeReview(itemId, reviewerId, DECISION.reject, '医学准确性', comment);
      this.audit.append(reviewerId, 'content.reject', `content_item:${itemId}`, {
        from: item.current_status,
        to,
        comment,
      });
    });
    this.logger.log(`[contents] ${itemId} 被退回（${item.current_status} → ${to}）：${comment}`);
    return this.detailOf(this.loadItem(itemId));
  }

  /**
   * 已审定 → 已发布：发布（生成版本号，写审计）。
   * 双人确认：发布人与已审定的审核人不能是同一人（比较 admin_user id），否则 40900。
   */
  publish(publisherId: string, itemId: string): ContentDetail {
    const item = this.loadItem(itemId);
    this.transition(item, 'publish');
    const approver = this.latestReviewerOf(itemId, DECISION.approve);
    if (!approver) {
      throw new ApiException(ErrorCode.CONFLICT, '发布需双人确认：未找到临床审核通过记录');
    }
    if (approver === publisherId) {
      throw new ApiException(
        ErrorCode.CONFLICT,
        '发布需双人确认：审核人与发布人不能是同一人，请换一位临床审核角色发布',
      );
    }
    let version = 0;
    this.withTx(() => {
      version = this.publishCurrentVersion(itemId);
      this.setStatus(itemId, '已发布', false);
      this.writeReview(itemId, publisherId, DECISION.publish, '发布复核', '双人确认：审核人与发布人为不同账号');
      this.audit.append(publisherId, 'content.publish', `content_item:${itemId}`, {
        from: item.current_status,
        to: '已发布',
        version,
        approver_id: approver,
        dual_control: true,
      });
    });
    this.logger.log(`[contents] ${itemId} 发布 v${version}（双人确认：审核人 ${approver} ≠ 发布人 ${publisherId}）`);
    return this.detailOf(this.loadItem(itemId));
  }

  /**
   * 一键下线（已发布 → 已下线）：offline_switch=1 且状态立即变为已下线，
   * 用户端接口立即 404；返回引用定位信息（哪些分析引用了该内容）。
   */
  takeOffline(operatorId: string, itemId: string, input: ReasonInput = {}): TakeOfflineResult {
    const item = this.loadItem(itemId);
    const to = this.transition(item, 'takeOffline');
    const references = this.locateReferences(itemId);
    const reason = input.reason?.trim() || '一键下线';
    this.withTx(() => {
      this.setStatus(itemId, to, true);
      this.writeReview(itemId, operatorId, DECISION.offline, '一键下线', JSON.stringify({ reason, references }));
      this.audit.append(operatorId, 'content.offline', `content_item:${itemId}`, {
        from: item.current_status,
        to,
        reason,
        reference_count: references.count,
        analysis_ids: references.analyses.map((a) => a.analysis_id),
      });
    });
    this.logger.log(
      `[contents] ${itemId} 一键下线（${item.current_status} → ${to}），引用分析 ${references.count} 条`,
    );
    return { content: this.detailOf(this.loadItem(itemId)), references };
  }

  /** 发现严重问题：已发布 → 已撤回（同样立即对用户端不可见） */
  withdraw(operatorId: string, itemId: string, input: ReasonInput = {}): ContentDetail {
    const item = this.loadItem(itemId);
    const to = this.transition(item, 'withdraw');
    const reason = input.reason?.trim() || '发现严重问题';
    this.withTx(() => {
      this.setStatus(itemId, to, true);
      this.writeReview(itemId, operatorId, DECISION.withdraw, '严重问题', reason);
      this.audit.append(operatorId, 'content.withdraw', `content_item:${itemId}`, {
        from: item.current_status,
        to,
        reason,
      });
    });
    this.logger.log(`[contents] ${itemId} 撤回（${item.current_status} → ${to}）：${reason}`);
    return this.detailOf(this.loadItem(itemId));
  }

  /** 标记更正中：已发布（需要更正）/ 已撤回 / 已下线 → 更正中 */
  markCorrecting(actorId: string, itemId: string, input: ReasonInput = {}): ContentDetail {
    const item = this.loadItem(itemId);
    const to = this.transition(item, 'markCorrecting');
    const reason = input.reason?.trim() || '需要更正';
    this.withTx(() => {
      this.setStatus(itemId, to);
      this.writeReview(itemId, actorId, DECISION.correcting, '更正', reason);
      this.audit.append(actorId, 'content.mark_correcting', `content_item:${itemId}`, {
        from: item.current_status,
        to,
        reason,
      });
    });
    this.logger.log(`[contents] ${itemId} 标记更正中（${item.current_status} → ${to}）`);
    return this.detailOf(this.loadItem(itemId));
  }

  /** 更正中 → 待医学审核：提交新版本（版本号 +1，附脚本 / 依据 / 适用范围） */
  resubmit(actorId: string, itemId: string, input: SubmitReviewInput = {}): ContentDetail {
    const item = this.loadItem(itemId);
    const to = this.transition(item, 'resubmit');
    const scope = input.applicable_scope?.trim() || item.applicable_scope?.trim() || '';
    if (!scope) {
      throw new ApiException(ErrorCode.BAD_REQUEST, '提交新版本前必须填写适用范围');
    }
    let version = 0;
    this.withTx(() => {
      const draft = this.latestVersion(itemId);
      if (draft && !draft.published_at) {
        // 已有未发布草稿版本 → 直接改写
        this.db.app
          .prepare(`UPDATE content_version SET script=?, subtitle_text=?, asset_key=? WHERE id=?`)
          .run(
            input.script === undefined ? draft.script : input.script,
            input.subtitle_text === undefined ? draft.subtitle_text : input.subtitle_text,
            input.asset_key === undefined ? draft.asset_key : input.asset_key,
            draft.id,
          );
        version = draft.version;
      } else {
        // 以最新版本为基础新建一个未发布版本（修订稿）
        version = this.nextVersionNumber(itemId);
        this.insertVersion(
          itemId,
          version,
          {
            script: input.script ?? draft?.script ?? null,
            subtitle_text: input.subtitle_text ?? draft?.subtitle_text ?? null,
            asset_key: input.asset_key ?? draft?.asset_key ?? null,
          },
          null,
        );
      }
      this.db.app
        .prepare(`UPDATE content_item SET applicable_scope=?, not_applicable=?, current_status=? WHERE id=?`)
        .run(
          scope,
          input.not_applicable === undefined ? item.not_applicable : input.not_applicable,
          to,
          itemId,
        );
      this.writeReview(itemId, actorId, DECISION.submit, '医学准确性', input.evidence ?? null);
      this.audit.append(actorId, 'content.resubmit', `content_item:${itemId}`, {
        from: item.current_status,
        to,
        version,
        evidence: input.evidence ?? null,
      });
    });
    this.logger.log(`[contents] ${itemId} 提交新版本 v${version}（${item.current_status} → ${to}）`);
    return this.detailOf(this.loadItem(itemId));
  }

  // ---------- 内部 ----------

  /** 合法流转校验：非法流转返回 40900 + 中文说明 */
  private transition(item: ContentItemRow, action: ContentAction): ContentStatus {
    const to = TRANSITIONS[item.current_status as ContentStatus]?.[action];
    if (!to) {
      throw new ApiException(
        ErrorCode.CONFLICT,
        `当前状态为${item.current_status}，不能${ACTION_LABELS[action]}`,
      );
    }
    return to;
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

  private loadItem(itemId: string): ContentItemRow {
    const row = this.db.app.prepare(`SELECT * FROM content_item WHERE id=?`).get(itemId) as
      | ContentItemRow
      | undefined;
    if (!row) {
      throw new ApiException(ErrorCode.NOT_FOUND, '内容不存在');
    }
    return row;
  }

  private setStatus(itemId: string, status: ContentStatus, offline?: boolean): void {
    if (offline === undefined) {
      this.db.app.prepare(`UPDATE content_item SET current_status=? WHERE id=?`).run(status, itemId);
    } else {
      this.db.app
        .prepare(`UPDATE content_item SET current_status=?, offline_switch=? WHERE id=?`)
        .run(status, offline ? 1 : 0, itemId);
    }
  }

  private latestVersion(itemId: string): ContentVersionRow | undefined {
    return this.db.app
      .prepare(`SELECT * FROM content_version WHERE item_id=? ORDER BY version DESC, rowid DESC LIMIT 1`)
      .get(itemId) as ContentVersionRow | undefined;
  }

  private nextVersionNumber(itemId: string): number {
    const row = this.db.app
      .prepare(`SELECT MAX(version) AS v FROM content_version WHERE item_id=?`)
      .get(itemId) as { v: number | null } | undefined;
    return (row?.v ?? 0) + 1;
  }

  private insertVersion(
    itemId: string,
    version: number,
    input: { script?: string | null; subtitle_text?: string | null; asset_key?: string | null },
    publishedAt: string | null,
  ): void {
    this.db.app
      .prepare(
        `INSERT INTO content_version (id, item_id, version, script, asset_key, subtitle_text, model_asset_version, published_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        itemId,
        version,
        input.script ?? null,
        input.asset_key ?? null,
        input.subtitle_text ?? null,
        'demo-asset-1',
        publishedAt,
      );
  }

  /** 提交审核 / 重审时把脚本与字幕写入（未发布的）当前版本 */
  private applyDraftEdits(itemId: string, input: SubmitReviewInput): void {
    if (input.script === undefined && input.subtitle_text === undefined && input.asset_key === undefined) {
      return;
    }
    const draft = this.latestVersion(itemId);
    if (!draft || draft.published_at) return;
    this.db.app
      .prepare(`UPDATE content_version SET script=?, subtitle_text=?, asset_key=? WHERE id=?`)
      .run(
        input.script === undefined ? draft.script : input.script,
        input.subtitle_text === undefined ? draft.subtitle_text : input.subtitle_text,
        input.asset_key === undefined ? draft.asset_key : input.asset_key,
        draft.id,
      );
  }

  /** 发布：生成版本号（把当前版本标记为已发布；异常情况下复制一个新版本） */
  private publishCurrentVersion(itemId: string): number {
    const latest = this.latestVersion(itemId);
    const now = new Date().toISOString();
    if (latest && !latest.published_at) {
      this.db.app.prepare(`UPDATE content_version SET published_at=? WHERE id=?`).run(now, latest.id);
      return latest.version;
    }
    const version = this.nextVersionNumber(itemId);
    this.insertVersion(
      itemId,
      version,
      { script: latest?.script, subtitle_text: latest?.subtitle_text, asset_key: latest?.asset_key },
      now,
    );
    return version;
  }

  /** 当前生效（已发布）版本：已发布版本中版本号最大的一个 */
  private currentPublishedVersion(itemId: string): ContentVersionRow | undefined {
    return this.db.app
      .prepare(
        `SELECT * FROM content_version WHERE item_id=? AND published_at IS NOT NULL
         ORDER BY version DESC, rowid DESC LIMIT 1`,
      )
      .get(itemId) as ContentVersionRow | undefined;
  }

  private writeReview(
    itemId: string,
    reviewerId: string | null,
    decision: string,
    reviewScope: string | null,
    comment: string | null,
  ): void {
    this.db.app
      .prepare(
        `INSERT INTO review_record (id, target_id, target_type, reviewer_id, decision, review_scope, comment, reviewed_at)
         VALUES (?, ?, 'content_item', ?, ?, ?, ?, ?)`,
      )
      .run(randomUUID(), itemId, reviewerId, decision, reviewScope, comment, new Date().toISOString());
  }

  /** 最近一条指定决策的审核人（双人确认用） */
  private latestReviewerOf(itemId: string, decision: string): string | null {
    const row = this.db.app
      .prepare(
        `SELECT reviewer_id FROM review_record
         WHERE target_id=? AND target_type='content_item' AND decision=?
         ORDER BY reviewed_at DESC, rowid DESC LIMIT 1`,
      )
      .get(itemId, decision) as { reviewer_id: string | null } | undefined;
    return row?.reviewer_id ?? null;
  }

  private detailOf(item: ContentItemRow): ContentDetail {
    const versions = this.db.app
      .prepare(`SELECT * FROM content_version WHERE item_id=? ORDER BY version ASC, rowid ASC`)
      .all(item.id) as ContentVersionRow[];
    const current = this.currentPublishedVersion(item.id) ?? null;
    return {
      id: item.id,
      type: item.type,
      title: item.title,
      applicable_scope: item.applicable_scope ?? '',
      not_applicable: item.not_applicable ?? '',
      current_status: item.current_status as ContentStatus,
      offline: item.offline_switch === 1,
      current_version: current
        ? {
            version: current.version,
            script: current.script ?? '',
            subtitle_text: current.subtitle_text ?? '',
            asset_key: current.asset_key ?? null,
            published_at: current.published_at as string,
          }
        : null,
      versions: versions.map((v) => ({
        version: v.version,
        script: v.script ?? '',
        subtitle_text: v.subtitle_text ?? '',
        asset_key: v.asset_key ?? null,
        published_at: v.published_at,
        is_current: current ? v.id === current.id : false,
      })),
      review_records: this.reviewRecordsOf(item.id),
      disclaimer: CONTENT_DISCLAIMER,
    };
  }

  private reviewRecordsOf(itemId: string): ReviewRecordView[] {
    const rows = this.db.app
      .prepare(
        `SELECT r.*, a.name AS reviewer_name FROM review_record r
         LEFT JOIN admin_user a ON a.id = r.reviewer_id
         WHERE r.target_id=? AND r.target_type='content_item'
         ORDER BY r.reviewed_at ASC, r.rowid ASC`,
      )
      .all(itemId) as (ReviewRecordRow & { reviewer_name: string | null })[];
    return rows.map((r) => ({
      id: r.id,
      decision: r.decision,
      review_scope: r.review_scope,
      comment: r.comment,
      reviewer_id: r.reviewer_id,
      reviewer_name: r.reviewer_name,
      reviewed_at: r.reviewed_at,
    }));
  }

  /** 引用定位：从 analysis.sections.videos 的 content_item_id 统计哪些分析引用了该内容 */
  private locateReferences(itemId: string): ReferenceReport {
    const rows = this.db.app
      .prepare(`SELECT id, episode_id, version, sections, created_at FROM analysis ORDER BY created_at ASC, rowid ASC`)
      .all() as {
      id: string;
      episode_id: string;
      version: number;
      sections: string | null;
      created_at: string;
    }[];
    const analyses: ContentReference[] = [];
    for (const r of rows) {
      const videos = this.videosOf(r.sections);
      const hit = videos.filter((v) => v.content_item_id === itemId);
      if (hit.length > 0) {
        analyses.push({
          analysis_id: r.id,
          episode_id: r.episode_id,
          analysis_version: r.version,
          created_at: r.created_at,
          videos: hit,
        });
      }
    }
    return { count: analyses.length, analyses, source: 'analysis.sections.videos' };
  }

  private videosOf(sectionsText: string | null): ContentVideoRef[] {
    if (!sectionsText) return [];
    let sections: unknown;
    try {
      sections = JSON.parse(sectionsText);
    } catch {
      return [];
    }
    const raw = (sections as { videos?: unknown } | null)?.videos;
    if (!Array.isArray(raw)) return [];
    return raw
      .map((v) => {
        const o = v as { content_item_id?: unknown; title?: unknown; reason?: unknown };
        return {
          content_item_id: typeof o.content_item_id === 'string' ? o.content_item_id : '',
          title: typeof o.title === 'string' ? o.title : '',
          reason: typeof o.reason === 'string' ? o.reason : '',
        };
      })
      .filter((v) => v.content_item_id.length > 0);
  }

  /** 用户 episode 关键词（病程标题 / 事件原文 / 报告原文 / 最担心的问题） */
  private userKeywords(userId: string): string[] {
    const texts: string[] = [];
    const episodes = this.db.app
      .prepare(`SELECT id, title FROM episode WHERE user_id=?`)
      .all(userId) as { id: string; title: string }[];
    for (const ep of episodes) {
      texts.push(ep.title);
      const events = this.db.app
        .prepare(`SELECT raw_text FROM care_event WHERE episode_id=? AND raw_text IS NOT NULL`)
        .all(ep.id) as { raw_text: string }[];
      const logs = this.db.app
        .prepare(
          `SELECT s.top_worry FROM symptom_log s JOIN care_event c ON c.id=s.care_event_id
           WHERE c.episode_id=? AND s.top_worry IS NOT NULL`,
        )
        .all(ep.id) as { top_worry: string }[];
      const reports = this.db.app
        .prepare(
          `SELECT r.raw_text FROM report r JOIN care_event c ON c.id=r.care_event_id
           WHERE c.episode_id=? AND r.raw_text IS NOT NULL`,
        )
        .all(ep.id) as { raw_text: string }[];
      texts.push(
        ...events.map((e) => e.raw_text),
        ...logs.map((l) => l.top_worry),
        ...reports.map((r) => r.raw_text),
      );
    }
    const joined = texts.join(' ');
    return SCOPE_KEYWORDS.filter((k) => joined.includes(k));
  }

  /** 推荐理由（演示规则：按用户 episode 关键词匹配适用范围；始终非空） */
  private recommendReason(row: ContentItemRow, keywords: string[]): string {
    const scope = row.applicable_scope ?? '';
    const matched = keywords.filter((k) => scope.includes(k));
    if (matched.length > 0) {
      return `你的记录中提到「${matched.slice(0, 3).join('、')}」，该内容适用于：${scope || '相关人群'}`;
    }
    return `经临床审核的${row.type}内容，可帮助你了解更多`;
  }
}
