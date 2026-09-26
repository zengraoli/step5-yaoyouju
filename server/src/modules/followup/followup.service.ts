import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DbService } from '../../db/db.service';
import { ApiException, ErrorCode } from '../../common/api-error';
import { beijingDate } from '../../common/time.util';
import { SOURCE_TYPES, VERIFY_STATUSES, UNCONFIRMED } from '../episodes/episodes.service';

/**
 * 复诊摘要服务（/episodes/{id}/followup，App A12 / Web W06）。
 * 固定六段：起病与时间 / 当前症状 / 检查与报告 / 既往医嘱与行动 / 我的主要担心 / 想请医生确认的问题。
 * 产品红线：
 * - 每条内容标注来源（自述 / 报告原文 / 医生记录），未核实项（尚未确认 / 有冲突）保留并带「未经核实」标记；
 * - 报告未描述的内容显示「报告未提及」，不显示「已排除」；
 * - 系统生成内容带 disclaimer，不作诊断；
 * - 导出文本必做，PDF / 图片由浏览器打印生成（服务端不生成文件）。
 */

/** 固定六段（顺序即排版顺序，与 seed.ts 中 followup_summary.content 结构一致） */
export const FOLLOWUP_SECTIONS = [
  { key: 'onset', title: '起病与时间' },
  { key: 'symptom', title: '当前症状' },
  { key: 'report', title: '检查与报告' },
  { key: 'advice', title: '既往医嘱与行动' },
  { key: 'worry', title: '我的主要担心' },
  { key: 'questions', title: '想请医生确认的问题' },
] as const;

export const FOLLOWUP_SECTION_KEYS = FOLLOWUP_SECTIONS.map((s) => s.key);

/** 问题清单段 key（该段条目是「问题」而不是病程事实，不标核实状态） */
const QUESTIONS_KEY = 'questions';

/** 导出格式：文本必做；PDF / 图片由浏览器打印生成（演示实现） */
export const EXPORT_FORMATS = ['文本', 'PDF', '图片'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

/** 导出文本头部与水印脚注（Web W06 A4 打印预览同款文案） */
export const EXPORT_TITLE = '就诊交接摘要';
export const FOLLOWUP_DISCLAIMER = '本摘要由用户整理，系统生成内容仅供参考，不作诊断';

/** 摘要条目：文字 + 来源类型；病程事实另带核实状态（问题清单不适用） */
export interface FollowupItem {
  text: string;
  source: string;
  verify_status?: string;
  /** 来源病程事件（可定位原文） */
  care_event_id?: string;
  /** 问题清单来源：用户加入（问与解释一键加入）/ 分析整理（一页分析 next 段） */
  from?: string;
}

export interface FollowupSection {
  key: string;
  title: string;
  items: FollowupItem[];
}

export interface FollowupContent {
  sections: FollowupSection[];
  /** 生成时间（UTC ISO8601；表结构无 created_at 列，随 content 保存） */
  generated_at: string | null;
  /** 是否被用户预览后纠正 */
  corrected?: boolean;
  corrected_at?: string;
  disclaimer: string;
}

export interface FollowupSummaryView {
  id: string;
  episode_id: string;
  content: FollowupContent;
  generated_at: string | null;
  corrected: boolean;
  /** 是否已导出（exported_at 非空） */
  exported: boolean;
  export_format: string | null;
  exported_at: string | null;
  disclaimer: string;
}

export interface FollowupExportView {
  id: string;
  episode_id: string;
  format: ExportFormat;
  export_format: ExportFormat;
  exported_at: string;
  /** 文本：完整纯文本；PDF / 图片：浏览器打印说明文本 */
  text: string;
  /** PDF / 图片由浏览器打印生成（服务端不生成文件） */
  browser_print: boolean;
  note: string;
}

type EpisodeRow = {
  id: string;
  user_id: string;
  title: string;
  onset_date: string | null;
  onset_certainty: string | null;
  status: string;
  created_at: string;
};

type EventRow = {
  id: string;
  episode_id: string;
  event_type: string;
  occurred_at: string;
  reported_at: string;
  source_type: string;
  raw_text: string | null;
  verify_status: string;
};

type SummaryRow = {
  id: string;
  episode_id: string;
  content: string | null;
  export_format: string | null;
  exported_at: string | null;
};

/** 条目文字上限（避免粘贴超长文本撑爆摘要） */
const MAX_ITEM_TEXT = 1000;

@Injectable()
export class FollowupService {
  private readonly logger = new Logger('Followup');

  constructor(private readonly db: DbService) {}

  // ---------- 生成 / 预览 / 纠正 / 导出 ----------

  /** 从该 episode 的 care_event 自动生成六段草稿（每次生成新的一份，可反复重新生成） */
  generate(userId: string, episodeId: string): FollowupSummaryView {
    this.ownedEpisode(userId, episodeId);
    const content = this.buildContent(episodeId);
    const id = randomUUID();
    this.db.app
      .prepare(
        `INSERT INTO followup_summary (id, episode_id, content, export_format, exported_at)
         VALUES (?, ?, ?, NULL, NULL)`,
      )
      .run(id, episodeId, JSON.stringify(content));
    this.logger.log(`[followup] 为病程 ${episodeId.slice(0, 8)}… 生成复诊摘要 ${id.slice(0, 8)}…`);
    const row = this.db.app.prepare('SELECT * FROM followup_summary WHERE id = ?').get(id) as SummaryRow;
    return this.view(row);
  }

  /**
   * 最新一份摘要（含六段 content、生成时间、是否已导出）。
   * 尚未生成过时返回 null（200）而非 404：「暂无摘要」是正常空状态，不是客户端错误，
   * 避免各端在空数据时产生控制台 404 噪音。
   */
  latest(userId: string, episodeId: string): FollowupSummaryView | null {
    this.ownedEpisode(userId, episodeId);
    const row = this.db.app
      .prepare('SELECT * FROM followup_summary WHERE episode_id = ? ORDER BY rowid DESC LIMIT 1')
      .get(episodeId) as SummaryRow | undefined;
    return row ? this.view(row) : null;
  }

  /**
   * 预览后纠正：编辑各段文字、增删问题、调整问题顺序。
   * 纠正后重写 content：保留来源标记（结构化 source / verify_status 与文字标记都会补齐），
   * 未核实项继续带「未经核实」标记，记录纠正时间。
   */
  correct(
    userId: string,
    episodeId: string,
    summaryId: string,
    input: { sections?: unknown },
  ): FollowupSummaryView {
    this.ownedEpisode(userId, episodeId);
    const row = this.ownedSummary(episodeId, summaryId);
    const prev = this.parseContent(row.content);
    const content: FollowupContent = {
      sections: this.normalizeSections(input.sections),
      generated_at: prev.generated_at,
      corrected: true,
      corrected_at: new Date().toISOString(),
      disclaimer: FOLLOWUP_DISCLAIMER,
    };
    this.db.app
      .prepare('UPDATE followup_summary SET content = ? WHERE id = ?')
      .run(JSON.stringify(content), summaryId);
    this.logger.log(`[followup] 用户纠正复诊摘要 ${summaryId.slice(0, 8)}…`);
    const updated = this.db.app.prepare('SELECT * FROM followup_summary WHERE id = ?').get(summaryId) as SummaryRow;
    return this.view(updated);
  }

  /** 导出：文本返回纯文本（头部 + 六段 + 水印脚注）；PDF / 图片标记为浏览器打印生成 */
  exportSummary(
    userId: string,
    episodeId: string,
    summaryId: string,
    format: string,
  ): FollowupExportView {
    this.ownedEpisode(userId, episodeId);
    const row = this.ownedSummary(episodeId, summaryId);
    if (!EXPORT_FORMATS.includes(format as ExportFormat)) {
      throw new ApiException(ErrorCode.BAD_REQUEST, `导出格式必须是：${EXPORT_FORMATS.join(' / ')}`);
    }
    const fmt = format as ExportFormat;
    const content = this.parseContent(row.content);
    const exportedAt = new Date().toISOString();
    const text = fmt === '文本' ? this.renderText(content) : this.renderBrowserPrintNote(fmt);
    this.db.app
      .prepare('UPDATE followup_summary SET export_format = ?, exported_at = ? WHERE id = ?')
      .run(fmt, exportedAt, summaryId);
    this.logger.log(`[followup] 导出的复诊摘要 ${summaryId.slice(0, 8)}…（${fmt}）`);
    return {
      id: summaryId,
      episode_id: episodeId,
      format: fmt,
      export_format: fmt,
      exported_at: exportedAt,
      text,
      browser_print: fmt !== '文本',
      note:
        fmt === '文本'
          ? '已生成可复制的纯文本，可粘贴给医生或自行保存'
          : `演示实现：${fmt} 通过浏览器打印生成，不服务端生成`,
    };
  }

  // ---------- 六段生成 ----------

  private buildContent(episodeId: string): FollowupContent {
    const ep = this.db.app.prepare('SELECT * FROM episode WHERE id = ?').get(episodeId) as EpisodeRow;
    const events = this.db.app
      .prepare(
        `SELECT * FROM care_event WHERE episode_id = ? ORDER BY occurred_at ASC, rowid ASC`,
      )
      .all(episodeId) as EventRow[];

    const symptoms = events.filter((e) => e.event_type === '症状');
    const reports = events.filter((e) => e.event_type === '报告');
    const advices = events.filter((e) => e.event_type === '医嘱' || e.event_type === '行动');

    const sections: FollowupSection[] = [
      { key: 'onset', title: '起病与时间', items: this.buildOnset(ep, events) },
      { key: 'symptom', title: '当前症状', items: this.buildSymptoms(symptoms) },
      { key: 'report', title: '检查与报告', items: this.buildReports(reports) },
      { key: 'advice', title: '既往医嘱与行动', items: this.buildAdvice(advices) },
      { key: 'worry', title: '我的主要担心', items: this.buildWorries(episodeId) },
      { key: 'questions', title: '想请医生确认的问题', items: this.buildQuestions(episodeId) },
    ];
    return {
      sections,
      generated_at: new Date().toISOString(),
      disclaimer: FOLLOWUP_DISCLAIMER,
    };
  }

  /** 起病与时间：优先病程起病信息；缺失显示「尚未确认」，不默认阴性 */
  private buildOnset(ep: EpisodeRow, events: EventRow[]): FollowupItem[] {
    if (ep.onset_date) {
      return [
        factItem(
          `${ep.onset_date} ${ep.title}`,
          '自述',
          ep.onset_certainty ?? UNCONFIRMED,
        ),
      ];
    }
    const first = events[0];
    if (first) {
      return [
        factItem(
          `${beijingDate(first.occurred_at)} 最早一条记录：${this.eventText(first)}`,
          first.source_type,
          first.verify_status,
          first.id,
        ),
      ];
    }
    return [unconfirmedItem('起病时间与早期情况')];
  }

  /** 当前症状：按时间正序（起病 → 现在），未核实项保留并标记 */
  private buildSymptoms(symptoms: EventRow[]): FollowupItem[] {
    if (symptoms.length === 0) return [unconfirmedItem('当前症状')];
    return symptoms.map((e) =>
      factItem(`${beijingDate(e.occurred_at)} ${this.eventText(e)}`, e.source_type, e.verify_status, e.id),
    );
  }

  /**
   * 检查与报告：报告原文摘要 + 「报告未提及」项。
   * 报告未描述的内容显示「报告未提及」，不能显示「已排除」。
   */
  private buildReports(reports: EventRow[]): FollowupItem[] {
    if (reports.length === 0) return [unconfirmedItem('检查与报告')];
    const items = reports.map((e) =>
      factItem(`${beijingDate(e.occurred_at)} ${excerpt(e.raw_text, 60)}`, e.source_type, e.verify_status, e.id),
    );
    const notMentioned = reportNotMentioned(reports);
    if (notMentioned) {
      items.push({
        text: `报告未描述${notMentioned}（报告原文，报告未提及，未经核实）`,
        source: '报告原文',
        verify_status: UNCONFIRMED,
        ...(reports.length === 1 ? { care_event_id: reports[0].id } : {}),
      });
    }
    return items;
  }

  /** 既往医嘱与行动：医嘱（医生记录）与行动（多为自述）按时间正序 */
  private buildAdvice(advices: EventRow[]): FollowupItem[] {
    if (advices.length === 0) return [unconfirmedItem('既往医嘱与行动')];
    return advices.map((e) =>
      factItem(`${beijingDate(e.occurred_at)} ${this.eventText(e)}`, e.source_type, e.verify_status, e.id),
    );
  }

  /** 我的主要担心：取最近记录的主要担心（自述，尚未确认） */
  private buildWorries(episodeId: string): FollowupItem[] {
    const rows = this.db.app
      .prepare(
        `SELECT s.top_worry FROM symptom_log s JOIN care_event c ON c.id = s.care_event_id
         WHERE c.episode_id = ? AND s.top_worry IS NOT NULL AND s.top_worry != ''
         ORDER BY c.occurred_at DESC, c.rowid DESC LIMIT 3`,
      )
      .all(episodeId) as { top_worry: string }[];
    const worries = [...new Set(rows.map((r) => r.top_worry.trim()).filter((w) => w.length > 0))];
    if (worries.length === 0) return [unconfirmedItem('主要担心')];
    return worries.map((w) => factItem(w, '自述', UNCONFIRMED));
  }

  /**
   * 想请医生确认的问题：
   * 1. 用户在问与解释中一键加入的复诊问题（qa_message.followup_question）——用户主动提出，重要性最高；
   * 2. 最新一页分析 next 段中类型为「复诊问题」的事项。
   * 去重后按上述重要性排序；用户可在预览中增删、调整顺序。
   */
  private buildQuestions(episodeId: string): FollowupItem[] {
    const items: FollowupItem[] = [];
    const seen = new Set<string>();

    const qaRows = this.db.app
      .prepare(
        `SELECT m.followup_question FROM qa_message m JOIN qa_session s ON s.id = m.session_id
         WHERE s.episode_id = ? AND m.followup_question IS NOT NULL AND m.followup_question != ''
         ORDER BY m.created_at ASC, m.rowid ASC`,
      )
      .all(episodeId) as { followup_question: string }[];
    for (const r of qaRows) {
      const q = r.followup_question.trim();
      if (q && !seen.has(q)) {
        seen.add(q);
        items.push({ text: q, source: '自述', from: '用户加入' });
      }
    }

    const analysis = this.db.app
      .prepare(
        `SELECT sections FROM analysis WHERE episode_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`,
      )
      .get(episodeId) as { sections: string | null } | undefined;
    if (analysis?.sections) {
      let next: { text?: unknown; type?: unknown }[] = [];
      try {
        const parsed = JSON.parse(analysis.sections) as { next?: unknown };
        if (Array.isArray(parsed.next)) next = parsed.next as { text?: unknown; type?: unknown }[];
      } catch {
        next = [];
      }
      for (const n of next) {
        if (n?.type !== '复诊问题') continue;
        const q = typeof n.text === 'string' ? n.text.trim() : '';
        if (q && !seen.has(q)) {
          seen.add(q);
          items.push({ text: q, source: '自述', from: '分析整理' });
        }
      }
    }

    if (items.length === 0) return [unconfirmedItem('想请医生确认的问题')];
    return items;
  }

  /** 事件文字：原文优先；无原文时用症状记录字段兜底（不写「无」） */
  private eventText(event: EventRow): string {
    const raw = event.raw_text?.trim();
    if (raw) return raw;
    return this.symptomLogSummary(event.id) ?? `${event.event_type}记录（无原文）`;
  }

  private symptomLogSummary(careEventId: string): string | null {
    const log = this.db.app
      .prepare('SELECT * FROM symptom_log WHERE care_event_id = ?')
      .get(careEventId) as Record<string, unknown> | undefined;
    if (!log) return null;
    const parts: string[] = [];
    const sit = log.sit_minutes as number | null;
    const sleep = log.sleep_impact as number | null;
    const done = (log.planned_activity_done as string | null) ?? UNCONFIRMED;
    const leg = (log.leg_change as string | null) ?? UNCONFIRMED;
    if (sit !== null && sit !== undefined) parts.push(`能坐约 ${sit} 分钟`);
    parts.push(`计划活动${done}`);
    if (sleep !== null && sleep !== undefined) {
      parts.push(sleep === 0 ? '不影响睡眠' : `影响睡眠（程度 ${sleep}/3）`);
    }
    parts.push(`腿部变化：${leg}`);
    return parts.length > 0 ? `记录显示：${parts.join('，')}` : null;
  }

  // ---------- 纠正入参归一 ----------

  /** 归一化用户纠正后的六段：固定六段齐全、条目带来源；事实段补齐来源与核实标记 */
  private normalizeSections(input: unknown): FollowupSection[] {
    if (!Array.isArray(input)) {
      throw new ApiException(ErrorCode.BAD_REQUEST, '摘要内容格式不正确：sections 应为固定六段的数组');
    }
    const byKey = new Map<string, Record<string, unknown>>();
    for (const raw of input) {
      if (!raw || typeof raw !== 'object') {
        throw new ApiException(ErrorCode.BAD_REQUEST, '摘要内容格式不正确：每段应为对象');
      }
      const section = raw as Record<string, unknown>;
      const key = typeof section.key === 'string' ? section.key : '';
      if (!FOLLOWUP_SECTION_KEYS.includes(key as never)) {
        throw new ApiException(
          ErrorCode.BAD_REQUEST,
          `摘要段落标识必须是：${FOLLOWUP_SECTIONS.map((s) => s.key).join(' / ')}`,
        );
      }
      byKey.set(key, section);
    }
    return FOLLOWUP_SECTIONS.map((def) => {
      const section = byKey.get(def.key);
      if (!section) {
        throw new ApiException(
          ErrorCode.BAD_REQUEST,
          `复诊摘要必须包含固定的六段（${FOLLOWUP_SECTIONS.map((s) => s.title).join(' / ')}），缺少「${def.title}」`,
        );
      }
      const rawItems = section.items;
      if (rawItems !== undefined && !Array.isArray(rawItems)) {
        throw new ApiException(ErrorCode.BAD_REQUEST, `「${def.title}」的条目应为数组`);
      }
      const items = ((rawItems ?? []) as unknown[]).map((item) =>
        this.normalizeItem(def.key, item),
      );
      return { key: def.key, title: def.title, items };
    });
  }

  private normalizeItem(sectionKey: string, input: unknown): FollowupItem {
    const raw: Record<string, unknown> =
      typeof input === 'string'
        ? { text: input }
        : input && typeof input === 'object'
          ? (input as Record<string, unknown>)
          : {};
    const text = typeof raw.text === 'string' ? raw.text.trim() : '';
    if (!text) {
      throw new ApiException(ErrorCode.BAD_REQUEST, '摘要条目文字不能为空');
    }
    if (text.length > MAX_ITEM_TEXT) {
      throw new ApiException(ErrorCode.BAD_REQUEST, `摘要条目过长（不超过 ${MAX_ITEM_TEXT} 字）`);
    }
    const source = this.pickEnum(raw.source, SOURCE_TYPES, '来源类型', '自述');
    const item: FollowupItem = { text, source };
    if (sectionKey === QUESTIONS_KEY) {
      // 问题清单：条目是「问题」而非病程事实，不标核实状态；保留来源标识
      if (typeof raw.from === 'string' && raw.from.trim()) item.from = raw.from.trim();
      return item;
    }
    const verify = this.pickEnum(raw.verify_status, VERIFY_STATUSES, '核实状态', UNCONFIRMED);
    item.verify_status = verify;
    if (typeof raw.care_event_id === 'string' && raw.care_event_id.trim()) {
      item.care_event_id = raw.care_event_id.trim();
    }
    // 保留来源标记：剥掉旧标记后按当前来源 / 核实状态重贴（未核实项继续带「未经核实」）
    item.text = `${stripTrailingMarkers(text)}（${source}，${verifyLabel(verify)}）`;
    return item;
  }

  private pickEnum(value: unknown, allowed: readonly string[], label: string, fallback: string): string {
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value !== 'string' || !allowed.includes(value)) {
      throw new ApiException(ErrorCode.BAD_REQUEST, `${label}必须是：${allowed.join(' / ')}`);
    }
    return value;
  }

  // ---------- 视图与序列化 ----------

  private view(row: SummaryRow): FollowupSummaryView {
    const content = this.parseContent(row.content);
    return {
      id: row.id,
      episode_id: row.episode_id,
      content,
      generated_at: content.generated_at,
      corrected: content.corrected === true,
      exported: Boolean(row.exported_at),
      export_format: row.export_format ?? null,
      exported_at: row.exported_at ?? null,
      disclaimer: FOLLOWUP_DISCLAIMER,
    };
  }

  /** 解析 content：统一归一为固定六段（顺序、标题固定），容忍历史数据 */
  private parseContent(raw: string | null): FollowupContent {
    const fallback: FollowupContent = {
      sections: FOLLOWUP_SECTIONS.map((s) => ({ key: s.key, title: s.title, items: [] })),
      generated_at: null,
      disclaimer: FOLLOWUP_DISCLAIMER,
    };
    if (!raw) return fallback;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return fallback;
    }
    if (!parsed || typeof parsed !== 'object') return fallback;
    const obj = parsed as Record<string, unknown>;
    const rawSections = Array.isArray(obj.sections) ? obj.sections : [];
    const sections: FollowupSection[] = FOLLOWUP_SECTIONS.map((def) => {
      const found = rawSections.find(
        (s): s is Record<string, unknown> =>
          typeof s === 'object' && s !== null && (s as Record<string, unknown>).key === def.key,
      );
      const items = found && Array.isArray(found.items) ? found.items : [];
      return {
        key: def.key,
        title: def.title,
        items: items
          .filter((i): i is Record<string, unknown> => typeof i === 'object' && i !== null)
          .map((i) => {
            const text = typeof i.text === 'string' ? i.text : '';
            const source =
              typeof i.source === 'string' && SOURCE_TYPES.includes(i.source as never) ? i.source : '自述';
            const item: FollowupItem = { text, source };
            if (typeof i.verify_status === 'string') item.verify_status = i.verify_status;
            if (typeof i.care_event_id === 'string') item.care_event_id = i.care_event_id;
            if (typeof i.from === 'string') item.from = i.from;
            return item;
          }),
      };
    });
    return {
      sections,
      generated_at: typeof obj.generated_at === 'string' ? obj.generated_at : null,
      ...(obj.corrected === true ? { corrected: true } : {}),
      ...(typeof obj.corrected_at === 'string' ? { corrected_at: obj.corrected_at } : {}),
      disclaimer: FOLLOWUP_DISCLAIMER,
    };
  }

  // ---------- 导出文本 ----------

  /** 纯文本排版：头部「就诊交接摘要」+ 固定六段 + 水印脚注 */
  private renderText(content: FollowupContent): string {
    const numerals = ['一', '二', '三', '四', '五', '六'];
    const lines: string[] = [EXPORT_TITLE, ''];
    content.sections.forEach((section, i) => {
      lines.push(`${numerals[i] ?? String(i + 1)}、${section.title}`);
      if (section.items.length === 0) {
        lines.push('（暂无记录，尚未确认）');
      } else {
        section.items.forEach((item, j) => lines.push(`${j + 1}. ${item.text}`));
      }
      lines.push('');
    });
    lines.push('——————————————');
    lines.push(FOLLOWUP_DISCLAIMER);
    lines.push(`生成时间：${content.generated_at ?? '未知'}（UTC）`);
    if (content.corrected) lines.push('本摘要已被用户纠正修改');
    return lines.join('\n');
  }

  /** PDF / 图片：演示实现标记为「由浏览器打印生成」，服务端不生成文件 */
  private renderBrowserPrintNote(format: ExportFormat): string {
    return (
      `${format}导出由浏览器打印生成：请在复诊摘要预览页使用浏览器打印功能` +
      `（目标选择“另存为 PDF”或打印为图片）；演示实现不服务端生成${format}文件。\n` +
      `${FOLLOWUP_DISCLAIMER}`
    );
  }

  // ---------- 内部 ----------

  private ownedEpisode(userId: string, episodeId: string): EpisodeRow {
    const ep = this.db.app.prepare('SELECT * FROM episode WHERE id = ?').get(episodeId) as
      | EpisodeRow
      | undefined;
    if (!ep || ep.user_id !== userId) {
      throw new ApiException(ErrorCode.NOT_FOUND, '病程不存在');
    }
    return ep;
  }

  private ownedSummary(episodeId: string, summaryId: string): SummaryRow {
    const row = this.db.app.prepare('SELECT * FROM followup_summary WHERE id = ?').get(summaryId) as
      | SummaryRow
      | undefined;
    if (!row || row.episode_id !== episodeId) {
      throw new ApiException(ErrorCode.NOT_FOUND, '复诊摘要不存在');
    }
    return row;
  }
}

/** 核实状态展示：已确认不带标记；尚未确认 / 有冲突一律带「未经核实」 */
function verifyLabel(verify: string): string {
  if (verify === '已确认') return '已确认';
  if (!VERIFY_STATUSES.includes(verify as never)) return `${UNCONFIRMED}，未经核实`;
  return `${verify}，未经核实`;
}

/** 病程事实条目：文字 + 来源 + 核实标记（未核实项带「未经核实」） */
function factItem(
  text: string,
  source: string,
  verify: string,
  careEventId?: string,
): FollowupItem {
  const safeSource = SOURCE_TYPES.includes(source as never) ? source : '自述';
  const safeVerify = VERIFY_STATUSES.includes(verify as never) ? verify : UNCONFIRMED;
  return {
    text: `${text}（${safeSource}，${verifyLabel(safeVerify)}）`,
    source: safeSource,
    verify_status: safeVerify,
    ...(careEventId ? { care_event_id: careEventId } : {}),
  };
}

/** 缺失信息条目：显示「尚未确认」，不默认为阴性 / 「无」 */
function unconfirmedItem(what: string): FollowupItem {
  return {
    text: `${what}暂无记录（尚未确认，未经核实）`,
    source: '自述',
    verify_status: UNCONFIRMED,
  };
}

/** 报告未提及项：报告原文里去掉「未描述 / 未提及…」后仍描述了下肢肌力感觉，则不再提示 */
function reportNotMentioned(reports: EventRow[]): string | null {
  const text = reports.map((r) => r.raw_text ?? '').join(' ');
  const withoutNegation = text.replace(/未(描述|提及|检查|包括|见)[^。；，,.!?]{0,12}/g, '');
  const describesLeg = /肌力|下肢.{0,4}(力|感觉|麻木)/.test(withoutNegation);
  return describesLeg ? null : '下肢肌力与感觉情况';
}

/** 截断长文本（报告原文摘要用） */
function excerpt(text: string | null, max: number): string {
  const t = (text ?? '').trim();
  if (!t) return '报告记录（无原文）';
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/**
 * 剥掉条目尾部已有的来源 / 核实 / 报告未提及标记（避免纠正后标记叠加）。
 * 只剥包含已知关键词的尾部括号，正文里正常的括号不受影响。
 */
function stripTrailingMarkers(text: string): string {
  let t = text.trim();
  const markerRe =
    /（[^（）]*(自述|报告原文|医生记录|已确认|尚未确认|有冲突|未经核实|报告未提及)[^（）]*）\s*$/;
  for (let i = 0; i < 5; i += 1) {
    const m = t.match(markerRe);
    if (!m || m.index === undefined) break;
    t = t.slice(0, m.index).trim();
  }
  return t;
}
