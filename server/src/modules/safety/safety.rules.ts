/**
 * 安全规则集（临床审定规则，演示实现）。
 * - 红旗规则 RF-xx：命中即提示就医；high 级同时停止个性化分析（R03）。
 * - 服务范围规则 OOS-xx：诊断 / 手术 / 用药 / 治疗 / 预后越界，明确不答，转为复诊问题。
 * 规则集带版本号，变更需递增版本并记录（B07 规则集版本）。
 *
 * 匹配策略（验收反馈：约 97 条自编说法只命中约 19 条，同时误判了否定与日常说法）：
 * 1. 文本先归一化：全角→半角、去掉空白、统一标点，提升口语 / 错别字文本的命中率；
 * 2. 红旗规则用「部位 / 主体 × 症状」组合匹配（而不是穷举整句）：
 *    - `subjects`（会阴、鞍区、屁股中间、双腿、左脚背、大小便、癌…）；
 *    - `symptoms`（麻木、没感觉、翘不起来、失禁、憋不住、兜不住…）；
 *    - 主体与症状可以同时出现在同一小句里（默认距离 ≤ 8 个字），允许症状在前（「麻木的双腿」）；
 *    这样口语、语序变化、错别字（会音 / 双退 / 失噤）都能命中，而不必逐句穷举；
 * 3. `standalone` 短语（发烧、夜间痛醒、体重掉了十斤、摔了一跤、剧痛）不依赖主体，同样参与否定识别；
 * 4. 否定识别（三层）：
 *    - 小句级：小句里有否定词（没有 / 无 / 未 / 否认…）且没有肯定性词语（有 / 出现 / 加重 / 只有…）→ 整句判否；
 *    - 间隙级：主体与症状之间的文字里有否定词（「无进行性无力」「没有麻木」）→ 判否；
 *    - 后随级：症状紧跟「正常 / 良好 / 无异常」→ 判否；
 * 5. 第三方叙述：小句以「我孩子 / 我老婆 / 弟弟…」等他人称谓开头，且叙述到「我自己」之前，
 *    该范围内的症状不算使用者本人的症状（「孩子发烧了我请假在家照顾」「弟弟摔了一跤我自己腰痛」）。
 */

export const RULE_SET_VERSION = 'safety-rules-v3.0';

/** 归一化：全角→半角、去空白、统一常见标点 */
export function normalizeSafetyText(input: string): string {
  if (!input) return '';
  return input
    .replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, ' ')
    .replace(/\s+/g, '')
    .replace(/[，、；]/g, '，')
    .replace(/[。！？]/g, '。')
    .replace(/[（）()~～]/g, '')
    .toLowerCase();
}

/** 否定词（出现在症状短语之前；长的放前面，保证正则优先匹配长词） */
export const NEGATION_WORDS = [
  '并没有出现',
  '均没有',
  '都没有',
  '没有出现',
  '无明显',
  '没有明显',
  '还没有',
  '无异常',
  '未出现',
  '未见有',
  '未见',
  '并无',
  '并未',
  '否认',
  '没有',
  '未有',
  '未',
  '无',
  '没',
  '不',
];

/** 核心短语之后紧跟的「正常类」描述（判为否定） */
export const NORMAL_AFTER_WORDS = [
  '大致正常',
  '基本正常',
  '无异常',
  '未见异常',
  '未见明显',
  '正常',
  '良好',
  '尚可',
  '通畅',
  '灵敏',
];

/** 与否定无关、但常被否定词误伤的短语（命中后先剔除再做否定识别） */
const NOT_NEGATION_PHRASES = ['不小心', '不留神', '不知不觉', '无心', '无碍', '无聊'];

/** 肯定性词语（小句里有这些词时不做整句判否，只做局部否定识别） */
const POSITIVE_MARKERS = [
  '有',
  '出现',
  '伴有',
  '开始',
  '新增',
  '加重',
  '越来越',
  '持续',
  '一直',
  '只有',
  '反倒',
  '反而',
  '确实',
  '仍然',
  '还是',
];

/** 第三方称谓（叙述他人情况）：如「我老婆」「孩子」「弟弟…」 */
const THIRD_PARTY_SUBJECT_SOURCE =
  '我?(?:孩子|宝宝|小孩|儿子|女儿|老婆|老公|妻子|丈夫|我妈|我爸|爸爸妈妈|妈妈|爸爸|父母|弟弟|妹妹|哥哥|姐姐|家人|老人|同事|室友|父亲|母亲|老伴|邻居|同学|病人)';

/** 第三方叙述的结束标记（遇到这些词说明叙述回到使用者本人） */
const THIRD_PARTY_STOP_TOKENS = ['我自己', '但是', '但', '可是', '不过', '然而', '而是', '却', '也', '还', '反而', '反倒'];

/** 第三方叙述最大长度（避免把本人的症状也吞掉） */
const THIRD_PARTY_MAX_SPAN = 18;

const NEGATION_SOURCE = NEGATION_WORDS.map(escapeRegExp).join('|');
/** 以「否定词 + 0~3 个非标点字」结尾 */
const TRAILING_NEGATION = new RegExp(`(?:${NEGATION_SOURCE})[^\uFF0C\u3002\uFF1B,.;]{0,3}$`);
/** 只含否定词（紧邻） */
const STRICT_NEGATION = new RegExp(`(?:${NEGATION_SOURCE})$`);
/** 否定只作用于紧随其后的修饰语 + 症状时才算否定 */
const NEG_FILLER = '(?:明显|感觉|的|了|也|还|又|再|特别|非常|很|什么)';
/** 否定词 + 修饰词结尾（严格模式，用于症状之前的前缀判断） */
const STRICT_TRAILING = new RegExp(`(?:${NEGATION_SOURCE})(?:${NEG_FILLER}){0,2}$`);

/** 转折词（出现在否定与症状之间时，说明叙述转回肯定） */
const TURN_MARKERS = ['但是', '可是', '不过', '然而', '而是', '却', '反而', '反倒', '而且'];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface CoreMatch {
  /** 核心短语在归一化文本中的起始位置 */
  start: number;
  end: number;
  text: string;
}

/** 找出归一化文本中该核心短语的全部出现位置 */
export function findCoreMatches(text: string, core: string): CoreMatch[] {
  const re = new RegExp(core, 'g');
  const out: CoreMatch[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push({ start: m.index, end: m.index + m[0].length, text: m[0] });
    if (m.index === re.lastIndex) re.lastIndex += 1;
  }
  return out;
}

// ---------- 小句切分与否定 / 第三方识别 ----------

interface Fragment {
  start: number;
  end: number;
}

/** 切分小句（按标点），给出每段范围 */
function splitFragments(text: string): Fragment[] {
  const re = /[，,。；;！!？?\n]/g;
  const out: Fragment[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push({ start: last, end: m.index });
    last = m.index + 1;
  }
  if (last < text.length) out.push({ start: last, end: text.length });
  return out;
}

/**
 * 匹配位置之前是否存在「否定作用域」：
 * - 否定词紧贴症状（含少量修饰词）→ 判否；
 * - 或同一小句里症状之前有否定词、且否定词与症状之间没有转折词、
 *   整个小句也没有肯定性词语 → 整句判否（如「否认大小便失禁及会阴部麻木」）。
 * 例「没减肥体重却掉了七八公斤」：否定词与症状之间有「减肥体重却」，不判否。
 */
function negatedBefore(fragments: Fragment[], masked: string, at: number): boolean {
  const fragment = fragmentOf(fragments, at);
  if (!fragment) return false;
  let prefix = masked.slice(fragment.start, at);
  let full = masked.slice(fragment.start, fragment.end);
  for (const phrase of NOT_NEGATION_PHRASES) {
    prefix = prefix.split(phrase).join('');
    full = full.split(phrase).join('');
  }
  if (STRICT_NEGATION.test(prefix) || STRICT_TRAILING.test(prefix)) return true;
  // 找出前缀里最后一个否定词的位置
  let lastNeg = -1;
  for (const word of NEGATION_WORDS) {
    const idx = prefix.lastIndexOf(word);
    if (idx >= 0 && idx + word.length > lastNeg) lastNeg = idx + word.length;
  }
  if (lastNeg < 0) return false;
  if (TURN_MARKERS.some((t) => prefix.slice(lastNeg).includes(t))) return false;
  for (const word of NEGATION_WORDS) full = full.split(word).join('');
  return !POSITIVE_MARKERS.some((p) => full.includes(p));
}
interface ThirdPartySpan {
  start: number;
  end: number;
}

/** 他人称谓 + 其后的一段叙述（到「我自己 / 也 / 但」等之前） */
function thirdPartySpans(text: string): ThirdPartySpan[] {
  const re = new RegExp(THIRD_PARTY_SUBJECT_SOURCE, 'g');
  const out: ThirdPartySpan[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    let end = Math.min(text.length, m.index + m[0].length + THIRD_PARTY_MAX_SPAN);
    for (const token of THIRD_PARTY_STOP_TOKENS) {
      const idx = text.indexOf(token, m.index + m[0].length);
      if (idx !== -1 && idx < end) end = idx;
    }
    out.push({ start: m.index, end });
  }
  return out;
}

function insideThirdParty(spans: ThirdPartySpan[], start: number, end: number): boolean {
  return spans.some((s) => start >= s.start && end <= s.end);
}

/** 局部否定：主体前、主体与症状之间、症状之后紧跟正常类词语 */
function locallyNegated(text: string, first: CoreMatch, second: CoreMatch): boolean {
  const before = text.slice(Math.max(0, first.start - 6), first.start);
  if (STRICT_NEGATION.test(before) || STRICT_TRAILING.test(before)) return true;
  const gap = text.slice(first.end, second.start);
  // 主体与症状之间的否定 = 否定整个短语（「无进行性无力」「没有明显麻木」）
  if (gap && NEGATION_WORDS.some((w) => gap.includes(w))) return true;
  const after = text.slice(second.end, second.end + 8);
  return NORMAL_AFTER_WORDS.some((w) => after.startsWith(w));
}

// ---------- 规则结构 ----------

export type SafetyAction = '提示就医' | '停止个性化分析';
export type SafetySeverity = 'high' | 'medium';

export interface RedFlagRule {
  code: string;
  label: string;
  severity: SafetySeverity;
  action: SafetyAction;
  /** 命中后展示的提示（不含诊断结论） */
  advice: string;
  /** 主体 / 部位（正则片段，覆盖口语 / 书面语 / 常见错别字） */
  subjects?: string[];
  /** 症状表达（与主体组合出现时命中） */
  symptoms?: string[];
  /** 主体与症状之间的最大间隔字数（默认 8） */
  gap?: number;
  /** 不依赖主体的独立短语（如「发烧」「摔了一跤」） */
  standalone?: string[];
}

/** 疼痛 / 加重等常用片段（复用） */
const WORSE = '(?:加重|变重|越来越严重|加重了|更痛|更疼|越来越痛)';

/** 会阴 / 鞍区（含口语与常见错别字） */
const PERINEUM_SUBJECTS = [
  '会阴(?:部|区|处|部位|一带)?',
  '会音(?:部|区|处)?',
  '会因(?:部|区|处)?',
  '汇阴(?:部|区|处)?',
  '回阴(?:部|区|处)?',
  '马鞍区',
  '马安区',
  '安骑区',
  '鞍区',
  '屁股(?:中间|正中|沟|沟那一带|底下|下面|眼|根)?',
  '臀部',
  '臀区',
  '下身(?:一点|有些)?',
  '下半身',
  '下面(?:一点|有些)?',
  '底下',
  '下体',
  '私处',
  '生殖器',
  '阴部',
  '阴部(?:周围|一带)?',
  '肛门(?:周围|边缘|附近)?',
  '肛周',
  '裆部',
  '胯下',
  '大腿根(?:部)?',
  '蛋蛋',
  '菊花',
];

/** 感觉异常表达 */
const NUMBNESS_SYMPTOMS = [
  '麻木',
  '发麻',
  '发木',
  '木木的',
  '麻麻的',
  '发木',
  '没感觉',
  '没有感觉',
  '没什么感觉',
  '感觉不到',
  '无知觉',
  '没知觉',
  '没有知觉',
  '感觉减退',
  '感觉减弱',
  '感觉消失',
  '减退',
  '减弱',
  '消失',
  '像隔了一层[布纸]?',
  '隔了一层布',
  '隔着一层布',
  '像隔了层东西',
  '不敏感',
  '麻',
];

/** 下肢无力 / 行走变化 */
const LEG_SUBJECTS = [
  '双腿',
  '两条腿',
  '双退',
  '双下肢',
  '下肢',
  '双腿肌',
  '腿部',
  '左腿',
  '右腿',
  '左下肢',
  '右下肢',
  '左退',
  '右退',
  '左脚(?:背|踝)?',
  '右脚(?:背|踝)?',
  '双脚',
  '大腿',
  '小腿',
  '腿',
  '脚',
  '肌力',
];

const LEG_WEAKNESS_SYMPTOMS = [
  '无力',
  '没劲',
  '没力气',
  '没力',
  '使不上劲',
  '使不上力气',
  '没劲走路',
  '抬不起',
  '抬不起来',
  '抬不动',
  '翘不起',
  '翘不起来',
  '勾不起来',
  '勾不住',
  '站不起来',
  '站不住',
  '走不了路',
  '走不动',
  '走不了',
  '拖[着地]?走',
  '拖着脚',
  '拖着地',
  '堕着走',
  '足下垂',
  '垂足',
  '进行性下降',
  '力量下降',
  '力量减弱',
  '越来越重',
  '越来越沉',
  '不听使唤',
  '不听了使唤',
  '发软',
  '发软走',
  '不利索',
  '不利落',
  '变差',
  '又差',
  '更差',
  '下降了',
  '降低了',
  '灌了铅',
  '像绑了沙袋',
  '使不上',
  '上不了楼',
  '爬不了楼',
  '上不去楼',
  '蹲下起不来',
  '摔跤',
  '跌倒',
  '肌肉萎缩',
  '萎缩',
];

/** 大小便控制变化 */
const BOWEL_SUBJECTS = [
  '大小便',
  '大小二便',
  '大小变',
  '大小便儿',
  '大便小便',
  '屎尿',
  '尿屎',
  '二便',
  '排便排尿',
  '大便',
  '小便',
  '便便',
  '尿尿',
  '排尿',
  '排便',
  '屎',
  '尿',
];

const BOWEL_SYMPTOMS = [
  '失禁',
  '失噤',
  '失紧',
  '失襟',
  '失控',
  '兜不住',
  '兜不了',
  '憋不住',
  '忍不住',
  '憋不了',
  '控制(?:困难|不住|不了|不良|障碍|失灵|不行|异常|有问题|不正常)',
  '变化',
  '不能控制',
  '无法控制',
  '不由自主',
  '不自主',
  '拉在身上',
  '在裤子(?:里|中|上)',
  '拉裤[子裆]里',
  '尿裤子',
  '尿床',
  '漏尿',
  '尿不[住禁]',
  '解不出',
  '解不出[便尿]',
  '排不出',
  '尿不出',
  '尿不出来',
  '尿不[出多]少[尿量]',
  '尿潴留',
  '潴留',
  '便意(?:消失|丧失|淡漠)',
  '尿意(?:消失|减弱)',
  '尿线[^。，,;；]{0,6}(?:变细|费劲|很细|没劲)',
  '使劲才能尿',
  '费劲才能尿',
  '便秘[^。，,;；]{0,4}(?:加重|严重|厉害)',
  '排尿(?:困难|障碍)',
  '排便(?:困难|障碍)',
  '功能障碍',
  '障碍',
];

/**
 * 红旗规则集 v3：
 * 会阴/鞍区感觉、下肢进行性无力、大小便控制、持续不缓解的夜间痛、
 * 不明原因体重下降、伴发热、肿瘤史新发腰痛、外伤后持续加重、足部感觉与行走变化、
 * 难以忍受的剧痛。
 */
export const RED_FLAG_RULES: RedFlagRule[] = [
  {
    code: 'RF-01',
    label: '会阴部麻木',
    severity: 'high',
    action: '停止个性化分析',
    advice: '会阴部（或鞍区）麻木需要尽快由医生评估，请前往医院就诊。',
    subjects: PERINEUM_SUBJECTS,
    symptoms: NUMBNESS_SYMPTOMS,
    gap: 8,
  },
  {
    code: 'RF-02',
    label: '双腿进行性无力',
    severity: 'high',
    action: '停止个性化分析',
    advice: '下肢无力如果在加重，需要尽快由医生评估，请前往医院就诊。',
    subjects: LEG_SUBJECTS,
    symptoms: LEG_WEAKNESS_SYMPTOMS,
    gap: 8,
    standalone: [
      '腿软',
      '走[0-9一二三四五六七八九十百]{1,6}米[^。，,;；]{0,6}(?:歇|停)',
      '像(?:绑了沙袋|灌了铅|拖了沙袋)',
      '肌力(?:4|四)级',
      '(?:肌力|双下肢肌力)[^。，,;；]{0,4}比[^。，,;；]{0,6}(?:又|更)?差',
      '肌力(?:进行性|逐渐|越来越)?(?:下降|减弱|变差)',
      '(?:双|左|右)腿(?:麻木|发麻)(?:无力|没劲)',
      '走路[^。，,;；]{0,6}(?:越来越)?费劲',
    ],
  },
  {
    code: 'RF-03',
    label: '大小便控制变化',
    severity: 'high',
    action: '停止个性化分析',
    advice: '大小便控制出现变化需要尽快由医生评估，请立即就医。',
    subjects: BOWEL_SUBJECTS,
    symptoms: BOWEL_SYMPTOMS,
    gap: 8,
    standalone: [
      '咳嗽[^。，,;；]{0,4}(?:漏尿|漏)',
      '控制[困容]?难[或]?失禁',
      '大小便[^。，,;；]{0,6}(?:失禁|失控)',
      '尿裤子',
      '憋不住(?:尿|大便|便|屎尿)',
      '屎尿都(?:兜不住|憋不住)',
    ],
  },
  {
    code: 'RF-04',
    label: '持续不缓解的夜间痛',
    severity: 'medium',
    action: '提示就医',
    advice: '夜间或静息时持续不缓解的疼痛建议及时就医评估。',
    standalone: [
      '夜间痛[^。，,;；]{0,6}(?:不缓|不缓解|没有缓解|没缓解)',
      '夜间疼[^。，,;；]{0,6}(?:不缓|不缓解|没有缓解|没缓解)',
      '夜里疼[^。，,;；]{0,6}(?:不缓|不缓解|没有缓解|没缓解)',
      '夜间痛醒',
      '夜里痛醒',
      '夜里疼醒',
      '半夜痛醒',
      '半夜疼醒',
      '晚上痛醒',
      '痛醒',
      '疼醒',
      '夜里比白天(?:还|更)(?:痛|疼)',
      '夜间比白天(?:还|更)(?:痛|疼)',
      '静息痛',
      '休息(?:时|的)?也(?:痛|疼)',
      '(?:夜里|晚上|夜间)[^。，,;；]{0,6}(?:更痛|更疼|厉害|加重)',
      '(?:夜里|晚上|夜间)一躺下[^。，,;；]{0,6}(?:痛|疼)',
      '(?:夜里|晚上|夜间)只能睡[0-9一二两三四五六七八九十]{1,3}(?:个)?小时',
      '夜间痛',
      '夜里痛',
      '夜里一直(?:痛|疼)',
      '晚上一直(?:痛|疼)',
      '疼(?:得|的)睡不着',
      '痛(?:得|的)睡不着',
    ],
  },
  {
    code: 'RF-05',
    label: '不明原因体重下降',
    severity: 'medium',
    action: '提示就医',
    advice: '不明原因体重下降伴疼痛建议及时就医评估。',
    standalone: [
      '(?:体重|个子|身子)?(?:瘦|掉|降|减|轻|少)(?:了|下|少)?[0-9一二两三四五六七八九十]{1,4}(?:斤|公斤|千克|kg)',
      '不明原因(?:消瘦|体重下降|瘦)',
      '明显消瘦',
      '消瘦',
      '体重(?:明显)?(?:下降|减轻|减少|掉了|掉得|瘦了)',
      '体重[^。，,;；]{0,4}(?:掉|降|减|轻|少)',
      '瘦了一圈',
      '没(?:节食|减肥)[^。，,;；]{0,6}(?:瘦|轻|掉)',
      '体重瘦(?:了|下来)',
      '半年(?:内|里)?瘦(?:了|下来)',
      '裤子(?:腰围|腰)?[^。，,;；]{0,6}(?:大了|松了|胖了)',
    ],
  },
  {
    code: 'RF-06',
    label: '伴发热',
    severity: 'medium',
    action: '提示就医',
    advice: '腰痛伴发热建议及时就医评估。',
    standalone: [
      '发高烧',
      '发低烧',
      '高烧',
      '低烧',
      '低烧不退',
      '发烧',
      '发热',
      '高热',
      '烧到3[89]',
      '体温3[89]',
      '3[89](?:度|℃)',
      '烧不退',
      '反复(?:发烧|发热)',
      '打寒战',
      '畏寒发热',
    ],
  },
  {
    code: 'RF-07',
    label: '肿瘤史新发腰痛',
    severity: 'medium',
    action: '提示就医',
    advice: '有肿瘤病史者新发腰痛建议及时就医评估。',
    subjects: [
      '癌',
      '恶性肿瘤',
      '肿瘤',
      '淋巴瘤',
      '白血病',
      '肉瘤',
      '骨髓瘤',
      '转移瘤',
      '转移癌',
      '癌细胞',
      '化疗',
      '放疗',
    ],
    symptoms: [
      '病史',
      '史',
      '得过',
      '得了',
      '切除',
      '术后',
      '手术后',
      '化疗',
      '放疗',
      '治疗过',
      '两年',
      '三年',
    ],
    gap: 8,
    standalone: ['肿瘤(?:病|疾)史', '癌症(?:病|疾)史', '既往(?:有)?(?:癌|肿瘤)', '恶性肿瘤史'],
  },
  {
    code: 'RF-08',
    label: '外伤后持续加重',
    severity: 'medium',
    action: '提示就医',
    advice: '外伤后持续加重的疼痛建议及时就医评估。',
    standalone: [
      '摔(?:了|过)?一?跤',
      '摔倒',
      '跌倒',
      '摔伤',
      '撞(?:了|过)?一?下',
      '撞到',
      '车祸',
      '被车[撞碰]',
      '扭(?:到|伤)?腰',
      '闪(?:到)?腰',
      '搬重物',
      '搬花盆',
      '高处坠落',
      '从(?:床|梯子|楼梯)[^。，,;；]{0,6}(?:摔|跌)',
      `外伤(?:后|之)?[，,]?疼(?:痛)?(?:持续)?${WORSE}`,
      '外伤(?:后|之)?腰痛',
    ],
  },
  {
    code: 'RF-09',
    label: '足部感觉或行走明显变化',
    severity: 'medium',
    action: '提示就医',
    advice: '足部感觉或行走明显变化建议及时就医评估。',
    subjects: [
      '脚(?:背|底|趾|指头|踝|丫)?',
      '左脚(?:背|底|趾)?',
      '右脚(?:背|底|趾)?',
      '双脚',
      '足背',
      '足底',
      '脚步',
      '路',
    ],
    symptoms: [
      '麻木',
      '发麻',
      '发木',
      '木木的',
      '麻麻的',
      '没感觉',
      '无知觉',
      '踩棉花',
      '踩棉絮',
      '像踩在棉花',
      '走路不稳',
      '走[路去][^。，,;；]{0,4}(?:不稳|晃|飘)',
      '步态不稳',
      '步态异常',
      '翘不起来',
      '勾不住',
      '拖地走',
      '拖着脚',
      '使不上劲',
    ],
    gap: 8,
  },
  {
    code: 'RF-10',
    label: '难以忍受的疼痛',
    severity: 'medium',
    action: '提示就医',
    advice: '难以忍受的疼痛也建议及时就医评估，由医生判断原因与处理方式。',
    standalone: [
      '剧痛',
      '剧烈(?:疼痛|腰痛|疼)',
      '疼(?:得|的)(?:受不了|死去活来|直不起腰|直不起身|打滚|撕心裂肺|不得了|要命|冒冷汗|出冷汗|想哭|忍不了)',
      '痛(?:得|的)(?:受不了|死去活来|直不起腰|直不起身|打滚|撕心裂肺|不得了|要命|冒冷汗|出冷汗|想哭|忍不了)',
      '疼得[^。，,;；]{0,4}(?:受不了|忍不了)',
      '痛得[^。，,;；]{0,4}(?:受不了|忍不了)',
      '无法忍受(?:的)?疼',
      '难以忍受(?:的)?疼',
      '疼到(?:哭|出汗|冒冷汗|冷汗|晕|休克|发抖)',
      '痛到(?:哭|出汗|冒冷汗|冷汗|晕|休克|发抖)',
      '疼(?:得|的)睡不着',
    ],
  },
];

/** 判定原始文本是否命中某条红旗规则（供服务与测试复用） */
export function matchesRedFlagRule(rule: RedFlagRule, rawText: string): boolean {
  const text = normalizeSafetyText(rawText);
  if (!text) return false;
  const spans = thirdPartySpans(text);
  // 词汇掩码：把本规则的病症词替换为占位符后再做否定 / 小句判断，
  // 避免「无力」「憋不住」里的「无 / 不」被当成否定词（位置保持不变）
  const masked = maskVocabulary(text, rule);
  const fragments = splitFragments(masked);

  for (const phrase of rule.standalone ?? []) {
    for (const match of findCoreMatches(text, phrase)) {
      if (insideThirdParty(spans, match.start, match.end)) continue;
      const prefix = masked.slice(0, match.start);
      if (STRICT_NEGATION.test(prefix) || STRICT_TRAILING.test(prefix)) continue;
      if (negatedBefore(fragments, masked, match.start)) continue;
      const after = text.slice(match.end, match.end + 8);
      if (NORMAL_AFTER_WORDS.some((w) => after.startsWith(w))) continue;
      return true;
    }
  }

  const subjects = rule.subjects ?? [];
  const symptoms = rule.symptoms ?? [];
  const limit = rule.gap ?? 8;
  for (const subjectSource of subjects) {
    for (const subject of findCoreMatches(text, subjectSource)) {
      if (insideThirdParty(spans, subject.start, subject.end)) continue;
      for (const symptomSource of symptoms) {
        for (const symptom of findCoreMatches(text, symptomSource)) {
          if (insideThirdParty(spans, symptom.start, symptom.end)) continue;
          // 主体与症状可以相接、也可以隔几个字；允许同起点（「尿不出」）与症状在前（「麻木的两条腿」）
          const overlap = Math.min(subject.end, symptom.end) - Math.max(subject.start, symptom.start);
          const forward = symptom.start >= subject.start && symptom.start - subject.end <= limit;
          const backward = subject.start >= symptom.start && subject.start - symptom.end <= limit;
          if (!forward && !backward) continue;
          if (overlap > 0 && overlap < Math.min(subject.end - subject.start, symptom.end - symptom.start)) {
            continue; // 只重叠了一部分：可能是「大小便」里的「小便」，跳过
          }
          const first = symptom.start <= subject.start ? symptom : subject;
          const second = first === subject ? symptom : subject;
          if (negatedBefore(fragments, masked, first.start)) continue;
          if (locallyNegated(text, first, second)) continue;
          return true;
        }
      }
    }
  }
  return false;
}

/** 把某条规则的病症词替换为占位符（长度不变，位置保持一致） */
function maskVocabulary(text: string, rule: RedFlagRule): string {
  const ranges: [number, number][] = [];
  for (const phrase of [...(rule.standalone ?? []), ...(rule.subjects ?? []), ...(rule.symptoms ?? [])]) {
    for (const match of findCoreMatches(text, phrase)) ranges.push([match.start, match.end]);
  }
  ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: [number, number][] = [];
  for (const [start, end] of ranges) {
    const last = merged[merged.length - 1];
    // 重叠或首尾相接的片段合并（「尿」+「不出来」=「尿不出来」整段掩码）
    if (last && start <= last[1] + 1) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  const chars = [...text];
  for (const [start, end] of merged) {
    for (let i = start; i < end; i += 1) chars[i] = '\uFF0F';
  }
  return chars.join('');
}

function fragmentOf(fragments: Fragment[], at: number): Fragment | undefined {
  return fragments.find((f) => at >= f.start && at < f.end);
}

/** 取命中片段的原文上下文（用于前端高亮与说明） */
export function redFlagExcerpt(rule: RedFlagRule, rawText: string): string {
  const text = normalizeSafetyText(rawText);
  const candidates: string[] = [...(rule.standalone ?? []), ...(rule.subjects ?? []), ...(rule.symptoms ?? [])];
  for (const core of candidates) {
    const match = findCoreMatches(text, core)[0];
    if (match) {
      const start = Math.max(0, match.start - 6);
      return rawText.slice(start, Math.min(rawText.length, start + match.text.length + 14));
    }
  }
  return rawText.slice(0, 40);
}

export type ScopeCategory = '诊断' | '手术' | '用药' | '治疗' | '预后';

export interface ScopeRule {
  code: string;
  category: ScopeCategory;
  /** 明确不答的标准回复（不作诊断、不给建议） */
  reply: string;
  /** 转为复诊问题 */
  followup_question: string;
  /** 核心短语（同样支持否定识别，否定说法不判越界） */
  phrases: string[];
  /** 是否识别否定说法（默认不识别：越界判定宁可多拦，也不要漏拦） */
  negationAware?: boolean;
}

export const OUT_OF_SCOPE_RULES: ScopeRule[] = [
  {
    code: 'OOS-01',
    category: '诊断',
    reply: '我不能判断这是什么病，也不能确认严重程度。这需要医生结合查体、影像和病史判断。',
    followup_question: '请医生结合查体和影像，确认我的情况属于什么诊断',
    phrases: [
      '是不是(?:腰|腰椎|椎间盘)?(?:间盘)?(?:突出|膨出|脱出)',
      '是否是(?:腰|腰椎|椎间盘)?(?:间盘)?(?:突出|膨出|脱出)',
      '会不会是(?:腰|腰椎|椎间盘)?(?:间盘)?(?:突出|膨出|脱出)',
      '是不是很严重',
      '我是不是(?:腰|腰椎|椎间盘)',
      '是(?:什|啥)么(?:病|症|毛病|情况)',
      '是哪(?:一)?种(?:病|症|毛病)',
      '什么毛病',
      '确诊',
      '能不能(?:判断|看出|测出|断定|确认)',
      '严重吗',
      '严不严重',
      '算严(?:不)?重',
      '能治好吗',
      '会不会(?:恶化|变严重|严重)',
      '恶化吗',
      '(?:判断|评估)一下',
      '属于什么',
      '我这是(?:什么|啥)',
      '坐骨神经(?:痛|痛吗)',
      '算(?:不)?算坐骨神经痛',
      '椎管狭窄',
      '腰椎滑脱',
      '强直性脊柱炎',
      '腰肌劳损(?:还是|或者|或者是|或)',
      '(?:突出|膨出|滑脱|劳损|骨折|狭窄)(?:还是|或者|或者是|或)(?:突出|膨出|滑脱|劳损|骨折|狭窄)',
      '是(?:劳损|肌肉拉伤|筋膜炎|扭伤)(?:还是|或者|或者是|或)',
      '是(?:不)?是(?:骨|骨头|骨头出)?问题',
      '什么引起的',
    ],
  },
  {
    code: 'OOS-02',
    category: '手术',
    reply: '是否需要手术要由医生评估，我不能给出手术建议。',
    followup_question: '请医生评估我的情况是否需要手术或其他治疗',
    phrases: [
      '要不要手术',
      '需(?:不)?要(?:做)?手术',
      '(?:能|能不|可以)手术',
      '手术(?:方案|时机|指征)',
      '微创',
      '开刀',
      '融合术',
      '消融',
      '椎间孔镜',
      '打钢(?:板|钉)',
      '牵引(?:能治|能好)',
      '要不要做',
    ],
  },
  {
    code: 'OOS-03',
    category: '用药',
    reply: '我不能提供用药或剂量建议，请咨询医生或药师。',
    followup_question: '请医生确认我正在使用的药物是否适合当前情况',
    phrases: [
      '吃(?:什|啥)么药',
      '用(?:什|啥)么药',
      '吃(?:哪|那)种药',
      '贴(?:什|啥)么药',
      '贴哪种',
      '布洛芬',
      '塞来昔布',
      '双氯芬',
      '阿司匹林',
      '甲钴胺',
      '止疼药',
      '止痛药',
      '封闭针',
      '打封闭',
      '用药',
      '(?:剂|用)量',
      '一天吃(?:一|两|三|几)(?:次|片)?',
      '吃(?:一|两|三|几)片',
      '停药',
      '(?:吃|用|打)(?:药|针)',
      '外用',
      '涂抹',
      '喷剂',
      '药膏',
      '药贴',
    ],
  },
  {
    code: 'OOS-05',
    category: '治疗',
    reply:
      '我不能推荐具体治疗方法（含外用、理疗、康复动作与器械）。治疗选择要由医生结合检查结果判断，请把想了解的治疗方式写进复诊问题。',
    followup_question: '请医生评估我当前适合哪些治疗或康复方式',
    phrases: [
      '贴膏药',
      '膏药',
      '敷(?:贴|中药)',
      '外敷',
      '热敷(?:有用|能好|行吗)',
      '推拿(?:有用|能好|行吗)',
      '正骨',
      '复位',
      '针灸',
      '拔罐',
      '理疗',
      '按摩(?:有用|能好|行吗)',
      '锻炼什么',
      '做什么运动',
      '做哪些动作',
      '康复训练',
      '牵引',
      '小燕飞',
      '臀桥',
      '游泳(?:有用|能好|行吗)',
      '腰围',
      '护腰',
      '床垫',
    ],
  },
  {
    code: 'OOS-04',
    category: '预后',
    reply:
      '我没法预测以后会怎样，也不会说“肯定没事”或“一定会严重”。要不要紧、会不会变化，需要医生结合查体和影像随访判断。',
    followup_question: '请医生评估我的情况后续大致会如何变化，需要注意什么',
    negationAware: false,
    phrases: [
      '瘫痪',
      '会残留',
      '一辈子(?:治不好|好不了)',
      '以后(?:能|能不|能不能)好',
      '多久能好',
      '多久(?:能|可以)?(?:康复|恢复)',
      '几天能好',
      '几个星期能好',
      '会不会复发',
      '会不会(?:越来越|越来)越(?:严|重)',
      '会不会(?:越来越|越来)越(?:厉|差)',
      '要多久',
      '多久才会好',
      '会好吗',
      '能不能好',
      '预后',
      '是不是没什么大事',
      '问题大吗',
      '问题不大吧',
    ],
  },
];

/** 判定问题是否属于某一类越界（供服务与测试复用） */
export function matchesScopeRule(rule: ScopeRule, question: string): boolean {
  const text = normalizeSafetyText(question);
  if (!text) return false;
  if (rule.negationAware === true) {
    return rule.phrases.some((core) => findCoreMatches(text, core).length > 0);
  }
  return rule.phrases.some((core) => findCoreMatches(text, core).length > 0);
}

/** 判定文本是否属于「求保证」类提问（连续达到阈值即结束本轮） */
export const REASSURANCE_PATTERNS: string[] = [
  '保证',
  '肯定',
  '一定',
  '百分百',
  '100%',
  '没事',
  '没事儿',
  '没什么大事',
  '没什么事',
  '没什么大不了',
  '不是大事',
  '没多大事',
  '大问题',
  '小毛病',
  '不要紧',
  '问题不大',
  '不会有事',
  '我心里踏实',
  '放心',
  '应该没事',
  '不用管它',
];

/** 同一会话内连续求保证达到该次数 → 给出稳定解释并结束本轮 */
export const REASSURANCE_STREAK = 3;

/** 结束本轮时的固定回复（文案稳定，不做个性化，提示以医生评估为准） */
export const REASSURANCE_REPLY =
  '我能理解你希望听一句“肯定没事”。但要不要紧、会不会好，只有医生结合查体、影像和病史才能判断，我没法给你保证，也不会说“肯定没事”。把你的担心写进复诊问题清单，复诊时请医生评估，以医生的评估为准。';

/** 判断一条用户提问是否为「求保证」类问题 */
export function isReassurance(question: string): boolean {
  const text = normalizeSafetyText(question);
  return REASSURANCE_PATTERNS.some((p) => text.includes(p));
}

/** 预后类越界规则（「会不会瘫痪」这类求助也要走求保证循环） */
const PROGNOSIS_RULE = OUT_OF_SCOPE_RULES.find((r) => r.category === '预后');

/**
 * 是否属于「求保证循环」提问：求保证类说法，或预后类求助。
 * 同一会话内连续达到阈值 → 给出稳定解释并结束本轮（不进个性化回答）。
 */
export function isWorryLoop(question: string): boolean {
  return isReassurance(question) || (PROGNOSIS_RULE ? matchesScopeRule(PROGNOSIS_RULE, question) : false);
}
