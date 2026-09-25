/**
 * 报告术语词典（演示实现）：用于从报告原文中抽取术语及其位置。
 * 每条术语给出通俗解释，供「原文对照」页展示；不构成诊断。
 */
export interface TermDictEntry {
  term: string;
  meaning: string;
  pattern: RegExp;
}

export const TERM_DICT: TermDictEntry[] = [
  { term: 'L5/S1', meaning: '第 5 节腰椎与第 1 节骶椎之间的椎间盘', pattern: /L5\s*\/\s*S1/g },
  { term: 'L4/L5', meaning: '第 4 节与第 5 节腰椎之间的椎间盘', pattern: /L4\s*\/\s*L5/g },
  { term: 'L3/L4', meaning: '第 3 节与第 4 节腰椎之间的椎间盘', pattern: /L3\s*\/\s*L4/g },
  { term: '生理曲度变直', meaning: '腰椎自然弧度减小', pattern: /生理曲度变直/g },
  { term: '生理曲度反弓', meaning: '腰椎自然弧度反向', pattern: /生理曲度反弓/g },
  { term: '椎间盘膨出', meaning: '椎间盘均匀向外轻微隆起', pattern: /椎间盘(轻度)?膨出/g },
  { term: '椎间盘突出', meaning: '椎间盘局部突破纤维环', pattern: /椎间盘(轻度)?突出/g },
  { term: '椎间盘脱出', meaning: '椎间盘组织脱出到椎管内', pattern: /椎间盘脱出/g },
  { term: '硬膜囊', meaning: '包裹神经的囊状结构', pattern: /硬膜囊/g },
  { term: '椎管狭窄', meaning: '椎管空间变窄', pattern: /椎管狭窄/g },
  { term: '骨质增生', meaning: '骨边缘增生（常称骨刺）', pattern: /骨质增生/g },
  { term: '骨髓水肿', meaning: '骨内水肿信号，提示可能存在损伤或炎症', pattern: /骨髓水肿/g },
  { term: '骶髂关节', meaning: '骶骨与髂骨之间的关节', pattern: /骶髂关节/g },
  { term: '脊神经根', meaning: '从脊髓分出的神经根', pattern: /脊神经根/g },
  { term: '黄韧带增厚', meaning: '椎管后方韧带变厚', pattern: /黄韧带增厚/g },
  { term: '退行性改变', meaning: '随年龄出现的结构改变，人群中较常见', pattern: /退行性改变/g },
];

export interface ExtractedTerm {
  term: string;
  meaning: string;
  start: number;
  end: number;
}

/** 从原文中抽取术语并记录位置（同一术语多次出现会分别记录） */
export function extractTerms(rawText: string): ExtractedTerm[] {
  const out: ExtractedTerm[] = [];
  const seen = new Set<string>();
  for (const entry of TERM_DICT) {
    const re = new RegExp(entry.pattern.source, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(rawText)) !== null) {
      const start = m.index;
      const end = start + m[0].length;
      out.push({ term: m[0], meaning: entry.meaning, start, end });
      seen.add(`${start}:${end}`);
    }
  }
  return out.sort((a, b) => a.start - b.start || a.end - b.end);
}

/** 演示用示例报告文本（模拟 OCR 返回） */
export const SAMPLE_REPORT_TEXT =
  '腰椎 MRI 平扫（演示文本）：腰椎生理曲度变直。L5/S1 椎间盘轻度膨出，硬膜囊前缘轻度受压。椎体形态信号未见明显异常。报告未描述下肢肌力情况。';
