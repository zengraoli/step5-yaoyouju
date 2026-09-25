import { DatabaseSync } from 'node:sqlite';
import { TERM_DICT } from '../reports/term-dict';

/**
 * 证据库本地检索（T11，演示实现替代原设计的 pgvector 向量检索）。
 *
 * 产品红线：
 * - 只在医学证据库（evidence_chunk）内检索，不访问任何外部服务；
 * - 只检索 active=1 的证据文档，停用的证据立即不再被检索到；
 * - 每条解释能看到的来源都来自证据库。
 *
 * 打分 = 关键词命中分 + 本地向量余弦相似度（混合打分，两项权重均为 1）。
 * 本地向量由词项计数生成（16 维），切分入库时写入 evidence_chunk.embedding（JSON 数组文本）。
 */

/** 本地演示向量维度（与 seed / evidence_chunk.embedding 存储一致） */
export const LOCAL_VECTOR_DIM = 16;

/** 本地演示向量的词项表（词项计数向量，替代真实 embedding 服务） */
export const VECTOR_TERMS = [
  '腰痛',
  '椎间盘',
  '久坐',
  '就医',
  '运动',
  '腿麻',
  '报告',
  '休息',
  '加重',
  '放射',
];

/** 关键词分权重 */
export const KEYWORD_WEIGHT = 1;
/** 本地向量余弦相似度权重 */
export const VECTOR_WEIGHT = 1;

/** 检索策略名（写入 analysis.retrieval_snapshot.strategy） */
export const RETRIEVAL_STRATEGY = '关键词 + 本地向量混合检索（证据库内）';

/** 检索范围说明（供前端 / 审核人确认「只在证据库内检索」） */
export const RETRIEVAL_SCOPE = 'evidence_library_only';

/** 检索到的证据片段（只来自证据库 evidence_chunk） */
export interface RetrievedChunk {
  chunk_id: string;
  doc_id: string;
  doc_title: string;
  content: string;
  score: number;
  /** 来源类型（指南 / 研究 / 审核科普） */
  source_type?: string;
  /** 许可 */
  license?: string;
  /** 片段在文档内的位置（从 0 开始） */
  position?: number;
  /** 关键词命中分（混合打分的组成部分） */
  keyword_score?: number;
  /** 本地向量余弦相似度（混合打分的组成部分） */
  vector_score?: number;
}

/** 检索快照：写入 analysis.retrieval_snapshot，供审核追溯 */
export interface EvidenceRetrievalSnapshot {
  /** 策略名 */
  strategy: string;
  query_terms: string[];
  /** 命中的证据文档 ID（去重） */
  doc_ids: string[];
  chunk_count: number;
  /** 耗时（毫秒） */
  elapsed_ms: number;
  /** 检索范围（产品红线：只在证据库内） */
  scope: string;
  /** 是否只检索启用中的证据文档 */
  active_only: boolean;
}

/** 一次检索的完整结果（片段 + 快照） */
export interface EvidenceSearchOutcome {
  query: string;
  results: RetrievedChunk[];
  retrieval_snapshot: EvidenceRetrievalSnapshot;
}

/** 证据检索服务接口（EvidenceService.search 与 Worker 侧流水线共用同一实现） */
export interface EvidenceRetriever {
  search(query: string, limit?: number): EvidenceSearchOutcome;
}

type ChunkRow = {
  chunk_id: string;
  doc_id: string;
  doc_title: string;
  source_type: string;
  license: string | null;
  content: string;
  embedding: string | null;
  position: number;
};

/** 统计文本中词项出现次数 */
function countOf(text: string, term: string): number {
  let n = 0;
  let idx = text.indexOf(term);
  while (idx !== -1) {
    n += 1;
    idx = text.indexOf(term, idx + term.length);
  }
  return n;
}

/**
 * 本地"向量"：按词项计数生成 16 维演示向量（不使用外部服务）。
 * 与 seed.ts 的口径保持一致，保证库里已存的 embedding 可参与相似度计算。
 */
export function localVector(text: string): number[] {
  const v = VECTOR_TERMS.map((t) => countOf(text ?? '', t));
  while (v.length < LOCAL_VECTOR_DIM) v.push(0);
  return v.slice(0, LOCAL_VECTOR_DIM);
}

/** 余弦相似度（维度不一致时按较短的一侧计算；任一零向量返回 0） */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || b.length === 0) return 0;
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** 解析 evidence_chunk.embedding（JSON 数组文本）；非法值返回 null */
export function parseEmbedding(text: string | null | undefined): number[] | null {
  if (!text) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    const nums: number[] = [];
    for (const x of parsed) {
      if (typeof x !== 'number' || !Number.isFinite(x)) return null;
      nums.push(x);
    }
    return nums;
  } catch {
    return null;
  }
}

/** 从检索 Query 中提取词项：术语词典命中 + 中文 / 字母数字 2-gram */
export function queryTerms(query: string): Set<string> {
  const terms = new Set<string>();
  for (const entry of TERM_DICT) {
    const re = new RegExp(entry.pattern.source, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(query)) !== null) terms.add(m[0]);
  }
  const runs = query.match(/[\u4e00-\u9fa5]{2,}|[a-zA-Z0-9/]{2,}/g) ?? [];
  for (const run of runs) {
    if (run.length <= 2) {
      if (run.length === 2) terms.add(run);
    } else {
      for (let i = 0; i + 2 <= run.length; i += 1) terms.add(run.slice(i, i + 2));
    }
  }
  return terms;
}

/** Query 中命中的术语词典词项（关键词打分时权重 ×2） */
function dictTermsOf(query: string): Set<string> {
  const terms = new Set<string>();
  for (const entry of TERM_DICT) {
    const re = new RegExp(entry.pattern.source, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(query)) !== null) terms.add(m[0]);
  }
  return terms;
}

/** 单个片段的关键词打分：命中的查询词项数量（按出现次数累加，术语权重 ×2） */
function keywordScore(content: string, terms: Set<string>, dictTerms: Set<string>): number {
  let score = 0;
  for (const t of terms) {
    const n = countOf(content, t);
    if (n > 0) score += n * (dictTerms.has(t) ? 2 : 1);
  }
  return score;
}

/** 分数保留 4 位小数，便于展示与快照对比 */
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/**
 * 在证据库内检索相关片段（只查 evidence_chunk，且只查 active=1 的文档）。
 * 混合打分 = 关键词命中分 + 本地向量余弦相似度；没有任何命中时返回空数组。
 */
export function searchEvidence(
  db: DatabaseSync,
  query: string,
  limit = 5,
  strategy: string = RETRIEVAL_STRATEGY,
): EvidenceSearchOutcome {
  const startedAt = Date.now();
  const q = query ?? '';
  const terms = queryTerms(q);
  const dictTerms = dictTermsOf(q);
  const queryVector = localVector(q);

  const rows = db
    .prepare(
      `SELECT c.id AS chunk_id, c.doc_id, c.content, c.embedding, c.position,
              d.title AS doc_title, d.source_type, d.license
       FROM evidence_chunk c JOIN evidence_doc d ON d.id = c.doc_id
       WHERE d.active = 1`,
    )
    .all() as ChunkRow[];

  const scored = rows
    .map((r) => {
      const kw = keywordScore(r.content, terms, dictTerms) * KEYWORD_WEIGHT;
      const embedding = parseEmbedding(r.embedding);
      const vec = (embedding ? cosineSimilarity(queryVector, embedding) : 0) * VECTOR_WEIGHT;
      return {
        row: r,
        keyword_score: round4(kw),
        vector_score: round4(vec),
        score: round4(kw + vec),
      };
    })
    .filter((s) => s.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.row.position - b.row.position ||
        (a.row.chunk_id < b.row.chunk_id ? -1 : 1),
    )
    .slice(0, Math.max(0, limit));

  const results: RetrievedChunk[] = scored.map((s) => ({
    chunk_id: s.row.chunk_id,
    doc_id: s.row.doc_id,
    doc_title: s.row.doc_title,
    content: s.row.content,
    score: s.score,
    source_type: s.row.source_type,
    license: s.row.license ?? undefined,
    position: s.row.position,
    keyword_score: s.keyword_score,
    vector_score: s.vector_score,
  }));

  return {
    query: q,
    results,
    retrieval_snapshot: {
      strategy,
      query_terms: [...terms],
      doc_ids: [...new Set(results.map((r) => r.doc_id))],
      chunk_count: results.length,
      elapsed_ms: Date.now() - startedAt,
      scope: RETRIEVAL_SCOPE,
      active_only: true,
    },
  };
}

/** 兼容入口：只返回片段列表（等价于 searchEvidence(...).results） */
export function retrieveEvidence(db: DatabaseSync, query: string, limit = 5): RetrievedChunk[] {
  return searchEvidence(db, query, limit).results;
}

/**
 * 本地检索服务（不依赖 Nest 容器，Worker 与 API 服务共用）。
 * EvidenceService.search 与 analysis-pipeline 都通过它访问证据库。
 */
export class LocalEvidenceRetriever implements EvidenceRetriever {
  constructor(private readonly db: DatabaseSync) {}

  search(query: string, limit = 5): EvidenceSearchOutcome {
    return searchEvidence(this.db, query, limit);
  }
}
