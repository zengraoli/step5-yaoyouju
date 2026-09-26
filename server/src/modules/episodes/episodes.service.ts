import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DbService } from '../../db/db.service';
import { ApiException, ErrorCode } from '../../common/api-error';
import { normalizeInstant, todayBeijing } from '../../common/time.util';

export const EVENT_TYPES = ['报告', '症状', '医嘱', '行动', '结局'] as const;
export const SOURCE_TYPES = ['自述', '报告原文', '医生记录'] as const;
export const VERIFY_STATUSES = ['已确认', '尚未确认', '有冲突'] as const;
export const LEG_CHANGES = ['有', '无', '尚未确认'] as const;
export const ACTIVITY_DONE = ['完成', '部分完成', '未完成', '尚未确认'] as const;

export const UNCONFIRMED = '尚未确认';

export interface SymptomLogView {
  id: string;
  care_event_id: string;
  date: string;
  sit_minutes: number | null;
  sit_minutes_display: string;
  planned_activity_done: string;
  sleep_impact: number | null;
  sleep_impact_display: string;
  top_worry: string;
  leg_change: string;
}

export interface CareEventView {
  id: string;
  episode_id: string;
  event_type: string;
  occurred_at: string;
  reported_at: string;
  source_type: string;
  raw_text: string | null;
  verify_status: string;
  symptom_log: SymptomLogView | null;
  report: { id: string; report_date: string | null; extracted_terms: unknown } | null;
}

@Injectable()
export class EpisodesService {
  constructor(private readonly db: DbService) {}

  // ---------- 病程 ----------

  list(userId: string) {
    const rows = this.db.app
      .prepare(
        `SELECT e.*, (SELECT COUNT(*) FROM care_event c WHERE c.episode_id = e.id) AS event_count
         FROM episode e WHERE e.user_id = ? ORDER BY e.created_at DESC`,
      )
      .all(userId) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      onset_date: r.onset_date,
      onset_certainty: r.onset_certainty ?? UNCONFIRMED,
      status: r.status,
      created_at: r.created_at,
      event_count: r.event_count,
    }));
  }

  create(
    userId: string,
    input: { title: string; onset_date?: string | null; onset_certainty?: string },
  ) {
    if (!input.title || !input.title.trim()) {
      throw new ApiException(ErrorCode.BAD_REQUEST, '病程标题不能为空');
    }
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db.app
      .prepare(
        `INSERT INTO episode (id, user_id, title, onset_date, onset_certainty, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        userId,
        input.title.trim(),
        input.onset_date ?? null,
        input.onset_certainty ?? UNCONFIRMED,
        '进行中',
        now,
      );
    return this.get(userId, id);
  }

  get(userId: string, episodeId: string) {
    const ep = this.ownedEpisode(userId, episodeId);
    const events = this.db.app
      .prepare(
        `SELECT * FROM care_event WHERE episode_id = ? ORDER BY occurred_at DESC, reported_at DESC`,
      )
      .all(episodeId) as Record<string, unknown>[];
    const analysisCount = this.db.app
      .prepare('SELECT COUNT(*) AS n FROM analysis WHERE episode_id = ?')
      .get(episodeId) as { n: number };
    const latestAnalysis = this.db.app
      .prepare(
        'SELECT id FROM analysis WHERE episode_id = ? ORDER BY version DESC, created_at DESC LIMIT 1',
      )
      .get(episodeId) as { id: string } | undefined;
    return {
      id: ep.id,
      title: ep.title,
      onset_date: ep.onset_date,
      onset_certainty: ep.onset_certainty ?? UNCONFIRMED,
      status: ep.status,
      created_at: ep.created_at,
      analysis_count: analysisCount.n,
      latest_analysis_id: latestAnalysis?.id ?? null,
      events: events.map((e) => this.eventView(e)),
    };
  }

  update(userId: string, episodeId: string, input: { title?: string; onset_date?: string | null; onset_certainty?: string; status?: string }) {
    const ep = this.ownedEpisode(userId, episodeId);
    const title = input.title?.trim() || (ep.title as string);
    const onset = input.onset_date !== undefined ? input.onset_date : (ep.onset_date as string | null);
    const certainty = input.onset_certainty ?? (ep.onset_certainty as string);
    const status = input.status ?? (ep.status as string);
    this.db.app
      .prepare('UPDATE episode SET title = ?, onset_date = ?, onset_certainty = ?, status = ? WHERE id = ?')
      .run(title, onset, certainty, status, episodeId);
    return this.get(userId, episodeId);
  }

  // ---------- 病程事件 ----------

  addEvent(
    userId: string,
    episodeId: string,
    input: {
      event_type: string;
      occurred_at: string;
      source_type: string;
      raw_text?: string | null;
      verify_status?: string;
    },
  ): CareEventView {
    this.ownedEpisode(userId, episodeId);
    if (!EVENT_TYPES.includes(input.event_type as never)) {
      throw new ApiException(ErrorCode.BAD_REQUEST, `事件类型必须是：${EVENT_TYPES.join(' / ')}`);
    }
    if (!SOURCE_TYPES.includes(input.source_type as never)) {
      throw new ApiException(ErrorCode.BAD_REQUEST, `来源类型必须是：${SOURCE_TYPES.join(' / ')}`);
    }
    const verify = input.verify_status ?? UNCONFIRMED;
    if (!VERIFY_STATUSES.includes(verify as never)) {
      throw new ApiException(ErrorCode.BAD_REQUEST, `核实状态必须是：${VERIFY_STATUSES.join(' / ')}`);
    }
    const id = randomUUID();
    const now = new Date().toISOString();
    const occurred = normalizeInstant(input.occurred_at);
    this.db.app
      .prepare(
        `INSERT INTO care_event (id, episode_id, event_type, occurred_at, reported_at, source_type, raw_text, verify_status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, episodeId, input.event_type, occurred, now, input.source_type, input.raw_text ?? null, verify, now);
    const row = this.db.app.prepare('SELECT * FROM care_event WHERE id = ?').get(id) as Record<string, unknown>;
    return this.eventView(row);
  }

  /** 用户纠正自己的记录：内容变化时核实状态降级为「有冲突」，需再次确认 */
  correctEvent(
    userId: string,
    episodeId: string,
    eventId: string,
    input: { raw_text?: string; occurred_at?: string; verify_status?: string; source_type?: string },
  ): CareEventView {
    this.ownedEpisode(userId, episodeId);
    const ev = this.ownedEvent(episodeId, eventId);
    const nextText = input.raw_text !== undefined ? input.raw_text : (ev.raw_text as string | null);
    const nextOccurred = input.occurred_at ? normalizeInstant(input.occurred_at) : (ev.occurred_at as string);
    const nextSource = input.source_type ?? (ev.source_type as string);
    const contentChanged = nextText !== ev.raw_text || nextOccurred !== ev.occurred_at;
    const verify =
      input.verify_status ??
      (contentChanged && ev.verify_status === '已确认' ? '有冲突' : (ev.verify_status as string));
    if (!VERIFY_STATUSES.includes(verify as never)) {
      throw new ApiException(ErrorCode.BAD_REQUEST, `核实状态必须是：${VERIFY_STATUSES.join(' / ')}`);
    }
    this.db.app
      .prepare(
        'UPDATE care_event SET raw_text = ?, occurred_at = ?, source_type = ?, verify_status = ? WHERE id = ?',
      )
      .run(nextText, nextOccurred, nextSource, verify, eventId);
    const row = this.db.app.prepare('SELECT * FROM care_event WHERE id = ?').get(eventId) as Record<string, unknown>;
    return this.eventView(row);
  }

  /** 用户删除自己的记录 */
  deleteEvent(userId: string, episodeId: string, eventId: string): { deleted: boolean } {
    this.ownedEpisode(userId, episodeId);
    this.ownedEvent(episodeId, eventId);
    this.db.app.prepare('DELETE FROM care_event WHERE id = ?').run(eventId);
    return { deleted: true };
  }

  // ---------- 记录今天 ----------

  /**
   * 记录今天：所有字段可缺失（缺失 = 尚未确认，不默认阴性 / 无）。
   * 每天生成新记录，不复用昨日答案；skipped = true 表示今天选择跳过。
   */
  logToday(
    userId: string,
    episodeId: string,
    input: {
      date?: string;
      sit_minutes?: number | null;
      planned_activity_done?: string | null;
      sleep_impact?: number | null;
      top_worry?: string | null;
      leg_change?: string | null;
      skipped?: boolean;
    },
  ): SymptomLogView {
    this.ownedEpisode(userId, episodeId);
    const date = input.date ?? todayBeijing();
    if (input.leg_change && !LEG_CHANGES.includes(input.leg_change as never)) {
      throw new ApiException(ErrorCode.BAD_REQUEST, `腿部变化必须是：${LEG_CHANGES.join(' / ')}`);
    }
    if (
      input.planned_activity_done &&
      !ACTIVITY_DONE.includes(input.planned_activity_done as never)
    ) {
      throw new ApiException(
        ErrorCode.BAD_REQUEST,
        `计划活动完成情况必须是：${ACTIVITY_DONE.join(' / ')}`,
      );
    }
    const eventId = randomUUID();
    const now = new Date().toISOString();
    const occurred = normalizeInstant(date);
    const skipped = input.skipped === true;
    this.db.app
      .prepare(
        `INSERT INTO care_event (id, episode_id, event_type, occurred_at, reported_at, source_type, raw_text, verify_status, created_at)
         VALUES (?, ?, '症状', ?, ?, '自述', ?, '尚未确认', ?)`,
      )
      .run(
        eventId,
        episodeId,
        occurred,
        now,
        skipped ? '今天选择跳过记录' : (input.top_worry?.trim() || null),
        now,
      );
    const logId = randomUUID();
    this.db.app
      .prepare(
        `INSERT INTO symptom_log (id, care_event_id, sit_minutes, planned_activity_done, sleep_impact, top_worry, leg_change)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        logId,
        eventId,
        input.sit_minutes ?? null,
        input.planned_activity_done ?? null,
        input.sleep_impact ?? null,
        input.top_worry?.trim() || null,
        input.leg_change ?? UNCONFIRMED,
      );
    return this.symptomLogView(
      this.db.app.prepare('SELECT * FROM symptom_log WHERE id = ?').get(logId) as Record<string, unknown>,
      date,
    );
  }

  /** 今天的记录状态：没有则返回空（不返回昨日答案） */
  todayStatus(userId: string, episodeId: string) {
    this.ownedEpisode(userId, episodeId);
    const date = todayBeijing();
    // 北京日期 → UTC 时间范围（occurred_at 存 UTC）
    const startUtc = new Date(`${date}T00:00:00.000+08:00`).toISOString();
    const endUtc = new Date(`${date}T00:00:00.000+08:00`).getTime() + 24 * 3600 * 1000;
    const row = this.db.app
      .prepare(
        `SELECT s.* FROM symptom_log s JOIN care_event c ON c.id = s.care_event_id
         WHERE c.episode_id = ? AND c.occurred_at >= ? AND c.occurred_at < ? LIMIT 1`,
      )
      .get(episodeId, startUtc, new Date(endUtc).toISOString()) as Record<string, unknown> | undefined;
    return {
      date,
      logged: Boolean(row),
      log: row ? this.symptomLogView(row, date) : null,
    };
  }

  // ---------- 时间线 ----------

  timeline(userId: string, episodeId: string) {
    this.ownedEpisode(userId, episodeId);
    const rows = this.db.app
      .prepare('SELECT * FROM care_event WHERE episode_id = ? ORDER BY occurred_at ASC')
      .all(episodeId) as Record<string, unknown>[];
    const groups = new Map<string, CareEventView[]>();
    for (const r of rows) {
      const view = this.eventView(r);
      const date = beijingDateOf(view.occurred_at);
      if (!groups.has(date)) groups.set(date, []);
      groups.get(date)!.push(view);
    }
    return [...groups.entries()]
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([date, events]) => ({ date, events }));
  }

  // ---------- 内部 ----------

  private ownedEpisode(userId: string, episodeId: string) {
    const ep = this.db.app.prepare('SELECT * FROM episode WHERE id = ?').get(episodeId) as
      | Record<string, unknown>
      | undefined;
    if (!ep || ep.user_id !== userId) {
      throw new ApiException(ErrorCode.NOT_FOUND, '病程不存在');
    }
    return ep;
  }

  private ownedEvent(episodeId: string, eventId: string) {
    const ev = this.db.app.prepare('SELECT * FROM care_event WHERE id = ?').get(eventId) as
      | Record<string, unknown>
      | undefined;
    if (!ev || ev.episode_id !== episodeId) {
      throw new ApiException(ErrorCode.NOT_FOUND, '病程事件不存在');
    }
    return ev;
  }

  private eventView(row: Record<string, unknown>): CareEventView {
    const log = this.db.app
      .prepare('SELECT * FROM symptom_log WHERE care_event_id = ?')
      .get(row.id as string) as Record<string, unknown> | undefined;
    const report = this.db.app
      .prepare('SELECT id, report_date, extracted_terms FROM report WHERE care_event_id = ?')
      .get(row.id as string) as Record<string, unknown> | undefined;
    return {
      id: row.id as string,
      episode_id: row.episode_id as string,
      event_type: row.event_type as string,
      occurred_at: row.occurred_at as string,
      reported_at: row.reported_at as string,
      source_type: row.source_type as string,
      raw_text: (row.raw_text as string | null) ?? null,
      verify_status: (row.verify_status as string) ?? UNCONFIRMED,
      symptom_log: log
        ? this.symptomLogView(log, beijingDateOf(row.occurred_at as string))
        : null,
      report: report
        ? {
            id: report.id as string,
            report_date: (report.report_date as string | null) ?? null,
            extracted_terms: report.extracted_terms ? JSON.parse(report.extracted_terms as string) : [],
          }
        : null,
    };
  }

  /** 症状日志视图：缺失字段统一返回「尚未确认」语义 */
  symptomLogView(row: Record<string, unknown>, date: string): SymptomLogView {
    const sit = row.sit_minutes as number | null;
    const sleep = row.sleep_impact as number | null;
    const done = (row.planned_activity_done as string | null) ?? UNCONFIRMED;
    const worry = (row.top_worry as string | null)?.trim();
    const leg = (row.leg_change as string | null) ?? UNCONFIRMED;
    return {
      id: row.id as string,
      care_event_id: row.care_event_id as string,
      date,
      sit_minutes: sit ?? null,
      sit_minutes_display: sit === null || sit === undefined ? UNCONFIRMED : `今天能坐约 ${sit} 分钟`,
      planned_activity_done: done,
      sleep_impact: sleep ?? null,
      sleep_impact_display:
        sleep === null || sleep === undefined
          ? UNCONFIRMED
          : sleep === 0
            ? '不影响睡眠'
            : `影响睡眠（程度 ${sleep}/3）`,
      top_worry: worry && worry.length > 0 ? worry : UNCONFIRMED,
      leg_change: leg || UNCONFIRMED,
    };
  }
}

function beijingDateOf(iso: string): string {
  const d = new Date(iso);
  return new Date(d.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
