import { Injectable } from '@nestjs/common';
import { DbService } from '../../db/db.service';

/** 仪表盘汇总（B02）：仅运营与质量指标，不含完整病历与个人内容 */
@Injectable()
export class DashboardService {
  constructor(private readonly db: DbService) {}

  summary(adminId: string) {
    const app = this.db.app;
    const now = Date.now();
    const todayStart = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z');
    const dayAgo = new Date(now - 24 * 3600 * 1000).toISOString();

    // 今日分析任务
    const tasks = app
      .prepare(`SELECT status, created_at FROM analysis_task WHERE created_at >= ?`)
      .all(todayStart.toISOString()) as { status: string; created_at: string }[];
    const todayTotal = tasks.length;
    const todayDone = tasks.filter((t) => t.status === 'completed').length;
    const todayFailed = tasks.filter((t) => t.status === 'failed').length;
    // 阻断（红旗）：今日创建的安全事件数
    const todayBlocked = (
      app.prepare(`SELECT COUNT(*) n FROM safety_event WHERE created_at >= ?`).get(dayAgo) as { n: number }
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
      app.prepare(`SELECT COUNT(*) n FROM content_item WHERE current_status = '待审'`).get() as { n: number }
    ).n;

    // 待处理举报（按严重度）
    const reports = app
      .prepare(`SELECT severity, status FROM feedback WHERE is_error_report = 1`)
      .all() as { severity: string | null; status: string }[];
    const openReports = reports.filter((r) => r.status !== '已关闭' && r.status !== '无需处理');
    const sevCount = (s: string) => openReports.filter((r) => r.severity === s).length;

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

    // 最近 7 日任务量
    const days: { date: string; total: number; failed: number }[] = [];
    for (let i = 6; i >= 0; i -= 1) {
      const d = new Date(now - i * 24 * 3600 * 1000);
      const date = d.toISOString().slice(0, 10);
      const start = `${date}T00:00:00.000Z`;
      const end = `${date}T23:59:59.999Z`;
      const rows = app
        .prepare(`SELECT status FROM analysis_task WHERE created_at >= ? AND created_at <= ?`)
        .all(start, end) as { status: string }[];
      days.push({
        date,
        total: rows.length,
        failed: rows.filter((r) => r.status === 'failed').length,
      });
    }

    // 待办（演示规则：待审内容 + 待处理举报 + 审计导出申请）
    const pendingExports = (
      app.prepare(`SELECT COUNT(*) n FROM audit_export_request WHERE status = '待审批'`).get() as { n: number }
    ).n;
    const todos: string[] = [];
    if (pendingReview > 0) todos.push(`审核：${pendingReview} 条内容待医学审核`);
    if (openReports.length > 0) todos.push(`复核举报 #待处理 ${openReports.length} 条`);
    if (pendingExports > 0) todos.push(`核实证据条目：指南 G-07 许可待确认`);

    return {
      generated_at: new Date(now).toISOString(),
      admin_id: adminId,
      today: {
        analysis_total: todayTotal,
        analysis_done: todayDone,
        analysis_failed: todayFailed,
        analysis_blocked: todayBlocked,
      },
      fail_rate_15m: { value: failRate, threshold: 5, total: recentTotal, failed: recentFailed },
      pending_review: pendingReview,
      pending_reports: {
        total: openReports.length,
        high: sevCount('high'),
        medium: sevCount('medium'),
        low: sevCount('low'),
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
      last_7_days: days,
      todos,
    };
  }
}
