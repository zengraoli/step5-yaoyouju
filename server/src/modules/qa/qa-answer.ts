import { RetrievedChunk } from '../analyses/model-adapter';
import { queryTerms } from '../analyses/retrieval';

/**
 * 问与解释的本地回答构造（模板 + 证据片段，不调用任何外部服务）。
 * 参照 analyses/model-adapter.ts 的 LocalMockAdapter 风格：
 * - 每条关键陈述都必须带一个来源引用（evidence_doc / care_event / analysis 三者之一）；
 * - 找不到可引用内容时显示「尚未确认」，不推测、不补写概率；
 * - 回答末尾固定带 disclaimer（系统生成内容，仅供参考，不作诊断）。
 */

/** 产品红线 disclaimer（固定文案，系统生成内容必须携带） */
export const QA_DISCLAIMER = '系统生成内容，仅供参考，不作诊断';

/** 求保证类问题特征（同一会话内连续命中达到阈值即结束本轮） */
export const REASSURANCE_PATTERNS: RegExp[] = [
  /保证/,
  /肯定/,
  /(一定|百分百|百分之百|100\s*%|铁定)/,
  /(没事|不要紧|问题不大)/,
];

/** 同一会话内连续求保证达到该次数 → 给出稳定解释并结束本轮 */
export const REASSURANCE_STREAK = 3;

/** 结束本轮时的固定回复（文案稳定，不做个性化，提示以医生评估为准） */
export const REASSURANCE_REPLY =
  '我能理解你希望听一句“肯定没事”。但要不要紧、会不会好，只有医生结合查体、影像和病史才能判断，我没法给你保证，也不会说“肯定没事”。把你的担心写进复诊问题清单，复诊时请医生评估，以医生的评估为准。';

/** 判断一条用户提问是否为「求保证」类问题 */
export function isReassurance(question: string): boolean {
  return REASSURANCE_PATTERNS.some((p) => p.test(question));
}

/** 问与解释的引用：一条关键陈述对应一个来源（三种 ID 只带一种） */
export interface QaCitation {
  kind: 'evidence_doc' | 'care_event' | 'analysis';
  /** 证据文档 ID（kind = evidence_doc） */
  evidence_doc_id?: string;
  /** 病程事件 ID（kind = care_event） */
  care_event_id?: string;
  /** 一页分析 ID（kind = analysis） */
  analysis_id?: string;
  /** 来源说明（证据文档标题 / 病程事件来源 / 分析版本） */
  source_label: string;
  /** 可核实陈述（用于原文核对） */
  statement: string;
}

export interface QaAnswerInput {
  question: string;
  /** 受控检索到的证据片段（只来自证据库 evidence_chunk） */
  evidence: RetrievedChunk[];
  /** 当前上下文：该用户最新一次一页分析（可为空） */
  analysis: { id: string; version: number; explain: { text: string }[] } | null;
  /** 关联 episode 的病程事件原文 */
  events: { id: string; event_type: string; source_type: string; raw_text: string | null }[];
}

export interface QaAnswer {
  /** 完整回复（末尾带 disclaimer） */
  reply: string;
  citations: QaCitation[];
  /** 未找到可引用内容（按产品红线显示「尚未确认」） */
  unconfirmed: boolean;
}

/** 单条回答最多引用的关键陈述数 */
const MAX_STATEMENTS = 5;
const UNCONFIRMED = '尚未确认';

/**
 * 基于当前上下文构造回答（本地模拟实现）：
 * 一页分析的解释段 → 病程事件原文 → 证据库片段，逐条带来源引用。
 */
export function buildQaAnswer(input: QaAnswerInput): QaAnswer {
  const terms = queryTerms(input.question);
  const picked: { text: string; citation: QaCitation }[] = [];
  const seen = new Set<string>();

  const push = (text: string, citation: QaCitation): void => {
    const key = `${citation.kind}|${citation.evidence_doc_id ?? citation.care_event_id ?? citation.analysis_id}|${text}`;
    if (seen.has(key) || picked.length >= MAX_STATEMENTS) return;
    seen.add(key);
    picked.push({ text, citation });
  };

  // 1. 一页分析的解释段（引用 analysis_id）
  if (input.analysis) {
    for (const st of input.analysis.explain) {
      if (overlap(st.text, terms)) {
        push(st.text, {
          kind: 'analysis',
          analysis_id: input.analysis.id,
          source_label: `一页分析 v${input.analysis.version}`,
          statement: st.text,
        });
      }
    }
  }

  // 2. 关联 episode 的病程事件原文（引用 care_event_id）
  for (const ev of input.events) {
    if (!ev.raw_text) continue;
    for (const sentence of splitSentences(ev.raw_text)) {
      if (overlap(sentence, terms)) {
        push(sentence, {
          kind: 'care_event',
          care_event_id: ev.id,
          source_label: `${ev.event_type}记录（${ev.source_type}）`,
          statement: sentence,
        });
      }
    }
  }

  // 3. 证据库片段（引用 evidence_doc_id）
  for (const c of input.evidence.slice(0, 3)) {
    push(c.content, {
      kind: 'evidence_doc',
      evidence_doc_id: c.doc_id,
      source_label: c.doc_title,
      statement: c.content,
    });
  }

  const contextLabel = input.analysis ? `一页分析 v${input.analysis.version}` : '你的病程记录';
  const header = `基于你当前已核对的信息（${contextLabel}），关于「${input.question.trim()}」：`;
  const lines = picked.map((p) => `- ${p.text}（来源：${p.citation.source_label}）`);
  const body =
    picked.length === 0
      ? `关于这个问题，我已核对的报告原文、病程记录和已审核资料里还没有可引用的内容（${UNCONFIRMED}）。我不会替你推测，建议把这个问题加入复诊问题，请医生帮你确认。`
      : [
          ...lines,
          '',
          '以上解释整理自你的报告原文、病程记录与已审核证据；资料未覆盖的问题会标注「尚未确认」，不作诊断。',
        ].join('\n');
  const reply = `${header}\n${body}\n\n${QA_DISCLAIMER}`;
  return { reply, citations: picked.map((p) => p.citation), unconfirmed: picked.length === 0 };
}

/** 文本与查询词项是否有重合（至少一个长度 ≥2 的词项同时出现） */
function overlap(text: string, terms: Set<string>): boolean {
  for (const t of terms) {
    if (t.length >= 2 && text.includes(t)) return true;
  }
  return false;
}

/** 按句号 / 分号 / 换行切分原文，过滤过短片段 */
function splitSentences(text: string): string[] {
  return text
    .split(/[。；;\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 4);
}
