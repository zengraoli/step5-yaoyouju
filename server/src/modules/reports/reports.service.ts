import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DbService } from '../../db/db.service';
import { ApiException, ErrorCode } from '../../common/api-error';
import { normalizeInstant } from '../../common/time.util';
import { SwitchesService } from '../switches/switches.service';
import { SOURCE_TYPES } from '../episodes/episodes.service';
import { SAMPLE_REPORT_TEXT, extractTerms } from './term-dict';

export interface ReportView {
  id: string;
  care_event_id: string;
  episode_id: string;
  report_date: string | null;
  raw_text: string;
  extracted_terms: { term: string; meaning: string; start: number; end: number }[];
  source_type: string;
  verify_status: string;
  occurred_at: string;
}

@Injectable()
export class ReportsService {
  private readonly logger = new Logger('Reports');

  constructor(
    private readonly db: DbService,
    private readonly switches: SwitchesService,
  ) {}

  /**
   * 录入报告（主路径：粘贴文字）。
   * 若未提供 care_event_id，则自动创建一条「报告」病程事件。
   */
  create(
    userId: string,
    input: {
      episode_id: string;
      care_event_id?: string;
      report_date?: string | null;
      raw_text: string;
      source_type?: string;
      verify_status?: string;
    },
  ): ReportView {
    const ep = this.ownedEpisode(userId, input.episode_id);
    const text = (input.raw_text ?? '').trim();
    if (!text) {
      throw new ApiException(ErrorCode.BAD_REQUEST, '请粘贴报告文字，或使用拍照提取（模拟 OCR）');
    }
    const sourceType = input.source_type ?? '报告原文';
    if (!SOURCE_TYPES.includes(sourceType as never)) {
      throw new ApiException(ErrorCode.BAD_REQUEST, `来源类型必须是：${SOURCE_TYPES.join(' / ')}`);
    }
    const verify = input.verify_status ?? '尚未确认';
    const now = new Date().toISOString();
    const occurred = input.report_date ? normalizeInstant(input.report_date) : now;

    let careEventId: string | undefined = input.care_event_id;
    if (careEventId) {
      const ev = this.db.app.prepare('SELECT * FROM care_event WHERE id = ?').get(careEventId) as
        | Record<string, unknown>
        | undefined;
      if (!ev || ev.episode_id !== ep.id) {
        throw new ApiException(ErrorCode.NOT_FOUND, '病程事件不存在');
      }
      careEventId = ev.id as string;
    } else {
      careEventId = randomUUID();
      this.db.app
        .prepare(
          `INSERT INTO care_event (id, episode_id, event_type, occurred_at, reported_at, source_type, raw_text, verify_status, created_at)
           VALUES (?, ?, '报告', ?, ?, ?, ?, ?, ?)`,
        )
        .run(careEventId, ep.id as string, occurred, now, sourceType, text, verify, now);
    }

    const id = randomUUID();
    this.db.app
      .prepare(
        `INSERT INTO report (id, care_event_id, report_date, raw_text, extracted_terms, oss_key)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        careEventId,
        input.report_date ?? occurred.slice(0, 10),
        text,
        JSON.stringify(extractTerms(text)),
        `local://reports/${id}`,
      );
    this.logger.log(`[report] 录入报告 ${id.slice(0, 8)}…（${text.length} 字，术语 ${extractTerms(text).length} 个）`);
    return this.get(userId, id);
  }

  /** 拍照提取（模拟 OCR）：返回示例文本；受「拍照提取」开关控制 */
  ocr(userId: string): { text: string; simulated: boolean; message: string } {
    void userId;
    if (!this.switches.isEnabled('拍照提取')) {
      throw new ApiException(
        ErrorCode.SERVICE_UNAVAILABLE,
        '拍照提取当前未开启，请直接粘贴报告文字',
      );
    }
    return {
      text: SAMPLE_REPORT_TEXT,
      simulated: true,
      message: '演示实现：OCR 为模拟结果，请核对后使用；主路径是粘贴文字',
    };
  }

  get(userId: string, reportId: string): ReportView {
    const row = this.db.app
      .prepare(
        `SELECT r.*, c.episode_id, c.source_type, c.verify_status, c.occurred_at
         FROM report r JOIN care_event c ON c.id = r.care_event_id
         JOIN episode e ON e.id = c.episode_id
         WHERE r.id = ? AND e.user_id = ?`,
      )
      .get(reportId, userId) as Record<string, unknown> | undefined;
    if (!row) throw new ApiException(ErrorCode.NOT_FOUND, '报告不存在');
    return this.view(row);
  }

  listByEpisode(userId: string, episodeId: string): ReportView[] {
    this.ownedEpisode(userId, episodeId);
    const rows = this.db.app
      .prepare(
        `SELECT r.*, c.episode_id, c.source_type, c.verify_status, c.occurred_at
         FROM report r JOIN care_event c ON c.id = r.care_event_id
         WHERE c.episode_id = ? ORDER BY c.occurred_at DESC`,
      )
      .all(episodeId) as Record<string, unknown>[];
    return rows.map((r) => this.view(r));
  }

  /**
   * 结构化核对：返回来源、时间、核实状态与术语；
   * 「有冲突」项必须由用户确认（verify_status 显式改为已确认后才消失）。
   */
  structured(userId: string, episodeId: string) {
    this.ownedEpisode(userId, episodeId);
    const events = this.db.app
      .prepare(
        `SELECT c.*, r.id AS report_id, r.report_date, r.extracted_terms, r.raw_text AS report_text
         FROM care_event c LEFT JOIN report r ON r.care_event_id = c.id
         WHERE c.episode_id = ? ORDER BY c.occurred_at DESC`,
      )
      .all(episodeId) as Record<string, unknown>[];
    return {
      items: events.map((e) => ({
        care_event_id: e.id,
        event_type: e.event_type,
        source_type: e.source_type,
        occurred_at: e.occurred_at,
        reported_at: e.reported_at,
        verify_status: e.verify_status ?? '尚未确认',
        needs_confirm: (e.verify_status as string) === '有冲突',
        raw_text: (e.raw_text as string | null) ?? null,
        report: e.report_id
          ? {
              id: e.report_id,
              report_date: (e.report_date as string | null) ?? null,
              extracted_terms: e.extracted_terms ? JSON.parse(e.extracted_terms as string) : [],
            }
          : null,
      })),
      summary: {
        total: events.length,
        confirmed: events.filter((e) => e.verify_status === '已确认').length,
        unconfirmed: events.filter((e) => (e.verify_status ?? '尚未确认') === '尚未确认').length,
        conflict: events.filter((e) => e.verify_status === '有冲突').length,
      },
    };
  }

  private view(row: Record<string, unknown>): ReportView {
    return {
      id: row.id as string,
      care_event_id: row.care_event_id as string,
      episode_id: row.episode_id as string,
      report_date: (row.report_date as string | null) ?? null,
      raw_text: row.raw_text as string,
      extracted_terms: row.extracted_terms ? JSON.parse(row.extracted_terms as string) : [],
      source_type: row.source_type as string,
      verify_status: (row.verify_status as string) ?? '尚未确认',
      occurred_at: row.occurred_at as string,
    };
  }

  private ownedEpisode(userId: string, episodeId: string) {
    const ep = this.db.app.prepare('SELECT * FROM episode WHERE id = ?').get(episodeId) as
      | Record<string, unknown>
      | undefined;
    if (!ep || ep.user_id !== userId) {
      throw new ApiException(ErrorCode.NOT_FOUND, '病程不存在');
    }
    return ep;
  }
}
