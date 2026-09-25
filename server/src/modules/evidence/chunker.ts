/**
 * 证据原文切分（T11 切分入库管线，演示实现替代原设计的文档解析服务）。
 *
 * 约定（见 todo/T11-server-evidence.md）：
 * - 按中文句号 / 分号 / 换行切分；
 * - 每片 50-300 字；
 * - 相邻片段重叠 20 字（保留上下文，便于检索时不断句）。
 *
 * 切分是纯函数：同一份原文必然得到同一组片段，配合「按位置更新」实现 ingest 幂等。
 */

/** 片段最小字数 */
export const CHUNK_MIN = 50;
/** 片段最大字数 */
export const CHUNK_MAX = 300;
/** 相邻片段重叠字数 */
export const CHUNK_OVERLAP = 20;

export interface ChunkOptions {
  min?: number;
  max?: number;
  overlap?: number;
}

/** 一个片段：内容 + 在文档内的位置（从 0 开始，连续） */
export interface ChunkSpec {
  content: string;
  position: number;
}

/** 句末标点（切分边界，保留在句子末尾） */
const SENTENCE_END = /[。；;!?！？\n]/;

/** 按句末标点切句（标点保留在句尾）；最后一段若无标点也保留 */
function splitSentences(text: string): string[] {
  const out: string[] = [];
  let buf = '';
  for (const ch of text) {
    buf += ch;
    if (SENTENCE_END.test(ch)) {
      out.push(buf);
      buf = '';
    }
  }
  if (buf.trim()) out.push(buf);
  return out.map((s) => s.trim()).filter((s) => s.length > 0);
}

/** 超长句子硬切为不超过 max 字的片段 */
function hardSplit(sentence: string, max: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < sentence.length; i += max) {
    out.push(sentence.slice(i, i + max));
  }
  return out;
}

/** 取文本末尾 n 个字（不足则全取） */
function tail(text: string, n: number): string {
  return n > 0 && text.length > n ? text.slice(text.length - n) : text;
}

/**
 * 把文档原文切分为片段。
 * 返回的 position 从 0 开始连续递增；片段字数尽量落在 [min, max]，
 * 单个句子超过 max 时硬切；首片段不加重叠，其余片段前置上一片段末尾 overlap 字。
 */
export function splitIntoChunks(text: string, options: ChunkOptions = {}): ChunkSpec[] {
  const min = Math.max(1, options.min ?? CHUNK_MIN);
  const max = Math.max(min, options.max ?? CHUNK_MAX);
  const overlap = Math.max(0, Math.min(options.overlap ?? CHUNK_OVERLAP, Math.floor(max / 2)));

  const cleaned = (text ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (!cleaned) return [];

  const sentences = splitSentences(cleaned);
  const pieces: string[] = [];
  for (const s of sentences) {
    if (s.length > max) pieces.push(...hardSplit(s, max));
    else pieces.push(s);
  }

  // 1. 贪心合并：不超过 max 就继续拼，保证片段尽量长（自然满足 >= min）
  const base: string[] = [];
  let buf = '';
  const flush = () => {
    if (buf.trim()) base.push(buf.trim());
    buf = '';
  };
  for (const p of pieces) {
    if (!buf) {
      buf = p;
      continue;
    }
    if (buf.length + p.length <= max) {
      buf += p;
      continue;
    }
    flush();
    buf = p;
  }
  flush();

  // 2. 末段过短时并回前一段（合并后仍不超过 max 才并）
  if (base.length > 1) {
    const last = base[base.length - 1];
    const prev = base[base.length - 2];
    if (last.length < min && prev.length + last.length <= max) {
      base.splice(base.length - 2, 2, prev + last);
    }
  }

  // 3. 加重叠：后一个片段前置前一个片段末尾 overlap 字（超出 max 时截断本体，保证 <= max）
  const contents: string[] = [];
  for (let i = 0; i < base.length; i += 1) {
    if (i === 0 || overlap === 0) {
      contents.push(base[i]);
      continue;
    }
    const prefix = tail(base[i - 1], overlap);
    const room = max - prefix.length;
    const body = base[i].length > room ? base[i].slice(0, Math.max(0, room)) : base[i];
    contents.push(prefix + body);
  }

  return contents
    .map((c) => c.trim())
    .filter((c) => c.length > 0)
    .map((content, position) => ({ content, position }));
}

/** 演示用：切分参数摘要（写入管线状态，便于后台展示） */
export function chunkerParams(): { min: number; max: number; overlap: number } {
  return { min: CHUNK_MIN, max: CHUNK_MAX, overlap: CHUNK_OVERLAP };
}
