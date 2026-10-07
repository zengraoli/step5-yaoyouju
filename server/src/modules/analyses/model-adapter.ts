/**
 * 大模型适配层（可替换接口 + 默认本地模拟实现）。
 *
 * 按 docs/system-design.md 第 5 节：Worker 通过该适配层生成草稿并做陈述 / 引用核对。
 * - 默认 LocalMockAdapter 按模板 + 检索到的证据片段生成，不调用任何外部服务。
 * - 约束：缺失即未知、不补写概率；五段结构固定（已知 / 解释 / 未知 / 下一步 / 视频）。
 * - 每条解释陈述必须能在证据片段中找到支撑（supported），找不到的由 verifyStatements 剔除。
 * 生产环境可替换为真实大模型实现，只要遵循同一接口与约束。
 */

import type { RetrievedChunk } from '../evidence/evidence-retrieval';

// 检索到的证据片段类型以 evidence 模块为准（T11 起检索实现收敛到 evidence 模块）
export type { RetrievedChunk };

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

/**
 * 影像节段对被规范化集合：把「L5/S1、L4-L5、L4/5、腰5骶1」等二级配对归一成比较键（如 L5S1、L4L5），
 * 单节（L4、S1）也归一（如 L4、S1）。供「解释 / 视频与用户输入是否同节段」判断（第十一轮~F12 第 1 条）。
 */
export function segmentPairs(text: string): Set<string> {
  const pairs = new Set<string>();
  if (!text) return pairs;
  const re = /([lsct])\s*(\d)\s*[/／\\\-—＿_]\s*([lsct])?\s*(\d)?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const a = m[1].toUpperCase() + m[2];
    if (m[4]) {
      const b = (m[3] ? m[3].toUpperCase() : m[1].toUpperCase()) + m[4];
      pairs.add(a + b); // e.g. L5S1、L4L5
      pairs.add(a);
      pairs.add(b);
    } else {
      pairs.add(a); // 单节 L4 / S1
    }
  }
  return pairs;
}

/** 文本里声明的影像类型（MRI / CT / X线…），小写归一 */
export function imagingTypes(text: string): Set<string> {
  const out = new Set<string>();
  if (/mri|核磁|磁共振/i.test(text)) out.add('mri');
  if (/\bct\b|断层|螺旋ct/i.test(text)) out.add('ct');
  if (/x\s*线|dr\b|正侧位|平片|x-ray/i.test(text)) out.add('xray');
  return out;
}

/**
 * 证据片段内容是否与报告原文的真实节段 / 影像类型相符：
 * - 片段若解释了某个二级节段（如 L5/S1），该节段必须出现在报告里，否则判为不相关（不凭空补未知节段）；
 * - 片段若属某影像类型（如 MRI）而报告是另一明确类型（如 CT），判为不相关。
 * 两者都没声明节段 / 类型（一般性内容）时视为相关。
 */
export function chunkRelevantToReport(chunkContent: string, reportText: string): boolean {
  const reportPairs = segmentPairs(reportText);
  const chunkPairs = segmentPairs(chunkContent);
  if (reportPairs.size > 0 && chunkPairs.size > 0) {
    const chunkOnlyPairs = [...chunkPairs].filter((p) => p.length > 2 && !reportPairs.has(p));
    if (chunkOnlyPairs.length > 0) return false; // 片段解释的报告里没有的节段
  }
  const cT = imagingTypes(chunkContent);
  const rT = imagingTypes(reportText);
  if (cT.size > 0 && rT.size > 0 && [...cT].every((t) => !rT.has(t))) return false; // 类型不符
  return true;
}

export interface GenerateContext {
  episode_title: string;
  /** 腿部变化：有 / 无 / 尚未确认 / 未记录 */
  leg_change?: string | null;
  /** 报告原文是否描述了下肢肌力情况 */
  report_describes_leg: boolean;
  /** 是否录入了报告（没有报告时不能说「报告未提及」，也不推荐报告解读类视频） */
  has_report?: boolean;
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
    // 解释只解释用户输入里真实出现的节段 / 类型：检索片段若解释了报告没有的节段（如报告是 CT 的 L4-5，
    // 却解释 MRI 的 L5/S1），先按 segmentPairs / imagingTypes 判为不相关，绝不凭空补未知节段（F12 第 1 条）。
    const reportText = input.known.map((k) => k.text).join('\n') + '\n' + (context.question ?? '');
    const relevantEvidence = evidence.filter((c) => chunkRelevantToReport(c.content, reportText));
    // 解释：仅使用相关且受控的证据片段，逐条生成可核实解释（缺失即不生成，不补写）
    const explain: ExplainStatement[] = relevantEvidence.slice(0, 5).map((c) => ({
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
    if (context.has_report === false) {
      // 没有录入报告：不能说「报告未提及」（那是已有报告但未描述），只能标尚未确认
      unknown.push(`下肢肌力情况：${UNCONFIRMED}（尚未录入报告）`);
    } else if (!context.report_describes_leg) {
      unknown.push(`下肢肌力情况：${REPORT_NOT_MENTIONED}，${UNCONFIRMED}`);
    }
    const leg = context.leg_change;
    if (!leg || leg === UNCONFIRMED) {
      unknown.push(`腿部感觉 / 力量变化：${UNCONFIRMED}`);
    } else if (leg === '有') {
      unknown.push(`腿部变化与腰部症状的关系：${UNCONFIRMED}`);
    }
    unknown.push(
      context.has_report === false
        ? `当前症状的原因：${UNCONFIRMED}`
        : `当前症状与影像改变的因果关系：${UNCONFIRMED}`,
    );

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
