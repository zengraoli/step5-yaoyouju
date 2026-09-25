/**
 * 大模型适配层（可替换接口 + 默认本地模拟实现）。
 *
 * 按 docs/system-design.md 第 5 节：Worker 通过该适配层生成草稿并做陈述 / 引用核对。
 * - 默认 LocalMockAdapter 按模板 + 检索到的证据片段生成，不调用任何外部服务。
 * - 约束：缺失即未知、不补写概率；五段结构固定（已知 / 解释 / 未知 / 下一步 / 视频）。
 * - 每条解释陈述必须能在证据片段中找到支撑（supported），找不到的由 verifyStatements 剔除。
 * 生产环境可替换为真实大模型实现，只要遵循同一接口与约束。
 */

/** 引用：一条解释陈述对应一个证据文档中的可核实陈述 */
export interface Citation {
  evidence_doc_id: string;
  doc_title: string;
  /** 证据中的可核实陈述（用于原文核对） */
  statement: string;
  supported: boolean;
}

export interface ExplainStatement {
  text: string;
  citations: Citation[];
}

export interface NextItem {
  text: string;
  type: string;
}

/** 已知段：可定位到报告原文 / 病程事件（带 care_event_id） */
export interface KnownItem {
  text: string;
  source: string;
  occurred_at: string;
  verify_status: string;
  care_event_id: string;
}

export interface VideoItem {
  content_item_id: string;
  title: string;
  reason: string;
}

/** 固定五段结构（不含 meta，meta 由流水线补充模型 / 检索 / 版本快照） */
export interface AnalysisSections {
  known: KnownItem[];
  explain: ExplainStatement[];
  unknown: string[];
  next: NextItem[];
  videos: VideoItem[];
}

/** 检索到的证据片段（只来自证据库 evidence_chunk） */
export interface RetrievedChunk {
  chunk_id: string;
  doc_id: string;
  doc_title: string;
  content: string;
  score: number;
}

export interface GenerateContext {
  episode_title: string;
  /** 腿部变化：有 / 无 / 尚未确认 / 未记录 */
  leg_change?: string | null;
  /** 报告原文是否描述了下肢肌力情况 */
  report_describes_leg: boolean;
  /** 本次提交的主要困惑 / 提问（可选） */
  question?: string;
}

export interface GenerateInput {
  /** 已知段（由流水线从病程事件确定性构建） */
  known: KnownItem[];
  /** 候选视频（由流水线从内容库选取，受「视频推荐」开关控制） */
  videoCandidates: VideoItem[];
  /** 检索到的证据片段（受控来源） */
  evidence: RetrievedChunk[];
  context: GenerateContext;
}

export interface VerifyResult {
  /** 引用核对后的五段结构：不支持的陈述被剔除 */
  sections: AnalysisSections;
  /** 被剔除的陈述记录（找不到支撑，不进入结果） */
  removed: { text: string; statement: string }[];
}

/** 可替换的大模型适配层接口 */
export interface LlmAdapter {
  readonly name: string;
  /** 生成草稿（约束：缺失即未知、不补写概率；五段结构固定） */
  generateDraft(input: GenerateInput): AnalysisSections;
  /** 陈述提取 + 引用核对：剔除无法在证据片段中支撑的陈述 */
  verifyStatements(draft: AnalysisSections, evidence: RetrievedChunk[]): VerifyResult;
}

/** 产品红线：不诊断、缺失显示尚未确认、报告未描述显示报告未提及 */
const UNCONFIRMED = '尚未确认';
const REPORT_NOT_MENTIONED = '报告未提及';

/**
 * 默认本地模拟实现：按模板 + 证据片段生成，不调用外部服务。
 * 每条解释直接取自受控证据片段，statement 设为片段原文，保证可被核对支撑。
 */
export class LocalMockAdapter implements LlmAdapter {
  readonly name = 'local-mock';

  generateDraft(input: GenerateInput): AnalysisSections {
    const { context, evidence } = input;
    // 解释：仅使用检索到的证据片段，逐条生成可核实解释（缺失即不生成，不补写）
    const explain: ExplainStatement[] = evidence.slice(0, 5).map((c) => ({
      text: c.content,
      citations: [
        {
          evidence_doc_id: c.doc_id,
          doc_title: c.doc_title,
          statement: c.content,
          supported: true,
        },
      ],
    }));

    // 未知：缺失信息明确标注，绝不下结论
    const unknown: string[] = [];
    if (!context.report_describes_leg) {
      unknown.push(`下肢肌力情况：${REPORT_NOT_MENTIONED}，${UNCONFIRMED}`);
    }
    const leg = context.leg_change;
    if (!leg || leg === UNCONFIRMED) {
      unknown.push(`腿部感觉 / 力量变化：${UNCONFIRMED}`);
    } else if (leg === '有') {
      unknown.push(`腿部变化与腰部症状的关系：${UNCONFIRMED}`);
    }
    unknown.push(`当前症状与影像改变的因果关系：${UNCONFIRMED}`);

    // 下一步：可执行的生活任务与复诊问题（不作诊断、不给用药 / 手术建议）
    const next: NextItem[] = [
      { text: '继续观察并记录每天能坐多久与睡眠影响，复诊时带给医生', type: '生活任务' },
      { text: '复诊时请医生查体确认下肢肌力与腿部变化', type: '复诊问题' },
    ];
    if (context.question && context.question.trim()) {
      next.push({ text: `复诊时向医生确认：${context.question.trim()}`, type: '复诊问题' });
    }

    return {
      known: input.known,
      explain,
      unknown,
      next,
      videos: input.videoCandidates,
    };
  }

  verifyStatements(draft: AnalysisSections, evidence: RetrievedChunk[]): VerifyResult {
    const kept: ExplainStatement[] = [];
    const removed: { text: string; statement: string }[] = [];
    for (const stmt of draft.explain) {
      const citation = stmt.citations[0];
      if (!citation) {
        removed.push({ text: stmt.text, statement: '' });
        continue;
      }
      const support = findSupport(citation.statement, evidence);
      if (support) {
        // 核对通过：绑定到实际支撑它的证据片段
        kept.push({
          text: stmt.text,
          citations: [
            {
              evidence_doc_id: support.doc_id,
              doc_title: support.doc_title,
              statement: citation.statement,
              supported: true,
            },
          ],
        });
      } else {
        // 找不到支撑：剔除并记录（不进入结果）
        removed.push({ text: stmt.text, statement: citation.statement });
      }
    }
    return { sections: { ...draft, explain: kept }, removed };
  }
}

/**
 * 在证据片段中为一条陈述寻找支撑：
 * - 先做归一化后的原文包含匹配（强支撑）；
 * - 再做 2-gram 关键词重合度匹配（允许轻微改写，阈值 0.6）。
 */
export function findSupport(
  statement: string,
  evidence: RetrievedChunk[],
): RetrievedChunk | null {
  const normStmt = normalize(statement);
  if (!normStmt) return null;
  for (const c of evidence) {
    if (normalize(c.content).includes(normStmt)) return c;
  }
  // 关键词重合度（简化中文分词：2-gram）
  const stmtGrams = bigrams(normStmt);
  if (stmtGrams.size === 0) return null;
  let best: RetrievedChunk | null = null;
  let bestRatio = 0;
  for (const c of evidence) {
    const content = normalize(c.content);
    let hit = 0;
    for (const g of stmtGrams) if (content.includes(g)) hit += 1;
    const ratio = hit / stmtGrams.size;
    if (ratio > bestRatio) {
      bestRatio = ratio;
      best = c;
    }
  }
  return bestRatio >= 0.6 ? best : null;
}

/** 归一化：去空白与常见标点，便于包含匹配 */
function normalize(s: string): string {
  return s.replace(/[\s，。、；：？！""''（）()【】《》\-—…·,.!?;:]/g, '');
}

/** 提取中文 / 字母数字序列的 2-gram 集合 */
function bigrams(s: string): Set<string> {
  const runs = s.match(/[\u4e00-\u9fa5]{2,}|[a-zA-Z0-9]{2,}/g) ?? [];
  const out = new Set<string>();
  for (const run of runs) {
    if (run.length === 2) {
      out.add(run);
    } else {
      for (let i = 0; i + 2 <= run.length; i += 1) out.add(run.slice(i, i + 2));
    }
  }
  return out;
}
