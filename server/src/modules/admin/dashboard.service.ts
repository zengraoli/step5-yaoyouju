import { Injectable } from '@nestjs/common';
import { DbService } from '../../db/db.service';
import { beijingDate, beijingDateTime } from '../../common/time.util';

/** 仪表盘汇总（B02）：仅运营与质量指标，不含完整病历与个人内容 */
@Injectable()
export class DashboardService {
  constructor(private readonly db: DbService) {}

  summary(adminId: string) {
    const app = this.db.app;
    const now = Date.now();
    // 「今日」按北京时间划分（验收反馈第 38 条）
    const todayBj = beijingDate(new Date(now).toISOString());
    const dayStartUtc = new Date(`${todayBj}T00:00:00.000+08:00`).toISOString();
    const dayAgo = new Date(now - 24 * 3600 * 1000).toISOString();

    // 今日分析任务（北京时间今日）
    const tasks = app
      .prepare(`SELECT status, created_at FROM analysis_task WHERE created_at >= ?`)
      .all(dayStartUtc) as { status: string; created_at: string }[];
    const todayTotal = tasks.length;
    const todayDone = tasks.filter((t) => t.status === 'completed').length;
    const todayFailed = tasks.filter((t) => t.status === 'failed').length;
    // 阻断（红旗）：北京时间今日命中的安全事件数
    const todayBlocked = (
      app.prepare(`SELECT COUNT(*) n FROM safety_event WHERE created_at >= ?`).get(dayStartUtc) as { n: number }
    ).n;

    // 失败率（最近 15 分钟）
    const quarterAgo = new Date(now - 15 * 60 * 1000).toISOString();
    const recent = app
      .prepare(`SELECT status FROM analysis_task WHERE created_at >= ?`)
      .all(quarterAgo) as { status: string }[];
    const recentTotal = recent.length;
    const recentFailed = recent.filter((t) => t.status === 'failed').length;
    const failRate = recentTotal > 0 ? Math.round((recentFailed / recentTotal) * 1000) / 10 : 0;

    // 待医学审核内容
    const pendingReview = (
      app.prepare(`SELECT COUNT(*) n FROM content_item WHERE current_status = '待医学审核'`).get() as { n: number }
    ).n;

    // 待处理举报（按严重度；已处理 / 无需处理不计入）
    const reports = app
      .prepare(`SELECT severity, status, created_at FROM feedback WHERE is_error_report = 1`)
      .all() as { severity: string | null; status: string; created_at: string }[];
    const closedStatuses = ['已关闭', '无需处理', '已处理'];
    const openReports = reports.filter((r) => !closedStatuses.includes(r.status));
    const sevCount = (s: string) => openReports.filter((r) => r.severity === s).length;
    // 「待处理」与「处理中」分开计数：待处理不含处理中（验收反馈第 43 条）
    const pendingOnly = openReports.filter((r) => r.status === '待处理').length;
    const inProgress = openReports.filter((r) => r.status === '处理中').length;
    const sevPending = (s: string) =>
      openReports.filter((r) => r.severity === s && r.status === '待处理').length;

    // 举报平均处理时长（已处理的举报：处理记录时间 - 创建时间）
    const handledRows = app
      .prepare(
        `SELECT f.created_at AS created_at, MIN(h.created_at) AS handled_at
         FROM feedback f JOIN feedback_handling h ON h.feedback_id = f.id
         WHERE f.is_error_report = 1
         GROUP BY f.id`,
      )
      .all() as { created_at: string; handled_at: string }[];
    const avgHandleDays =
      handledRows.length === 0
        ? null
        : Math.round(
            (handledRows.reduce((sum, r) => sum + (new Date(r.handled_at).getTime() - new Date(r.created_at).getTime()), 0) /
              handledRows.length) /
              (24 * 3600 * 1000) *
              10,
          ) / 10;

    // 安全事件（24 小时）
    const safetyEvents = app
      .prepare(
        `SELECT rule_code, severity, action_taken, created_at FROM safety_event
         WHERE created_at >= ? ORDER BY created_at DESC LIMIT 20`,
      )
      .all(dayAgo) as { rule_code: string; severity: string; action_taken: string; created_at: string }[];

    // 功能开关
    const switches = app
      .prepare(`SELECT key, enabled, reason FROM feature_switch`)
      .all() as { key: string; enabled: number; reason: string | null }[];

    // 评测门禁（最近一次运行）
    const evalRun = app
      .prepare(`SELECT metrics, result, created_at FROM eval_run ORDER BY created_at DESC LIMIT 1`)
      .get() as { metrics: string | null; result: string; created_at: string } | undefined;

    // 候选发布是否被阻断（存在任一评测运行「阻断发布」且没有通过全部必需集）
    const blockedCandidates = (
      app
        .prepare(
          `SELECT COUNT(*) n FROM model_release WHERE status IN ('候选', '灰度')
           AND id IN (SELECT model_release_id FROM eval_run WHERE result = '阻断发布')`,
        )
        .get() as { n: number }
    ).n;

    // 最近 7 日任务量（按北京时间日期）
    const days: { date: string; total: number; failed: number }[] = [];
    for (let i = 6; i >= 0; i -= 1) {
      const d = new Date(now - i * 24 * 3600 * 1000);
      const date = beijingDate(d.toISOString());
      const start = new Date(`${date}T00:00:00.000+08:00`).toISOString();
      const end = new Date(`${date}T00:00:00.000+08:00`).getTime() + 24 * 3600 * 1000;
      const rows = app
        .prepare(`SELECT status FROM analysis_task WHERE created_at >= ? AND created_at < ?`)
        .all(start, new Date(end).toISOString()) as { status: string }[];
      days.push({
        date,
        total: rows.length,
        failed: rows.filter((r) => r.status === 'failed').length,
      });
    }

    // 待办（全部由真实数据推导）
    const pendingExports = (
      app.prepare(`SELECT COUNT(*) n FROM audit_export_request WHERE status = '待审批'`).get() as { n: number }
    ).n;
    const licensePending = (
      app
        .prepare(`SELECT COUNT(*) n FROM evidence_doc WHERE license = '待确认' OR verified_at IS NULL`)
        .get() as { n: number }
    ).n;
    const todos: { text: string; kind: string }[] = [];
    if (pendingReview > 0) todos.push({ text: `${pendingReview} 条内容待医学审核`, kind: '内容审核' });
    if (pendingOnly > 0) todos.push({ text: `${pendingOnly} 条举报待复核`, kind: '举报复核' });
    if (pendingExports > 0) todos.push({ text: `${pendingExports} 条审计导出申请待审批`, kind: '审计导出' });
    if (licensePending > 0) todos.push({ text: `${licensePending} 条证据许可待核实`, kind: '证据核实' });
    const pendingConfirmations = (
      app.prepare(`SELECT COUNT(*) n FROM confirmation_request WHERE status = '待确认'`).get() as { n: number }
    ).n;
    if (pendingConfirmations > 0) {
      todos.push({ text: `${pendingConfirmations} 项双人确认待另一人确认`, kind: '双人确认' });
    }

    return {
      generated_at: new Date(now).toISOString(),
      generated_at_beijing: beijingDateTime(new Date(now).toISOString()),
      admin_id: adminId,
      today: {
        date: todayBj,
        analysis_total: todayTotal,
        analysis_done: todayDone,
        analysis_failed: todayFailed,
        analysis_blocked: todayBlocked,
      },
      fail_rate_15m: { value: failRate, threshold: 5, total: recentTotal, failed: recentFailed },
      pending_review: pendingReview,
      pending_reports: {
        total: openReports.length,
        pending: pendingOnly,
        in_progress: inProgress,
        high: sevCount('high'),
        medium: sevCount('medium'),
        low: sevCount('low'),
        pending_high: sevPending('high'),
        pending_medium: sevPending('medium'),
        pending_low: sevPending('low'),
        avg_handle_days: avgHandleDays,
      },
      safety_events_24h: safetyEvents.map((e) => ({
        rule_code: e.rule_code,
        severity: e.severity,
        action: e.action_taken,
        source: '当前情况确认 / 问与解释',
        created_at: e.created_at,
      })),
      switches: switches.map((s) => ({ key: s.key, enabled: s.enabled === 1, reason: s.reason })),
      eval_gate: evalRun
        ? {
            result: evalRun.result,
            metrics: evalRun.metrics ? JSON.parse(evalRun.metrics) : {},
            created_at: evalRun.created_at,
          }
        : null,
      blocked_candidates: blockedCandidates,
      last_7_days: days,
      todos: todos.map((t) => t.text),
      todo_items: todos,
    };
  }
}
