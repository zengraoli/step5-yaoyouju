import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DbService } from '../../db/db.service';
import { ApiException, ErrorCode } from '../../common/api-error';
import { AuditService } from '../../common/audit.service';
import {
  EvidenceRetriever,
  EvidenceSearchOutcome,
  localVector,
  LocalEvidenceRetriever,
  RetrievedChunk,
} from './evidence-retrieval';
import { ChunkSpec, chunkerParams, splitIntoChunks } from './chunker';

/**
 * 医学证据库服务（B05，docs/system-design.md 第 3 节 EVIDENCE_DOC / EVIDENCE_CHUNK）。
 *
 * 职责：
 * 1. 证据文档管理：列表（来源类型 / 启用状态筛选 + 片段数 + 被引用数）、新建、编辑（写审计）、停用 / 启用；
 * 2. 切分入库管线：POST /evidence/{id}/ingest 切分写入 evidence_chunk（幂等），GET /evidence/{id}/pipeline 查状态；
 * 3. 本地检索：POST /evidence/search，关键词 + 本地向量相似度混合打分，只在证据库内、只检索启用中的文档；
 * 4. 停用影响预览：列出引用该证据的分析（analysis_citation + analysis.sections）与内容，供审核人确认。
 *
 * 产品红线：
 * - 每条解释能看到的来源都来自证据库；停用立即生效（下一次检索即排除）；
 * - 停用的证据不再被检索到（active=0 的文档片段一律排除）。
 */

/** 来源类型（docs/system-design.md：EVIDENCE_DOC.source_type） */
export const EVIDENCE_SOURCE_TYPES = ['指南', '研究', '审核科普'] as const;
export type EvidenceSourceType = (typeof EVIDENCE_SOURCE_TYPES)[number];

/** 入库管线状态 */
export const INGEST_STATUSES = ['待切分', '已切分', '失败'] as const;
export type IngestStatus = (typeof INGEST_STATUSES)[number];

/** 检索免责声明（系统生成内容，仅供参考，不作诊断） */
export const EVIDENCE_SEARCH_DISCLAIMER =
  '检索结果只来自医学证据库中已启用的证据片段；系统生成内容仅供参考，不作诊断';

type EvidenceDocRow = {
  id: string;
  title: string;
  source_type: string;
  source_url: string | null;
  license: string | null;
  verified_at: string | null;
  active: number;
  raw_text: string | null;
  ingest_status: string;
  ingested_at: string | null;
  ingest_error: string | null;
  updated_at: string | null;
};

export interface EvidenceListFilters {
  /** 来源类型：指南 / 研究 / 审核科普 */
  source_type?: string;
  /** 启用状态：true=只看启用，false=只看停用，undefined=全部 */
  active?: boolean;
}

/** 列表项：文档 + 片段数 + 被引用数 */
export interface EvidenceDocListItem {
  id: string;
  title: string;
  source_type: string;
  source_url: string | null;
  license: string | null;
  verified_at: string | null;
  active: boolean;
  /** 片段数（evidence_chunk） */
  chunk_count: number;
  /** 被引用数（analysis_citation 中 evidence_doc_id 计数） */
  citation_count: number;
  ingest_status: IngestStatus;
  ingested_at: string | null;
  updated_at: string | null;
}

/** 详情：列表项 + 原文 */
export interface EvidenceDocDetail extends EvidenceDocListItem {
  raw_text: string | null;
  raw_text_length: number;
}

export interface EvidenceDocInput {
  title: string;
  source_type: string;
  source_url?: string | null;
  license?: string | null;
  verified_at?: string | null;
  raw_text?: string | null;
  active?: boolean;
}

/** 入库管线状态（GET /evidence/{id}/pipeline） */
export interface EvidencePipelineView {
  doc_id: string;
  doc_title: string;
  /** 待切分 / 已切分 / 失败 */
  status: IngestStatus;
  chunk_count: number;
  /** 最近一次入库时间（UTC ISO8601） */
  last_ingested_at: string | null;
  error: string | null;
  raw_text_length: number;
  /** 片段位置（从 0 开始连续） */
  positions: number[];
  chunker: { min: number; max: number; overlap: number };
  updated_at: string | null;
}

/** 引用该证据的分析 */
export interface EvidenceAnalysisReference {
  analysis_id: string;
  episode_id: string;
  episode_title: string;
  analysis_version: number;
  created_at: string;
  /** 引用的 statement（来自 analysis_citation 与 analysis.sections.explain[].citations） */
  statements: string[];
  /** 被引用的解释条数 */
  explain_count: number;
}

/** 引用该证据的内容（演示实现：content_version 与 evidence_doc 无直接外键，按标题文本匹配） */
export interface EvidenceContentReference {
  content_item_id: string;
  content_title: string;
  current_status: string;
  version: number;
  published_at: string | null;
  matched_by: string;
}

/** 停用影响预览 */
export interface EvidenceImpactReport {
  doc_id: string;
  doc_title: string;
  active: boolean;
  /** 被引用数（analysis_citation） */
  citation_count: number;
  analyses: EvidenceAnalysisReference[];
  contents: EvidenceContentReference[];
  /** 演示实现说明 */
  note: string;
  /** 审核确认提示 */
  confirm_hint: string;
}

/** 停用 / 启用结果：文档 + 影响预览（停用时供审核人确认） */
export interface EvidenceActiveResult {
  doc: EvidenceDocDetail;
  impact: EvidenceImpactReport;
  audit_action: string;
}

/** 检索结果（含 retrieval_snapshot，供 analysis.retrieval_snapshot 使用） */
export interface EvidenceSearchResult {
  query: string;
  results: RetrievedChunk[];
  result_count: number;
  /** 检索快照：策略名、命中 doc_ids、耗时 */
  retrieval_snapshot: EvidenceSearchOutcome['retrieval_snapshot'];
  disclaimer: string;
}

const now = () => new Date().toISOString();

@Injectable()
export class EvidenceService implements EvidenceRetriever {
  private readonly logger = new Logger('Evidence');
  private readonly retriever: LocalEvidenceRetriever;

  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {
    this.retriever = new LocalEvidenceRetriever(this.db.app);
  }

  // ---------- 文档管理 ----------

  /**
   * 证据文档列表：按来源类型 / 启用状态筛选，返回片段数与被引用数。
   */
  list(filters: EvidenceListFilters = {}): EvidenceDocListItem[] {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filters.source_type) {
      where.push('d.source_type = ?');
      params.push(filters.source_type);
    }
    if (filters.active !== undefined) {
      where.push('d.active = ?');
      params.push(filters.active ? 1 : 0);
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const rows = this.db.app
      .prepare(
        `SELECT d.*,
                (SELECT COUNT(*) FROM evidence_chunk c WHERE c.doc_id = d.id) AS chunk_count,
                (SELECT COUNT(*) FROM analysis_citation ac WHERE ac.evidence_doc_id = d.id) AS citation_count
         FROM evidence_doc d
         ${clause}
         ORDER BY d.source_type ASC, d.title ASC, d.rowid ASC`,
      )
      .all(...(params as never[])) as (EvidenceDocRow & { chunk_count: number; citation_count: number })[];

    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      source_type: r.source_type,
      source_url: r.source_url,
      license: r.license,
      verified_at: r.verified_at,
      active: r.active === 1,
      chunk_count: Number(r.chunk_count ?? 0),
      citation_count: Number(r.citation_count ?? 0),
      ingest_status: deriveIngestStatus(r.ingest_status, Number(r.chunk_count ?? 0)),
      ingested_at: r.ingested_at,
      updated_at: r.updated_at,
    }));
  }

  /** 证据文档详情（含原文） */
  detail(docId: string): EvidenceDocDetail {
    const row = this.loadDoc(docId);
    return this.toDetail(row);
  }

  /** 新建证据文档（标题、来源类型、来源地址、许可、核实日期；可带原文） */
  create(actorId: string | null, input: EvidenceDocInput): EvidenceDocDetail {
    const title = (input.title ?? '').trim();
    if (!title) throw new ApiException(ErrorCode.BAD_REQUEST, '证据文档标题不能为空');
    const sourceType = (input.source_type ?? '').trim();
    if (!EVIDENCE_SOURCE_TYPES.includes(sourceType as EvidenceSourceType)) {
      throw new ApiException(
        ErrorCode.BAD_REQUEST,
        `来源类型必须是：${EVIDENCE_SOURCE_TYPES.join(' / ')}`,
      );
    }
    const verifiedAt = normalizeDate(input.verified_at, '核实日期');
    const id = randomUUID();
    const t = now();
    this.db.app
      .prepare(
        `INSERT INTO evidence_doc
           (id, title, source_type, source_url, license, verified_at, active, raw_text, ingest_status, ingested_at, ingest_error, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, '待切分', NULL, NULL, ?)`,
      )
      .run(
        id,
        title,
        sourceType,
        input.source_url?.trim() || null,
        input.license?.trim() || null,
        verifiedAt,
        input.active === false ? 0 : 1,
        input.raw_text ?? null,
        t,
      );
    this.audit.append(actorId, 'evidence.create', `evidence_doc:${id}`, {
      title,
      source_type: sourceType,
      source_url: input.source_url?.trim() || null,
      license: input.license?.trim() || null,
      verified_at: verifiedAt,
      active: input.active !== false,
    });
    this.logger.log(`[evidence] ${actorId ?? 'system'} 新建证据文档 ${id}《${title}》（${sourceType}）`);
    return this.detail(id);
  }

  /** 编辑证据文档（改动写审计） */
  update(actorId: string | null, docId: string, input: Partial<EvidenceDocInput>): EvidenceDocDetail {
    const row = this.loadDoc(docId);
    const title = input.title === undefined ? row.title : input.title.trim();
    if (!title) throw new ApiException(ErrorCode.BAD_REQUEST, '证据文档标题不能为空');
    const sourceType = input.source_type === undefined ? row.source_type : input.source_type.trim();
    if (!EVIDENCE_SOURCE_TYPES.includes(sourceType as EvidenceSourceType)) {
      throw new ApiException(
        ErrorCode.BAD_REQUEST,
        `来源类型必须是：${EVIDENCE_SOURCE_TYPES.join(' / ')}`,
      );
    }
    const sourceUrl = input.source_url === undefined ? row.source_url : input.source_url?.trim() || null;
    const license = input.license === undefined ? row.license : input.license?.trim() || null;
    const verifiedAt =
      input.verified_at === undefined ? row.verified_at : normalizeDate(input.verified_at, '核实日期');
    const rawText = input.raw_text === undefined ? row.raw_text : input.raw_text;
    const active = input.active === undefined ? row.active === 1 : input.active;

    const diff: Record<string, unknown> = {};
    if (title !== row.title) diff.title = { from: row.title, to: title };
    if (sourceType !== row.source_type) diff.source_type = { from: row.source_type, to: sourceType };
    if (sourceUrl !== row.source_url) diff.source_url = { from: row.source_url, to: sourceUrl };
    if (license !== row.license) diff.license = { from: row.license, to: license };
    if (verifiedAt !== row.verified_at) diff.verified_at = { from: row.verified_at, to: verifiedAt };
    if (rawText !== row.raw_text) {
      diff.raw_text = { from_length: row.raw_text?.length ?? 0, to_length: rawText?.length ?? 0 };
    }
    if (active !== (row.active === 1)) diff.active = { from: row.active === 1, to: active };

    this.db.app
      .prepare(
        `UPDATE evidence_doc
         SET title=?, source_type=?, source_url=?, license=?, verified_at=?, raw_text=?, active=?, updated_at=?
         WHERE id=?`,
      )
      .run(title, sourceType, sourceUrl, license, verifiedAt, rawText, active ? 1 : 0, now(), docId);
    this.audit.append(actorId, 'evidence.update', `evidence_doc:${docId}`, diff);
    this.logger.log(`[evidence] ${actorId ?? 'system'} 编辑证据文档 ${docId}（改动 ${Object.keys(diff).length} 项）`);
    return this.detail(docId);
  }

  /**
   * 停用 / 启用证据文档。
   * 停用时返回影响预览：引用该证据的分析列表（分析 ID、episode、版本、引用的 statement）与内容列表，
   * 供审核人确认后执行；启用时直接生效。
   * 停用立即生效：下一次检索即排除该文档的片段。
   */
  setActive(
    actorId: string | null,
    docId: string,
    active: boolean,
    reason?: string | null,
  ): EvidenceActiveResult {
    const row = this.loadDoc(docId);
    const target = active ? 1 : 0;
    if (row.active === target) {
      throw new ApiException(
        ErrorCode.CONFLICT,
        active ? '该证据文档已是启用状态' : '该证据文档已是停用状态',
      );
    }
    const impact = this.impactPreview(docId);
    if (!active && impact.analyses.length > 0) {
      this.logger.warn(
        `[evidence] 停用证据 ${docId}《${row.title}》将影响 ${impact.analyses.length} 条分析的引用（需审核人确认）`,
      );
    }
    this.db.app
      .prepare(`UPDATE evidence_doc SET active=?, updated_at=? WHERE id=?`)
      .run(target, now(), docId);
    this.audit.append(actorId, active ? 'evidence.activate' : 'evidence.deactivate', `evidence_doc:${docId}`, {
      from: row.active === 1,
      to: active,
      reason: reason?.trim() || null,
      impact: {
        citation_count: impact.citation_count,
        analysis_ids: impact.analyses.map((a) => a.analysis_id),
        content_item_ids: impact.contents.map((c) => c.content_item_id),
      },
    });
    this.logger.log(
      `[evidence] ${actorId ?? 'system'} ${active ? '启用' : '停用'}证据文档 ${docId}《${row.title}》`,
    );
    return {
      doc: this.detail(docId),
      impact,
      audit_action: active ? 'evidence.activate' : 'evidence.deactivate',
    };
  }

  // ---------- 切分入库管线 ----------

  /**
   * 切分入库：把文档原文切分为片段写入 evidence_chunk，并计算本地 16 维向量。
   * 幂等：按位置更新（位置相同的片段改写内容与向量，多出来的旧片段删除），重复 ingest 不重复产生片段。
   */
  ingest(actorId: string | null, docId: string): EvidencePipelineView {
    const row = this.loadDoc(docId);
    const raw = (row.raw_text ?? '').trim();
    if (!raw) {
      throw new ApiException(ErrorCode.BAD_REQUEST, '证据文档还没有原文，无法切分入库');
    }
    const t = now();
    try {
      const specs = splitIntoChunks(raw);
      if (specs.length === 0) {
        throw new ApiException(ErrorCode.BAD_REQUEST, '证据文档原文为空，无法切分入库');
      }
      this.db.app.exec('BEGIN');
      try {
        const existing = this.db.app
          .prepare(`SELECT id FROM evidence_chunk WHERE doc_id=? ORDER BY position ASC, rowid ASC`)
          .all(docId) as { id: string }[];
        const insertChunk = this.db.app.prepare(
          `INSERT INTO evidence_chunk (id, doc_id, content, embedding, position) VALUES (?, ?, ?, ?, ?)`,
        );
        const updateChunk = this.db.app.prepare(
          `UPDATE evidence_chunk SET content=?, embedding=?, position=? WHERE id=?`,
        );
        specs.forEach((spec: ChunkSpec, index: number) => {
          const embedding = JSON.stringify(localVector(spec.content));
          const hit = existing[index];
          if (hit) updateChunk.run(spec.content, embedding, spec.position, hit.id);
          else insertChunk.run(randomUUID(), docId, spec.content, embedding, spec.position);
        });
        // 新片段比旧片段少：删除多出来的旧片段（保证重复 ingest 后片段数一致）
        for (let i = specs.length; i < existing.length; i += 1) {
          this.db.app.prepare(`DELETE FROM evidence_chunk WHERE id=?`).run(existing[i].id);
        }
        this.db.app
          .prepare(
            `UPDATE evidence_doc SET ingest_status='已切分', ingested_at=?, ingest_error=NULL, updated_at=? WHERE id=?`,
          )
          .run(t, t, docId);
        this.db.app.exec('COMMIT');
      } catch (err) {
        try {
          this.db.app.exec('ROLLBACK');
        } catch {
          // 事务可能已自动回滚
        }
        throw err;
      }
      this.audit.append(actorId, 'evidence.ingest', `evidence_doc:${docId}`, {
        chunk_count: specs.length,
        raw_text_length: raw.length,
        ingested_at: t,
      });
      this.logger.log(`[evidence] 证据文档 ${docId} 切分入库完成，生成 ${specs.length} 个片段`);
    } catch (err) {
      const message = err instanceof Error ? err.message : '切分入库失败';
      this.db.app
        .prepare(`UPDATE evidence_doc SET ingest_status='失败', ingest_error=?, updated_at=? WHERE id=?`)
        .run(message, now(), docId);
      this.logger.error(`[evidence] 证据文档 ${docId} 切分入库失败：${message}`);
      if (err instanceof ApiException) throw err;
      throw new ApiException(ErrorCode.SERVICE_UNAVAILABLE, `证据入库失败：${message}`);
    }
    return this.pipeline(docId);
  }

  /** 入库管线状态：待切分 / 已切分 / 失败、片段数、最近一次入库时间、错误信息 */
  pipeline(docId: string): EvidencePipelineView {
    const row = this.loadDoc(docId);
    const chunks = this.db.app
      .prepare(`SELECT position FROM evidence_chunk WHERE doc_id=? ORDER BY position ASC, rowid ASC`)
      .all(docId) as { position: number }[];
    const chunkCount = chunks.length;
    // 状态以记录为准；库里有片段但状态仍是「待切分」（如种子数据）时按已切分展示
    const status = deriveIngestStatus(row.ingest_status, chunkCount);
    return {
      doc_id: row.id,
      doc_title: row.title,
      status,
      chunk_count: chunkCount,
      last_ingested_at: row.ingested_at,
      error: status === '失败' ? row.ingest_error : null,
      raw_text_length: (row.raw_text ?? '').length,
      positions: chunks.map((c) => c.position),
      chunker: chunkerParams(),
      updated_at: row.updated_at,
    };
  }

  // ---------- 本地检索（只在证据库内） ----------

  /**
   * 证据库检索：关键词 + 本地向量相似度混合打分，只检索 active=1 的文档片段。
   * 返回片段内容、所属文档标题 / 来源类型 / 许可、得分，以及 retrieval_snapshot
   * （策略名、命中 doc_ids、耗时），供 analysis.retrieval_snapshot 使用。
   */
  search(query: string, limit = 5): EvidenceSearchResult {
    const outcome = this.retriever.search(query, limit);
    return {
      query: outcome.query,
      results: outcome.results,
      result_count: outcome.results.length,
      retrieval_snapshot: outcome.retrieval_snapshot,
      disclaimer: EVIDENCE_SEARCH_DISCLAIMER,
    };
  }

  /** Worker 侧流水线复用：只拿片段列表 */
  retrieve(query: string, limit = 5): RetrievedChunk[] {
    return this.retriever.search(query, limit).results;
  }

  // ---------- 停用影响预览 ----------

  /**
   * 停用影响预览：列出引用该证据的分析与内容。
   * content_version 与 evidence_doc 没有直接外键，分析列表由 analysis_citation
   * 与 analysis.sections.explain[].citations 两处合并得到。
   */
  impactPreview(docId: string): EvidenceImpactReport {
    const row = this.loadDoc(docId);
    const byAnalysis = new Map<string, EvidenceAnalysisReference>();

    // 1. analysis_citation（引用计数与 statement 的权威来源）
    const citations = this.db.app
      .prepare(
        `SELECT ac.analysis_id, ac.statement, a.episode_id, a.version, a.created_at
         FROM analysis_citation ac JOIN analysis a ON a.id = ac.analysis_id
         WHERE ac.evidence_doc_id=?`,
      )
      .all(docId) as {
      analysis_id: string;
      statement: string;
      episode_id: string;
      version: number;
      created_at: string;
    }[];
    for (const c of citations) {
      const ref = this.ensureRef(byAnalysis, c.analysis_id, c.episode_id, c.version, c.created_at);
      addStatement(ref, c.statement);
    }

    // 2. analysis.sections.explain[].citations（内容里直接引用该文档的解释）
    const analyses = this.db.app
      .prepare(`SELECT id, episode_id, version, created_at, sections FROM analysis`)
      .all() as {
      id: string;
      episode_id: string;
      version: number;
      created_at: string;
      sections: string | null;
    }[];
    for (const a of analyses) {
      const statements = sectionStatementsOf(a.sections, docId);
      if (statements.length === 0) continue;
      const ref = this.ensureRef(byAnalysis, a.id, a.episode_id, a.version, a.created_at);
      for (const s of statements) addStatement(ref, s);
    }

    const analysesOut = [...byAnalysis.values()].map((r) => ({
      ...r,
      explain_count: r.statements.length,
    }));

    return {
      doc_id: row.id,
      doc_title: row.title,
      active: row.active === 1,
      citation_count: citations.length,
      analyses: analysesOut,
      contents: this.contentReferences(row.title),
      note:
        '演示实现：content_version 与 evidence_doc 无直接外键，分析列表由 analysis_citation 与 ' +
        'analysis.sections 中引用该证据文档的解释合并得到；内容列表按标题文本匹配，仅供参考。',
      confirm_hint:
        analysesOut.length > 0
          ? `停用后 ${analysesOut.length} 条已生成分析中的引用将失去可核实来源，请确认是否继续。`
          : '当前没有分析引用该证据，可安全停用。',
    };
  }

  // ---------- 内部 ----------

  private loadDoc(docId: string): EvidenceDocRow {
    const row = this.db.app.prepare(`SELECT * FROM evidence_doc WHERE id=?`).get(docId) as
      | EvidenceDocRow
      | undefined;
    if (!row) throw new ApiException(ErrorCode.NOT_FOUND, '证据文档不存在');
    return row;
  }

  private toDetail(row: EvidenceDocRow): EvidenceDocDetail {
    const chunkCount = (
      this.db.app.prepare(`SELECT COUNT(*) AS n FROM evidence_chunk WHERE doc_id=?`).get(row.id) as {
        n: number;
      }
    ).n;
    const citationCount = (
      this.db.app
        .prepare(`SELECT COUNT(*) AS n FROM analysis_citation WHERE evidence_doc_id=?`)
        .get(row.id) as { n: number }
    ).n;
    return {
      id: row.id,
      title: row.title,
      source_type: row.source_type,
      source_url: row.source_url,
      license: row.license,
      verified_at: row.verified_at,
      active: row.active === 1,
      chunk_count: Number(chunkCount ?? 0),
      citation_count: Number(citationCount ?? 0),
      ingest_status: deriveIngestStatus(row.ingest_status, Number(chunkCount ?? 0)),
      ingested_at: row.ingested_at,
      updated_at: row.updated_at,
      raw_text: row.raw_text,
      raw_text_length: (row.raw_text ?? '').length,
    };
  }
  private ensureRef(
    map: Map<string, EvidenceAnalysisReference>,
    analysisId: string,
    episodeId: string,
    version: number,
    createdAt: string,
  ): EvidenceAnalysisReference {
    let ref = map.get(analysisId);
    if (!ref) {
      ref = {
        analysis_id: analysisId,
        episode_id: episodeId,
        episode_title: this.episodeTitle(episodeId),
        analysis_version: version,
        created_at: createdAt,
        statements: [],
        explain_count: 0,
      };
      map.set(analysisId, ref);
    }
    return ref;
  }

  private episodeTitle(episodeId: string): string {
    const ep = this.db.app.prepare(`SELECT title FROM episode WHERE id=?`).get(episodeId) as
      | { title: string }
      | undefined;
    return ep?.title ?? '';
  }

  /** 内容引用（演示实现：按文档标题核心词在 content_version.script 中文本匹配） */
  private contentReferences(docTitle: string): EvidenceContentReference[] {
    const keyword = docTitle.replace(/[《》<>()（）\s]/g, '').replace(/（.*?）/g, '');
    if (!keyword) return [];
    const rows = this.db.app
      .prepare(
        `SELECT ci.id AS content_item_id, ci.title AS content_title, ci.current_status,
                cv.version, cv.published_at
         FROM content_version cv JOIN content_item ci ON ci.id = cv.item_id
         WHERE cv.script LIKE ?
         ORDER BY cv.version ASC, cv.rowid ASC`,
      )
      .all(`%${keyword}%`) as {
      content_item_id: string;
      content_title: string;
      current_status: string;
      version: number;
      published_at: string | null;
    }[];
    return rows.map((r) => ({
      content_item_id: r.content_item_id,
      content_title: r.content_title,
      current_status: r.current_status,
      version: r.version,
      published_at: r.published_at,
      matched_by: `content_version.script 包含「${keyword}」`,
    }));
  }
}

/** 归一化入库状态：未知值按「待切分」处理 */
function normalizeIngestStatus(status: string | null | undefined): IngestStatus {
  return INGEST_STATUSES.includes(status as IngestStatus) ? (status as IngestStatus) : '待切分';
}
/** 入库状态推导：以记录为准；库里有片段但状态仍是「待切分」（如种子 / 迁移前的历史数据）时按已切分 */
function deriveIngestStatus(status: string | null | undefined, chunkCount: number): IngestStatus {
  const normalized = normalizeIngestStatus(status);
  if (normalized === '失败') return '失败';
  if (chunkCount > 0) return '已切分';
  return normalized === '已切分' ? '待切分' : normalized;
}

/** 从 analysis.sections.explain[].citations 中挑出引用指定证据文档的 statement */
function sectionStatementsOf(sections: string | null, docId: string): string[] {
  if (!sections) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(sections);
  } catch {
    return [];
  }
  const explain = (parsed as { explain?: unknown } | null)?.explain;
  if (!Array.isArray(explain)) return [];
  const out: string[] = [];
  for (const item of explain) {
    const citations = (item as { citations?: unknown } | null)?.citations;
    if (!Array.isArray(citations)) continue;
    for (const c of citations) {
      const doc = (c as { evidence_doc_id?: unknown } | null)?.evidence_doc_id;
      const statement = (c as { statement?: unknown } | null)?.statement;
      if (doc === docId && typeof statement === 'string' && statement.trim()) out.push(statement.trim());
    }
  }
  return out;
}

/** statement 去重追加 */
function addStatement(ref: EvidenceAnalysisReference, statement: string): void {
  const text = statement.trim();
  if (!text || ref.statements.includes(text)) return;
  ref.statements.push(text);
}

/** 核实日期：允许 YYYY-MM-DD 或完整 ISO8601；非法值 40000 */
function normalizeDate(value: string | null | undefined, label: string): string | null {
  if (value === undefined || value === null) return null;
  const text = value.trim();
  if (!text) return null;
  const date = new Date(text.length === 10 ? `${text}T00:00:00.000Z` : text);
  if (Number.isNaN(date.getTime())) {
    throw new ApiException(ErrorCode.BAD_REQUEST, `${label}格式不正确，应为 YYYY-MM-DD`);
  }
  return text;
}
