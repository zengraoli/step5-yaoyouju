import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DbService } from '../../db/db.service';
import { ApiException, ErrorCode } from '../../common/api-error';
import { AuditService } from '../../common/audit.service';
import { AdminContext } from './admin-auth.service';

/**
 * 双人确认（B10「双人确认设置」卡片 + 验收反馈第 10 条）。
 *
 * 规则：
 * - 每个高风险动作用一条「确认单」表达：发起人提交 → 另一名具备对应角色的账号确认后才生效；
 * - 发起人与确认人不能是同一人；确认人必须落在该动作的「可确认角色」里；
 * - 确认生效后由调用方执行真正的业务变更，并写审计（confirmation.approved + 业务 action）。
 */

export interface ConfirmationRule {
  /** 动作中文名（界面展示） */
  label: string;
  /** 可发起的角色 */
  requester_roles: string[];
  /** 可确认的角色 */
  confirmer_roles: string[];
  /**
   * 发起人与确认人是否必须为不同角色（默认 true）。
   * 验收反馈第 9 条：撤回 / 下线不能由两名临床审核（或两名超级管理员）完成。
   */
  distinct_roles: boolean;
  /** 界面上对该动作的双人要求说明 */
  requirement: string;
}

export const CONFIRMATION_RULES: Record<string, ConfirmationRule> = {
  'content.withdraw': {
    label: '内容撤回',
    requester_roles: ['临床审核', '超级管理员'],
    confirmer_roles: ['超级管理员', '临床审核'],
    distinct_roles: true,
    requirement: '临床审核 + 超级管理员（两人不能相同）',
  },
  'content.offline': {
    label: '一键下线 / 批量下线',
    requester_roles: ['临床审核', '超级管理员'],
    confirmer_roles: ['超级管理员', '临床审核'],
    distinct_roles: true,
    requirement: '临床审核 + 超级管理员（两人不能相同）',
  },
  'switch.update': {
    label: '高危功能开关变更',
    requester_roles: ['技术负责人', '超级管理员'],
    confirmer_roles: ['超级管理员', '临床审核'],
    distinct_roles: true,
    requirement: '技术负责人 + 临床审核 / 超级管理员（与发起人不同角色）',
  },
  'model.promote': {
    label: '模型发布提升 / 生效',
    requester_roles: ['技术负责人', '超级管理员'],
    confirmer_roles: ['超级管理员'],
    distinct_roles: true,
    requirement: '技术负责人 + 超级管理员（两人不能相同）',
  },
  'model.rollback': {
    label: '模型发布回滚',
    requester_roles: ['技术负责人', '超级管理员'],
    confirmer_roles: ['超级管理员'],
    distinct_roles: true,
    requirement: '技术负责人 + 超级管理员（两人不能相同）',
  },
  'dual_control.update': {
    label: '双人确认设置变更',
    requester_roles: ['合规支持', '超级管理员'],
    confirmer_roles: ['超级管理员'],
    distinct_roles: true,
    requirement: '合规支持 / 超级管理员发起 + 另一角色确认',
  },
  'feedback.authorize': {
    label: '举报原文单条授权',
    requester_roles: ['临床审核'],
    confirmer_roles: ['超级管理员'],
    distinct_roles: true,
    requirement: '临床审核发起 + 超级管理员审批（可撤回）',
  },
  'user.status': {
    label: '后台成员停用 / 启用',
    requester_roles: ['超级管理员'],
    confirmer_roles: ['超级管理员'],
    distinct_roles: false,
    requirement: '超级管理员发起 + 另一名超级管理员确认',
  },
  'feedback.report_handling': {
    label: '举报临床复核处置',
    requester_roles: ['临床审核', '超级管理员'],
    confirmer_roles: ['超级管理员', '临床审核'],
    distinct_roles: true,
    requirement: '临床审核 + 超级管理员（两人不能相同）',
  },
};

export type ConfirmationStatus = '待确认' | '已生效' | '已驳回' | '已撤销';

export interface ConfirmationItem {
  id: string;
  action: string;
  label: string;
  target_id: string;
  target_label: string;
  payload: Record<string, unknown>;
  note: string | null;
  status: ConfirmationStatus;
  requested_by: string;
  requested_by_name: string;
  requested_by_role: string;
  confirmed_by_role?: string | null;
  requested_at: string;
  confirmed_by: string | null;
  confirmed_by_name: string | null;
  confirmed_at: string | null;
  requirement: string;
  /** 当前登录账号（viewer）是否可以确认本单（界面「确认并执行」按钮用） */
  can_confirm?: boolean;
  reject_reason?: string | null;
}

export interface ClaimedConfirmation {
  id: string;
  action: string;
  target_id: string;
  payload: Record<string, unknown>;
  requester: AdminContext;
}

@Injectable()
export class ConfirmationService {
  private readonly logger = new Logger('Confirmations');

  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {
    this.db.app.exec(`
      CREATE TABLE IF NOT EXISTS confirmation_request (
        id             TEXT PRIMARY KEY,
        action         TEXT NOT NULL,
        target_id      TEXT NOT NULL,
        target_label   TEXT NOT NULL DEFAULT '',
        payload        TEXT,
        note           TEXT,
        status         TEXT NOT NULL DEFAULT '待确认',
        requested_by   TEXT NOT NULL,
        requested_at   TEXT NOT NULL,
        confirmed_by   TEXT,
        confirmed_at   TEXT,
        reject_reason  TEXT,
        applied_at     TEXT
      );
    `);
  }

  /** 发起一条确认单（本人角色必须在可发起角色里） */
  request(
    action: string,
    targetId: string,
    payload: Record<string, unknown>,
    note: string | null,
    admin: AdminContext,
    targetLabel = '',
  ): ConfirmationItem {
    const rule = this.rule(action);
    if (!rule.requester_roles.includes(admin.role.name)) {
      throw new ApiException(
        ErrorCode.FORBIDDEN,
        `「${rule.label}」需要由 ${rule.requester_roles.join(' / ')} 发起`,
      );
    }
    const text = (note ?? '').trim();
    if (!text) {
      throw new ApiException(ErrorCode.BAD_REQUEST, '请填写变更原因（写审计）');
    }
    // 同一目标同一动作已有待确认单时不允许重复发起
    const pending = this.db.app
      .prepare(
        `SELECT id FROM confirmation_request
         WHERE action = ? AND target_id = ? AND status = '待确认'`,
      )
      .get(action, targetId) as { id: string } | undefined;
    if (pending) {
      throw new ApiException(ErrorCode.CONFLICT, '该对象已有一条待确认的申请，请等待确认或先撤销');
    }
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db.app
      .prepare(
        `INSERT INTO confirmation_request
           (id, action, target_id, target_label, payload, note, status, requested_by, requested_at)
         VALUES (?, ?, ?, ?, ?, ?, '待确认', ?, ?)`,
      )
      .run(id, action, targetId, targetLabel, JSON.stringify(payload), text, admin.id, now);
    this.audit.append(admin.id, 'confirmation.request', `confirmation_request:${id}`, {
      action,
      target_id: targetId,
      note: text,
    });
    this.logger.log(`[confirm] ${admin.name} 发起「${rule.label}」确认单（${action} ${targetId}）`);
    return this.toItem(this.require(id));
  }

  /**
   * 确认并领取执行权：校验角色、校验不是本人，然后把单子标记为已生效。
   * 调用方拿到返回值后执行真正的业务变更。
   */
  claim(id: string, admin: AdminContext): ClaimedConfirmation {
    const row = this.require(id);
    if (row.status !== '待确认') {
      throw new ApiException(ErrorCode.CONFLICT, `该确认单已${row.status}，不能重复处理`);
    }
    this.assertCanConfirm(row, admin);
    const rule = this.rule(row.action);
    const now = new Date().toISOString();
    this.db.app
      .prepare(
        `UPDATE confirmation_request SET status = '已生效', confirmed_by = ?, confirmed_at = ?
         WHERE id = ? AND status = '待确认'`,
      )
      .run(admin.id, now, id);
    this.audit.append(admin.id, 'confirmation.approved', `confirmation_request:${id}`, {
      action: row.action,
      target_id: row.target_id,
      requested_by: row.requested_by,
    });
    this.logger.log(`[confirm] ${admin.name} 确认「${rule.label}」确认单，可以生效`);
    return {
      id,
      action: row.action,
      target_id: row.target_id,
      payload: parsePayload(row.payload),
      requester: this.adminById(row.requested_by),
    };
  }

  /** 驳回（不留执行权） */
  reject(id: string, admin: AdminContext, reason: string): ConfirmationItem {
    const row = this.require(id);
    if (row.status !== '待确认') {
      throw new ApiException(ErrorCode.CONFLICT, `该确认单已${row.status}，不能重复处理`);
    }
    // 只有该动作的合法确认人能驳回（反馈：运营 / 合规 / 技术不能驳回别人的高危开关申请）
    this.assertCanConfirm(row, admin);
    const text = (reason ?? '').trim() || '未填写原因';
    this.db.app
      .prepare(
        `UPDATE confirmation_request SET status = '已驳回', confirmed_by = ?, confirmed_at = ?, reject_reason = ?
         WHERE id = ? AND status = '待确认'`,
      )
      .run(admin.id, new Date().toISOString(), text, id);
    this.audit.append(admin.id, 'confirmation.rejected', `confirmation_request:${id}`, {
      action: row.action,
      reason: text,
    });
    return this.toItem(this.require(id));
  }

  /** 发起人撤销自己的确认单 */
  cancel(id: string, admin: AdminContext): ConfirmationItem {
    const row = this.require(id);
    if (row.status !== '待确认') {
      throw new ApiException(ErrorCode.CONFLICT, `该确认单已${row.status}，不能撤销`);
    }
    if (row.requested_by !== admin.id) {
      throw new ApiException(ErrorCode.FORBIDDEN, '只能撤销自己发起的确认单');
    }
    this.db.app
      .prepare(`UPDATE confirmation_request SET status = '已撤销' WHERE id = ?`)
      .run(id);
    this.audit.append(admin.id, 'confirmation.cancelled', `confirmation_request:${id}`, {
      action: row.action,
    });
    return this.toItem(this.require(id));
  }

  /** 标记已应用到业务（调用方执行完业务变更后调用） */
  markApplied(id: string): void {
    this.db.app
      .prepare(`UPDATE confirmation_request SET applied_at = ? WHERE id = ?`)
      .run(new Date().toISOString(), id);
  }

  /**
   * 高风险动作的统一入口：
   * - 未携带 confirmation_id → 创建待确认单，返回 proceed=false（界面提示等待另一人确认）；
   * - 携带 confirmation_id → 校验角色与「不能同一个人」，通过后返回 proceed=true，
   *   调用方此时才执行真正的业务变更，完成后调用 markApplied。
   */
  prepare(
    action: string,
    targetId: string,
    targetLabel: string,
    note: string | null,
    admin: AdminContext,
    confirmationId?: string | null,
    payload: Record<string, unknown> = {},
  ): { proceed: boolean; confirmation: ConfirmationItem | null } {
    if (confirmationId) {
      const row = this.require(confirmationId);
      if (row.status === '待确认') {
        this.claim(confirmationId, admin);
      } else if (row.status === '已生效' && !row.applied_at && row.confirmed_by === admin.id) {
        // approve→execute 交接：本人在本流程中确认、尚未执行业务，允许带入执行；
        // 一旦 applied_at 已写（业务已执行）即不可复用（反馈：确认人不能单独重复执行）。
      } else {
        throw new ApiException(
          ErrorCode.CONFLICT,
          row.applied_at ? '该确认单已执行，不能重复处理' : `该确认单已${row.status}，不能重复处理`,
        );
      }
      if (row.action !== action || row.target_id !== targetId) {
        throw new ApiException(ErrorCode.CONFLICT, '确认单与当前操作不匹配，请重新发起');
      }
      return { proceed: true, confirmation: this.byId(confirmationId) };
    }
    const confirmation = this.request(action, targetId, payload, note, admin, targetLabel);
    return { proceed: false, confirmation };
  }

  /**
   * 确认并执行业务（另一名具备权限的账号在待确认单列表里点「确认并执行」）。
   * 领到执行权后由 executor 完成真正的业务变更，完成后标记 applied。
   */
  approveAndExecute(
    id: string,
    admin: AdminContext,
    executor: { execute: (claimed: ClaimedConfirmation, admin: AdminContext) => unknown },
  ): unknown {
    const claimed = this.claim(id, admin);
    let result: unknown;
    try {
      result = executor.execute(claimed, admin);
    } catch (e) {
      // 执行失败：回退为待确认（清空确认人），让另一人可以重试，避免单据卡在「已生效」
      this.revertOnFailure(id);
      throw e;
    }
    this.markApplied(id);
    return result;
  }

  /**
   * 校验当前账号是否可以确认 / 驳回某条确认单（claim / reject / 界面 can_confirm 共用）。
   * 校验：不是发起人、已绑定 MFA、落在可确认角色、满足不同角色要求、具备基础权限。
   */
  private assertCanConfirm(row: ConfirmationRow, admin: AdminContext): void {
    const rule = this.rule(row.action);
    if (row.requested_by === admin.id) {
      throw new ApiException(ErrorCode.CONFLICT, '双人确认不能由同一个人完成，请换一位具备权限的账号确认');
    }
    if (!admin.mfa_enabled) {
      throw new ApiException(
        ErrorCode.FORBIDDEN,
        '确认高风险操作前需先绑定动态验证码（MFA），请退出后在登录页完成绑定',
      );
    }
    if (!rule.confirmer_roles.includes(admin.role.name)) {
      throw new ApiException(
        ErrorCode.FORBIDDEN,
        `「${rule.label}」的确认需要 ${rule.confirmer_roles.join(' / ')} 角色`,
      );
    }
    const requester = this.adminById(row.requested_by);
    if (rule.distinct_roles !== false && requester.role.name === admin.role.name) {
      throw new ApiException(
        ErrorCode.CONFLICT,
        `「${rule.label}」的双人确认需要两名不同角色的账号（${requester.role.name} 不能确认自己的申请），${rule.requirement}`,
      );
    }
    if (!admin.permissions.includes('*') && !this.canPerform(admin, row.action)) {
      throw new ApiException(ErrorCode.FORBIDDEN, '没有权限执行该操作');
    }
  }

  /** 执行业务失败时确认单回退为待确认（清空确认人），供另一人重试 */
  revertOnFailure(id: string): void {
    const row = this.require(id);
    if (row.status === '已生效' && !row.applied_at) {
      this.db.app
        .prepare(`UPDATE confirmation_request SET status='待确认', confirmed_by=NULL, confirmed_at=NULL WHERE id=?`)
        .run(id);
      this.logger.warn(`[confirm] 确认单 ${id} 执行失败，回退为待确认`);
    }
  }

  /** 已生效确认单（用于界面回显） */
  byId(id: string): ConfirmationItem {
    return this.toItem(this.require(id));
  }
  /**
   * 确认单列表（默认只看待确认）。
   * 每条附带 `can_confirm`：当前登录账号是否可以确认（供界面第二个人在另一台设备上直接确认）。
   */
  list(status?: string, viewer?: AdminContext): ConfirmationItem[] {
    const rows = (
      status && status !== '全部'
        ? this.db.app
            .prepare('SELECT * FROM confirmation_request WHERE status = ? ORDER BY requested_at DESC, rowid DESC')
            .all(status)
        : this.db.app
            .prepare('SELECT * FROM confirmation_request ORDER BY requested_at DESC, rowid DESC LIMIT 100')
            .all()
    ) as ConfirmationRow[];
    const items = rows.map((r) => this.toItem(r, viewer));
    if (!viewer) return items;
    // 反馈：不是所有角色都该看到全部待确认单。仅显示「待我确认（can_confirm）」与「我发起的」。
    return items.filter((it) => it.can_confirm || it.requested_by === viewer.id);
  }

  /** 某个业务动作的确认要求说明（B10 卡片用） */
  requirements(): { action: string; label: string; requirement: string; pending: number }[] {
    return Object.entries(CONFIRMATION_RULES).map(([action, rule]) => ({
      action,
      label: rule.label,
      requirement: rule.requirement,
      pending: (
        this.db.app
          .prepare(`SELECT COUNT(*) AS n FROM confirmation_request WHERE action = ? AND status = '待确认'`)
          .get(action) as { n: number }
      ).n,
    }));
  }

  rule(action: string): ConfirmationRule {
    const rule = CONFIRMATION_RULES[action];
    if (!rule) throw new ApiException(ErrorCode.BAD_REQUEST, `未知的确认动作：${action}`);
    return rule;
  }

  /** 界面回显：当前账号是否可确认该待确认单（不抛错版本） */
  private canConfirmRow(row: ConfirmationRow, viewer: AdminContext): boolean {
    if (row.status !== '待确认') return false;
    const rule = CONFIRMATION_RULES[row.action];
    if (!rule) return false;
    if (row.requested_by === viewer.id) return false;
    if (!viewer.mfa_enabled) return false;
    if (!rule.confirmer_roles.includes(viewer.role.name)) return false;
    const requester = this.adminById(row.requested_by);
    if (rule.distinct_roles !== false && requester.role.name === viewer.role.name) return false;
    if (!viewer.permissions.includes('*') && !this.canPerform(viewer, row.action)) return false;
    return true;
  }

  /** 该角色是否有该动作对应的基础权限（确认人必须自己也有权限） */
  private canPerform(admin: AdminContext, action: string): boolean {
    const requiredByAction: Record<string, string> = {
      'content.withdraw': 'content.offline',
      'content.offline': 'content.offline',
      'switch.update': 'switch.manage',
      'model.promote': 'model.manage',
      'model.rollback': 'model.manage',
      'dual_control.update': 'dual_control.manage',
      'feedback.authorize': 'feedback.handle',
      'user.status': 'user.manage',
      'feedback.report_handling': 'feedback.handle',
    };
    const need = requiredByAction[action];
    if (!need) return true;
    if (admin.permissions.includes('*')) return true;
    return admin.permissions.includes(need) || (need === 'switch.manage' && admin.permissions.includes('switch.manage_low'));
  }

  private require(id: string): ConfirmationRow {
    const row = this.db.app.prepare('SELECT * FROM confirmation_request WHERE id = ?').get(id) as
      | ConfirmationRow
      | undefined;
    if (!row) throw new ApiException(ErrorCode.NOT_FOUND, '确认单不存在');
    return row;
  }

  private adminById(id: string): AdminContext {
    const row = this.db.app
      .prepare(
        `SELECT u.id, u.name, u.role_id, r.name AS role_name
         FROM admin_user u JOIN role r ON r.id = u.role_id WHERE u.id = ?`,
      )
      .get(id) as { id: string; name: string; role_id: string; role_name: string } | undefined;
    return {
      id,
      name: row?.name ?? '已注销账号',
      role: { id: row?.role_id ?? '', name: row?.role_name ?? '未知角色' },
      permissions: [],
      mfa_enabled: true,
    };
  }

  private toItem(row: ConfirmationRow, viewer?: AdminContext): ConfirmationItem {
    const rule = CONFIRMATION_RULES[row.action];
    const requester = this.adminById(row.requested_by);
    const confirmer = row.confirmed_by ? this.adminById(row.confirmed_by) : null;
    const canConfirm = viewer ? this.canConfirmRow(row, viewer) : false;
    return {
      id: row.id,
      action: row.action,
      label: rule?.label ?? row.action,
      target_id: row.target_id,
      target_label: row.target_label,
      payload: parsePayload(row.payload),
      note: row.note,
      status: row.status as ConfirmationStatus,
      requested_by: row.requested_by,
      requested_by_name: requester.name,
      requested_by_role: requester.role.name,
      requested_at: row.requested_at,
      confirmed_by: row.confirmed_by,
      confirmed_by_name: confirmer?.name ?? null,
      confirmed_at: row.confirmed_at,
      requirement: rule?.requirement ?? '',
      reject_reason: row.reject_reason,
      ...(viewer ? { can_confirm: canConfirm } : {}),
    };
  }
}

type ConfirmationRow = {
  id: string;
  action: string;
  target_id: string;
  target_label: string;
  payload: string | null;
  note: string | null;
  status: string;
  requested_by: string;
  requested_at: string;
  confirmed_by: string | null;
  confirmed_at: string | null;
  reject_reason: string | null;
  applied_at: string | null;
};

function parsePayload(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
