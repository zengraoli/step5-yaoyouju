import { DatabaseSync } from 'node:sqlite';
import { RetrievedChunk } from './model-adapter';
import { TERM_DICT } from '../reports/term-dict';

/**
 * 受控来源检索：只在医学证据库（evidence_chunk）内检索，不访问任何外部服务。
 * 演示实现用关键词匹配打分（中文 2-gram + 术语词典），替代原设计的 pgvector 向量检索。
 */

/** 从检索Query中提取词项：术语词典命中 + 中文 / 字母数字 2-gram */
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

/** 单个片段的打分：命中的查询词项数量（按出现次数累加，术语权重 ×2） */
function scoreChunk(content: string, terms: Set<string>, dictTerms: Set<string>): number {
  let score = 0;
  for (const t of terms) {
    let idx = content.indexOf(t);
    let n = 0;
    while (idx !== -1) {
      n += 1;
      idx = content.indexOf(t, idx + t.length);
    }
    if (n > 0) score += n * (dictTerms.has(t) ? 2 : 1);
  }
  return score;
}

/**
 * 在证据库内检索相关片段，按相关度倒序返回前 limit 条。
 * 仅查询 active 的证据文档；检索不到返回空数组（由调用方决定回退）。
 */
export function retrieveEvidence(
  db: DatabaseSync,
  query: string,
  limit = 5,
): RetrievedChunk[] {
  const rows = db
    .prepare(
      `SELECT c.id AS chunk_id, c.doc_id, c.content, d.title AS doc_title
       FROM evidence_chunk c JOIN evidence_doc d ON d.id = c.doc_id
       WHERE d.active = 1`,
    )
    .all() as { chunk_id: string; doc_id: string; content: string; doc_title: string }[];
  const terms = queryTerms(query);
  const dictTerms = new Set<string>();
  for (const entry of TERM_DICT) {
    const re = new RegExp(entry.pattern.source, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(query)) !== null) dictTerms.add(m[0]);
  }
  if (terms.size === 0) return [];
  return rows
    .map((r) => ({ ...r, score: scoreChunk(r.content, terms, dictTerms) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || (a.chunk_id < b.chunk_id ? -1 : 1))
    .slice(0, limit)
    .map((r) => ({
      chunk_id: r.chunk_id,
      doc_id: r.doc_id,
      doc_title: r.doc_title,
      content: r.content,
      score: r.score,
    }));
}
