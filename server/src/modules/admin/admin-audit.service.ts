import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ApiException, ErrorCode } from '../../common/api-error';
import { AuditService } from '../../common/audit.service';
import { DbService } from '../../db/db.service';

/** 审计日志列表项（B11：时间 / 操作人 / 角色 / 动作 / 对象 / 请求 ID / 哈希） */
export interface AuditLogItem {
  id: string;
  created_at: string;
  actor_id: string | null;
  actor_name: string | null;
  actor_role: string | null;
  action: string;
  target: string | null;
  request_id: string | null;
  hash: string | null;
  diff: unknown;
}

export interface AuditLogPage {
  items: AuditLogItem[];
  total: number;
  page: number;
  page_size: number;
}

export interface AuditExportRequest {
  id: string;
  applicant_id: string | null;
  applicant_name: string | null;
  reason: string | null;
  status: string;
  approver_id: string | null;
  approver_name: string | null;
  approved_at: string | null;
  created_at: string;
}

export interface AuditQuery {
  actor?: string;
  action?: string;
  from?: string;
  to?: string;
  page?: number;
  page_size?: number;
}

interface AuditLogRow {
  id: string;
  created_at: string;
  actor_id: string | null;
  actor_name: string | null;
  actor_role: string | null;
  action: string;
  target: string | null;
  request_id: string | null;
  hash: string | null;
  diff: string | null;
}

interface ExportRequestRow {
  id: string;
  applicant_id: string | null;
  applicant_name: string | null;
  reason: string | null;
  status: string;
  approver_id: string | null;
  approver_name: string | null;
  approved_at: string | null;
  created_at: string;
}

/** 单条授权在审计日志中的动作（T12 authorize-view 写入） */
export const AUTHORIZATION_ACTIONS = ['feedback.authorize_view'];

/**
 * 后台审计查询与导出审批（T14，B11）。
 * 审计日志只追加：写入口只有 AuditService.append，数据库层有触发器禁止 UPDATE / DELETE；
 * 哈希链校验委托 AuditService.verifyChain；导出需审批（审批人不能是申请人本人）。
 */
@Injectable()
export class AdminAuditService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  /** 审计日志：按操作人 / 动作 / 时间范围筛选 + 分页 */
  list(query: AuditQuery): AuditLogPage {
    const page = Math.max(1, Math.floor(query.page ?? 1));
    const pageSize = Math.min(100, Math.max(1, Math.floor(query.page_size ?? 20)));
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (query.actor) {
      where.push('u.name = ?');
      params.push(query.actor);
    }
    if (query.action) {
      where.push('l.action = ?');
      params.push(query.action);
    }
    if (query.from) {
      where.push('l.created_at >= ?');
      params.push(this.assertTime(query.from, '开始时间'));
    }
    if (query.to) {
      where.push('l.created_at <= ?');
      params.push(this.assertTime(query.to, '结束时间'));
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const from = `FROM audit_log l
       LEFT JOIN admin_user u ON u.id = l.actor_id
       LEFT JOIN role r ON r.id = u.role_id`;
    const total = (
      this.db.app.prepare(`SELECT COUNT(*) AS n ${from} ${whereSql}`).get(...params) as { n: number }
    ).n;    const rows = this.db.app
      .prepare(
        `SELECT l.id, l.created_at, l.actor_id, u.name AS actor_name, r.name AS actor_role,
                l.action, l.target, l.request_id, l.hash, l.diff
         ${from} ${whereSql}
         ORDER BY l.created_at DESC, l.rowid DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, pageSize, (page - 1) * pageSize) as unknown as AuditLogRow[];
    return {
      items: rows.map((r) => ({ ...r, diff: parseJson(r.diff) })),
      total,
      page,
      page_size: pageSize,
    };
  }

  /** 哈希链校验（委托 AuditService） */
  verify(): { ok: boolean; broken_at: string | null; reason?: string } {
    const result = this.audit.verifyChain();
    return { ok: result.ok, broken_at: result.broken_at, ...(result.reason ? { reason: result.reason } : {}) };
  }

  /** 单条授权记录（T12 授权写审计 action=feedback.authorize_view） */
  listAuthorizations(query: { page?: number; page_size?: number }): AuditLogPage {
    const page = Math.max(1, Math.floor(query.page ?? 1));
    const pageSize = Math.min(100, Math.max(1, Math.floor(query.page_size ?? 20)));
    const placeholders = AUTHORIZATION_ACTIONS.map(() => '?').join(', ');
    const from = `FROM audit_log l
       LEFT JOIN admin_user u ON u.id = l.actor_id
       LEFT JOIN role r ON r.id = u.role_id
       WHERE l.action IN (${placeholders})`;
    const total = (
      this.db.app.prepare(`SELECT COUNT(*) AS n ${from}`).get(...AUTHORIZATION_ACTIONS) as { n: number }
    ).n;
    const rows = this.db.app
      .prepare(
        `SELECT l.id, l.created_at, l.actor_id, u.name AS actor_name, r.name AS actor_role,
                l.action, l.target, l.request_id, l.hash, l.diff
         ${from}
         ORDER BY l.created_at DESC, l.rowid DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...AUTHORIZATION_ACTIONS, pageSize, (page - 1) * pageSize) as unknown as AuditLogRow[];
    return {
      items: rows.map((r) => ({ ...r, diff: parseJson(r.diff) })),
      total,
      page,
      page_size: pageSize,
    };
  }

  /** 提交导出申请（状态待审批，写审计） */
  requestExport(applicantId: string, reason: string): AuditExportRequest {
    const text = (reason ?? '').trim();
    if (!text) {
      throw new ApiException(ErrorCode.BAD_REQUEST, '请填写导出原因');
    }
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db.app
      .prepare(
        `INSERT INTO audit_export_request (id, applicant_id, reason, status, created_at)
         VALUES (?, ?, ?, '待审批', ?)`,
      )
      .run(id, applicantId, text, now);
    this.audit.append(applicantId, 'audit.export_request', `audit_export_request:${id}`, { reason: text });
    return this.loadRequest(id);
  }

  /** 审批导出申请（仅超级管理员；不能审批本人提交的申请） */
  approveExport(approverId: string, requestId: string): AuditExportRequest {
    const request = this.loadRequest(requestId);
    if (request.status !== '待审批') {
      throw new ApiException(ErrorCode.CONFLICT, '该导出申请已审批，不能重复审批');
    }
    if (request.applicant_id === approverId) {
      throw new ApiException(ErrorCode.CONFLICT, '导出申请不能由本人审批，请换一位超级管理员审批');
    }
    const now = new Date().toISOString();
    this.db.app
      .prepare(`UPDATE audit_export_request SET status = '已批准', approver_id = ?, approved_at = ? WHERE id = ?`)
      .run(approverId, now, requestId);
    this.audit.append(approverId, 'audit.export_approve', `audit_export_request:${requestId}`, {
      applicant_id: request.applicant_id,
      reason: request.reason,
    });
    return this.loadRequest(requestId);
  }

  /** 导出申请列表（按时间倒序） */
  listExportRequests(): AuditExportRequest[] {
    const rows = this.db.app
      .prepare(
        `SELECT q.id, q.applicant_id, a1.name AS applicant_name, q.reason, q.status,
                q.approver_id, a2.name AS approver_name, q.approved_at, q.created_at
         FROM audit_export_request q
         LEFT JOIN admin_user a1 ON a1.id = q.applicant_id
         LEFT JOIN admin_user a2 ON a2.id = q.approver_id
         ORDER BY q.created_at DESC LIMIT 50`,
      )
      .all() as unknown as AuditExportRequest[];
    return rows;
  }

  /**
   * 生成导出文件内容（仅「已审批」的申请可以导出）。
   * 演示实现：把当前筛选范围内的审计日志导出为 JSON 文本（含哈希，便于外部校验）。
   */
  buildExport(actorId: string, requestId?: string): { filename: string; body: string } {
    if (!requestId) {
      throw new ApiException(ErrorCode.CONFLICT, '请先提交审计导出申请，审批通过后才能下载');
    }
    const request = this.loadRequest(requestId);
    // 下载绑定申请人：审批人不能顶替申请人把这次机会用掉（验收反馈第 37 条）
    if (request.applicant_id && request.applicant_id !== actorId) {
      throw new ApiException(
        ErrorCode.FORBIDDEN,
        '导出文件只能由申请人本人下载，请让提交申请的账号登录后下载',
      );
    }
    if (request.status === '已导出') {
      throw new ApiException(ErrorCode.CONFLICT, '该导出申请已下载过一次，不能重复下载');
    }
    if (request.status !== '已批准') {
      throw new ApiException(ErrorCode.CONFLICT, '导出申请还没有通过审批，暂不能下载');
    }
    const rows = this.db.app
      .prepare(
        `SELECT id, created_at, actor_id, action, target, request_id, hash, prev_hash, seq, diff
         FROM audit_log ORDER BY rowid ASC`,
      )
      .all() as Record<string, unknown>[];
    const exportedAt = new Date().toISOString();
    const body = JSON.stringify(
      {
        exported_at: exportedAt,
        exported_by: actorId,
        request: { id: request.id, reason: request.reason, approver: request.approver_name },
        total: rows.length,
        items: rows,
        note: '审计日志只追加；每条记录带哈希与前向哈希，可用 /admin/audit/verify 校验完整性。',
      },
      null,
      2,
    );
    // 一次性消费：下载后标记为已导出，不能重复下载
    this.db.app
      .prepare(`UPDATE audit_export_request SET status = '已导出', exported_at = ?, exported_by = ? WHERE id = ?`)
      .run(exportedAt, actorId, requestId);
    this.audit.append(actorId, 'audit.export', `audit_export_request:${requestId}`, {
      total: rows.length,
    });
    return { filename: `yaoyouju-audit-${exportedAt.slice(0, 10)}.json`, body };
  }

  private loadRequest(id: string): AuditExportRequest {
    const row = this.db.app
      .prepare(
        `SELECT q.id, q.applicant_id, a1.name AS applicant_name, q.reason, q.status,
                q.approver_id, a2.name AS approver_name, q.approved_at, q.created_at
         FROM audit_export_request q
         LEFT JOIN admin_user a1 ON a1.id = q.applicant_id
         LEFT JOIN admin_user a2 ON a2.id = q.approver_id
         WHERE q.id = ?`,
      )
      .get(id) as ExportRequestRow | undefined;
    if (!row) {
      throw new ApiException(ErrorCode.NOT_FOUND, '导出申请不存在');
    }
    return row;
  }

  private assertTime(value: string, label: string): string {
    const time = new Date(value);
    if (Number.isNaN(time.getTime())) {
      throw new ApiException(ErrorCode.BAD_REQUEST, `${label}格式不正确，请使用 UTC ISO8601`);
    }
    return value;
  }
}

function parseJson(text: string | null): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}
