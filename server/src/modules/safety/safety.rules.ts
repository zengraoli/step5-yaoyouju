/**
 * 安全规则集（临床审定规则，演示实现）。
 * - 红旗规则 RF-xx：命中即提示就医；high 级同时停止个性化分析（R03）。
 * - 服务范围规则 OOS-xx：诊断 / 手术 / 用药 / 治疗 / 预后越界，明确不答，转为复诊问题。
 * 规则集带版本号，变更需递增版本并记录（B07 规则集版本）。
 *
 * 匹配策略（第六轮验收反馈：常见腰腿痛描述被误判为「双腿进行性无力」，
 * 同时约三分之一应触发说法漏判，另有梦境 / 手机电量 / 新闻转述等误判）：
 * 1. 文本先归一化：全角→半角、去掉空白、统一标点，提升口语 / 错别字文本的命中率；
 * 2. 红旗规则用「部位 / 主体 × 症状」组合匹配（而不是穷举整句）：
 *    - `subjects`（会阴、鞍区、屁股中间、双腿、大小便、癌…）；
 *    - `symptoms`（麻木、没感觉、失禁、憋不住、兜不住…）；
 *    - 主体与症状可以同时出现在同一小句里（默认距离 ≤ 8 字），允许症状在前；
 *    - **距离之间不能跨标点**（「放射痛越来越重，从屁股一直到脚踝」不再算同一短语）；
 * 3. 重度症状（`symptoms`：无力、站不起来、失禁…）单独出现即命中；
 *    轻度症状（`mild_symptoms`：没劲、发软、乏力…）必须与进行性标记同时出现，
 *    避免「走路多了腿没劲」「手机电量越来越没劲」这类日常说法被判成进行性无力；
 * 4. `standalone` 短语（发烧、夜间痛醒、摔了一跤…）不依赖主体；
 *    `near` 要求短语附近必须出现相应主体（「手机电量越来越没劲」因此不再命中）；
 * 5. 否定识别（三层）：小句级、间隙级、后随级；
 * 6. 上下文豁免（梦境 / 刻意减肥 / 新闻转述 / 他人叙述 / 短暂性麻木）在
 *    standalone 与「主体×症状」两条路径上都生效，且**豁免词本身被否定时不生效**
 *    （「没减肥体重却掉了七八公斤」「梦见自己尿裤子」都能正确判定）；
 * 7. 第三方叙述：小句以「我孩子 / 我老婆 / 弟弟…」等他人称谓开头，且叙述到「我自己」之前，
 *    该范围内的症状不算使用者本人的症状。
 */

export const RULE_SET_VERSION = 'safety-rules-v5.0';

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
  '未曾',
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
const NOT_NEGATION_PHRASES = ['不小心', '不留神', '不知不觉', '无心', '无碍', '无聊', '尿不干净', '便不干净', '不干净'];

/**
 * 「后随上下文」否定：这些词出现在症状之后时，说的是别的原因或没事
 * （「瘦了四五斤，我在刻意减肥」「低烧，医生说是感冒」「体重轻了一点，胃口很好」）。
 */
const AFTER_CONTEXT_WORDS = ['感冒', '刻意减肥', '在减肥', '在减重', '胃口很好', '胃口好'];

/**
 * 「之前的上下文」豁免（出现在短语之前）：说的是梦、刻意减肥、他人 / 物体 / 新闻转述，
 * 不算本人红旗。检查命中位置之前约 12 个字符。
 */
export const BEFORE_CONTEXT_EXCLUDE = [
  '梦见', '梦到', '做梦', '梦里', '梦见了', '晚上梦', '昨天梦',
  '刻意减肥', '在减肥', '主动减肥', '减肥减', '节食', '为了体检', '为了减肥', '想减肥', '控制体重', '减重', '瘦身', '减脂',
  '健身', '运动', '锻炼', '跑步', '游泳', '打球',
  '新闻', '电视', '网上', '听说', '看到', '视频', '文章', '科普', '搜索', '百度', '想知道', '想了解', '想问',
  '朋友', '网友', '邻居', '同事', '亲戚', '别人', '有人', '病人', '患者',];
/** 「之后上下文」豁免（出现在短语之后）：说的是别的原因 / 已经解释 / 没事 / 短暂性 */
export const AFTER_CONTEXT_EXCLUDE = [
  '感冒', '刻意减肥', '在减肥', '在减重', '胃口很好', '胃口好',
  '是减肥', '减肥成功', '一直在减', '一直很稳定', '一直稳定', '现在很稳定', '现在稳定', '稳定了',
  '人没事', '人没有事', '没伤到人',
  '走两步', '下车', '活动一下', '起身活动', '站起来', '过一会', '一会儿', '缓过来', '就好了', '就好',
];

/** 症状之后紧跟「尚未确认 / 未确认」：用户明确表示还没有确认（不当作症状） */
const UNCONFIRMED_AFTER = /^[：:，,]?(?:尚未|未|还未)确认/;

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

/** 第三方称谓（叙述他人情况）：如「我老婆」「孩子」「弟弟…」（不含父母：转述父母病情同样是病情） */
const THIRD_PARTY_SUBJECT_SOURCE =
  '我?(?:孩子|宝宝|小孩|儿子|女儿|闺女|老婆|老公|妻子|丈夫|弟弟|妹妹|哥哥|姐姐|家人|老人|老伴|同事|室友|邻居|同学|病人|患者)';

/** 第三方叙述的结束标记（遇到这些词说明叙述回到使用者本人） */
const THIRD_PARTY_STOP_TOKENS = ['我自己', '但是', '但', '可是', '不过', '然而', '而是', '却', '也', '还', '反而', '反倒', '同房', '做爱', '性生活', '行房'];

/** 第三方叙述最大长度（避免把本人的症状也吞掉） */
const THIRD_PARTY_MAX_SPAN = 18;

/** 小句分隔符（距离计算时不能跨越） */
const PUNCT = /[，,。；;！!？?\n]/;

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

/** 进行性标记（轻度症状必须与其中之一同时出现，才算「进行性」） */
export const PROGRESS_MARKERS = [
  '越来越',
  '越来',
  '逐渐',
  '一天天',
  '一天比一天',
  '进行性',
  '加重',
  '加重了',
  '更明显',
  '更厉害',
  '更差',
  '更重',
  '更严',
  '比之前',
  '比以前',
  '比上周',
  '比前些天',
  '比前段时间',
  '比原先',
  '比原来',
  '比以前差',
];

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
 * 上下文豁免判定（否定感知）：
 * 命中位置之前 / 之后的窗口里出现豁免词 → 不算红旗；
 * 但豁免词自身被否定时（「没减肥」「不是在减肥」）豁免不生效。
 */
function contextExcluded(
  text: string,
  matchStart: number,
  matchEnd: number,
  words: string[],
  direction: 'before' | 'after',
): boolean {
  if (words.length === 0) return false;
  const win =
    direction === 'before'
      ? text.slice(Math.max(0, matchStart - 12), matchStart)
      : text.slice(matchEnd, matchEnd + 14);
  for (const word of words) {
    let idx = win.indexOf(word);
    while (idx !== -1) {
      // 豁免词前面的修饰词（刻意 / 主动 / 一直在…）剥掉后再看是否被否定
      const raw = win.slice(Math.max(0, idx - 8), idx).replace(/(?:刻意|主动|一直|在|为了|想|要|地)+$/, '');
      const negated = NEGATION_WORDS.some((n) => raw.endsWith(n));
      if (!negated) return true;
      idx = win.indexOf(word, idx + 1);
    }
  }
  return false;
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
  // 主体与症状之间的否定 = 否定整个短语（「无进行性无力」「没有明显麻木」）。
  // 「不受控制」「不由自主」里的「不」说的是控制失灵，不是否定症状。
  const gapBody = gap.replace(
    /不受控制|不能自制|难以控制|无法自制|控制不住|[尿便屎屁]不干净|不干净|不知不觉|不小心|无意/g,
    '',
  );
  if (gapBody && NEGATION_WORDS.some((w) => gapBody.includes(w))) return true;
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
  /** 症状表达（与主体组合出现时命中；重度症状单独出现即命中） */
  symptoms?: string[];
  /** 轻度症状表达：必须与进行性标记同时出现才命中 */
  mild_symptoms?: string[];
  /** 主体与症状之间的最大间隔字数（默认 8） */
  gap?: number;
  /** 不依赖主体的独立短语（如「发烧」「摔了一跤」） */
  standalone?: string[];
  /** 独立短语要求附近（之前 12 字内）出现这些主体，否则不算命中 */
  near?: string[];
  /** 命中之前的上下文豁免词（梦境 / 刻意减肥 / 新闻转述 / 他人 / 物体） */
  before_exclude?: string[];
  /** 命中之后的上下文豁免词（已解释 / 人没事 / 短暂性麻木） */
  after_exclude?: string[];
  /** 命中短语之后紧跟的单个字（出现即不命中，如「发烧友」的「友」） */
  after_char_exclude?: string[];
  /** 第一人称自我否认短语（小句出现即判否，温度锚定除外，如「我没有发烧」） */
  deny_self?: string[];
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
  '外阴',
  '阴户',
  '下阴',
  '马鞍区',
  '马安区',
  '安骑区',
  '鞍区',
  '屁股(?:中间|正中|沟|沟那一带|底下|下面|眼|根|蛋)?',
  '臀部',
  '臀区',
  '下身(?:一点|有些)?',
  '下半身',
  '下面(?:一点|有些)?',
  '底下',
  '下体',
  '私处',
  '私密处',
  '私密部位',
  '生殖器',
  '阴部(?:周围|一带)?',
  '肛门(?:周围|边缘|附近)?',
  '肛周',
  '裆部',
  '胯下',
  '会阴部位',
  '大腿根(?:部)?',
  '大腿内侧',
  '阴囊',
  '屁眼',
  '私处一带',
  '蛋蛋',
  '菊花',
  '睾丸',
  '坐垫下',
  '会阴',
  '腰以下',
  '半侧屁股',
];

/** 感觉异常表达 */
const NUMBNESS_SYMPTOMS = [
  '麻木',
  '发麻',
  '发木',
  '木木的',
  '麻麻的',
  '木的',
  '木了',
  '全木',
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
  '像隔了[层块快][布纸]?',
  '隔了层[布纸]',
  '像隔[层块][布纸]',
  '像隔了层东西',
  '隔着一层',
  '像被[^。，,;；]{0,4}(?:麻|木)',
  '不敏感',
  '麻',
  '木',
  '麻得厉害',
  '木得厉害',
  '像隔着',
  '没知觉',
  '接触[^。，,;；]{0,4}没',
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
  '腿肚子',
  '膝盖',
  '脚踝',
  '脚尖',
  '脚趾',
  '脚后跟',
  '腿',
  '脚',
  '腰以下',
  '肌力',
  '腿肌',
];

/** 独立短语要求附近出现的下肢主体 */
const LEG_NEAR = [
  '双腿',
  '两条腿',
  '双退',
  '双下肢',
  '下肢',
  '腿部',
  '左腿',
  '右腿',
  '左下肢',
  '右下肢',
  '左退',
  '右退',
  '大腿',
  '小腿',
  '膝盖',
  '脚踝',
  '脚尖',
  '脚趾',
  '脚后跟',
  '双脚',
  '腿',
  '脚',
  '肌力',
  '走路',
  '行走',
  '迈步',
];

/** 重度下肢无力：单独出现即命中（临床意义上的显著无力） */
const LEG_WEAKNESS_SEVERE = [
  '无力',
  '没力气',
  '抬不起',
  '抬不起来',
  '抬不动',
  '翘不起',
  '翘不起来',
  '勾不起',
  '勾不起来',
  '勾不住',
  '勾不上',
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
  '肌肉萎缩',
  '蹲下起不来',
  '蹲下站不起',
  '要跪',
  '跪下去',
  '跪地',
  '踮不起',
  '踮不起来',
  '扶墙',
  '扶着扶手',
  '拽着扶手',
  '扶栏杆',
  '要人扶',
  '手脚并用',
  '发软打弯',
  '打弯发软',
  '上不了楼',
  '爬不了楼',
  '上不去楼',
  '上不了台阶',
  '不听使唤',
  '不听了使唤',
  '灌了铅',
  '像绑了沙袋',
  '肌力.{0,4}(?:掉到|降到|下降|减弱|变差)',
  '[0-9０-９]级掉到[0-9０-９]级',
  '迈不开步',
  '迈不开步子',
  '抬不起脚',
  '脚抬不起来',
];

/** 轻度下肢无力：必须与进行性标记同时出现 */
const LEG_WEAKNESS_MILD = [
  '没劲',
  '没力',
  '使不上劲',
  '使不上力气',
  '使不上',
  '发软',
  '发软走',
  '乏力',
  '不利索',
  '不利落',
  '越来越沉',
  '费劲',
  '力气(?:变小|变小了|变差|下降|减弱|越来越小)',
  '力量(?:越来越|逐渐|一天天)?(?:下降|减弱|变小|变差|差|弱)',
  '越来越软',
  '越来越没劲',
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
  '两便',
  '排便排尿',
  '大便',
  '小便',
  '便便',
  '尿尿',
  '排尿',
  '排便',
  '解手',
  '大号',
  '小号',
  '屙',
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
  '管不住',
  '控不住',
  '憋不住',
  '忍不住',
  '憋不了',
  '控制(?:困难|不住|不了|不良|障碍|失灵|不行|异常|有问题|不正常)',
  '变化',
  '不能控制',
  '无法控制',
  '不受控制',
  '不由自主',
  '不自主',
  '拉在身上',
  '在裤[子兜][里中上]',
  '拉裤[子裆兜]里',
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
  '便意(?:消失|丧失|淡漠|没了|减退)',
  '尿意(?:消失|减弱|没了|丧失|淡漠|减退)',
  '尿线[^。，,;；]{0,6}(?:变细|费劲|很细|没劲)',
  '(?:尿|小便|尿线)[^。，,;；]{0,4}(?:越来越)?细',
  '使劲才能尿',
  '费劲才能尿',
  '便秘[^。，,;；]{0,4}(?:加重|严重|厉害)',
  '排尿(?:困难|障碍)',
  '排便(?:困难|障碍)',
  '功能障碍',
  '障碍',
  '流出来',
  '尿湿',
  '用力[^。，,;；]{0,6}(?:才能|才)(?:尿|排便|解)',
  '干燥[^。，,;；]{0,4}(?:加重|严重|厉害)',
  '感觉不到[尿便排]',
  '[尿便排][^。，,;；]{0,4}没(?:有)?感觉',
  '使劲[^。，,;；]{0,8}(?:才)?(?:能)?尿',
  '按着肚子.{0,4}(?:才)?(?:能)?尿',
  '才尿得出',
  '自己流',
  '不自主地?流',
  '尿到裤子',
  '尿湿了裤子',
  '漏便',
  '遗尿',
  '尿[^。，,;；]{0,3}没(?:排|尿|解)出',
  '尿[^。，,;；]{0,2}(?:排|尿|解)不完',
  '没(?:排|尿|解)出[尿便]',
  '[^。，,;；]{0,3}肚[子小腹]鼓',
  '一天多?没.{0,1}(?:小便|尿|排便)',
  '[0-9一二两三四五六七八九十]{1,3}(?:天|日)[^。，,;；]{0,4}(?:没|未|不)[^。，,;；]{0,2}(?:小便|尿|排便|大便|解手)',
  '[尿便][^。，,;；]{0,3}自己[往外背后]?[流渗溢]',
  '垫(?:纸尿裤|尿不湿|尿片)',
  '使劲[^。，,;；]{0,4}(?:压|按)',
  '尿[滴滴嗒嗒]+',
  '[滑渗漏]出来',
  '(?:尿|解|排|便)[^。，,;；]{0,2}不完',
  '一滴一滴',
  '一(?:滴|點)滴[往外挤]',
  '蹲[半一两几0-9]{1,3}(?:天|小时|分钟|钟头)[^。，,;；]{0,6}(?:尿|排|解)不出',
  '察觉不到',
  '没(?:有)?察觉',
  '不(?:知道|清楚)',
  '擦不干净',
];

/**
 * 红旗规则集 v5：
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
    standalone: [
      '坐垫[^。，,;；]{0,16}(?:麻|木|没感觉|没知觉|知觉都没|无知觉)',
      '一点(?:知觉|感觉)都没(?:有|了)',
      '压着(?:的那块|那块|的地方)?[^。，,;；]{0,10}(?:没知觉|没感觉|发麻|发木|麻木)',
      '会阴[^。，,;；]{0,6}(?:骑马|骑车|久坐).{0,8}(?:麻|木)',
      '马桶圈[^。，,;；]{0,10}(?:没|无)[感觉知觉]',
      '屁股[^。，,;；]{0,8}(?:像)?隔[着了]?[层块快]?[布纸]',
      '屁股[^。，,;；]{0,8}没(?:有)?感觉',
      '(?:像|好像)?贴[着了]?[层块][^。，,;；]{0,6}(?:布|纸|塑料|膜)[^。，,;；]{0,8}(?:没|无)[感觉知觉]',
      '摸上去没(?:有)?感觉',
      '摸着没(?:有)?感觉',
      '像隔着[^。，,;；]{0,4}(?:布|纸|衣服|裤子)',
    ],
    after_exclude: [
      '走两步', '下车', '活动一下', '起身活动', '站起来', '过一会', '一会儿', '缓过来', '就好了', '就好',
      '泡', '捶', '按摩', '保暖', '热敷',
    ],
  },
  {
    code: 'RF-02',
    label: '双腿进行性无力',
    severity: 'high',
    action: '停止个性化分析',
    advice: '下肢无力如果在加重，需要尽快由医生评估，请前往医院就诊。',
    subjects: LEG_SUBJECTS,
    symptoms: LEG_WEAKNESS_SEVERE,
    mild_symptoms: LEG_WEAKNESS_MILD,
    gap: 8,
    standalone: [
      '腿软',
      '走[0-9一二三四五六七八九十百]{1,6}米[^。，,;；]{0,6}(?:歇|停)',
      '扶墙',
      '手脚并用',
      '走路[^。，,;；]{0,4}(?:越来越)?费劲',
      '肌力(?:4|四)级',
      '(?:肌力|双下肢肌力)[^。，,;；]{0,4}比[^。，,;；]{0,6}(?:又|更)?差',
      '肌力(?:进行性|逐渐|越来越)?(?:下降|减弱|变差)',
      '(?:双|左|右)腿(?:麻木|发麻)(?:无力|没劲)',
      '走路[^。，,;；]{0,6}(?:越来越)?费劲',
      '踮不起',
      '踮不起来',
      '跪下去',
      '站一会儿就要跪',
      '两条腿越来越软',
      '双腿越来越软',
      '越来越没(?:劲|力气)',
      '下肢乏力(?:逐渐)?加重',
      '越来越乏力',
      '肌力[^。，,;；]{0,6}(?:掉到|掉到|降到|下降|减弱)[^。，,;；]{0,2}[0-9０-９]',
      '[0-9０-９]级掉到[0-9０-９]级',
      '(?:麻木|发麻|麻)[^。，,;；]{0,10}(?:上爬|往上爬|往上|一路|蔓延|扩展|延伸)',
      '[脚尖脚趾][^。，,;；]{0,2}(?:翘|勾|抬)不',
      '用脚后跟走路[^。，,;；]{0,4}(?:做不到|做不了|不行)',
      '脚后跟[^。，,;；]{0,6}(?:走不了|站不起来|做不到|做不了)',
      '腿[^。，,;；]{0,4}(?:一天天|一天比一天|越来越)[^。，,;；]{0,4}(?:差|软|没劲|变小)',
    ],
    near: LEG_NEAR,
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
      '咳嗽[^。，,;；]{0,6}(?:漏尿|漏|湿|裤子)',
      '控制[困容]?难[或]?失禁',
      '大小便[^。，,;；]{0,6}(?:失禁|失控|管不住|控不住|不受控制)',
      '尿裤子',
      '憋不住(?:尿|大便|便|屎尿)',
      '屎尿都(?:兜不住|憋不住|管不住)',
      '尿湿',
      '流出来',
      '排便要[^。，,;；]{0,4}(?:很大力|用力|费劲|使劲)',
      '大便干燥[^。，,;；]{0,6}(?:加重|严重|厉害)',
      '遗尿',
      '漏便',
      '漏屎',
      '肛门[^。，,;；]{0,4}(?:松|漏|失禁|憋不住|管不住)',
      '拉在裤子',
      '尿在裤子',
      '屎尿?在裤子',
      '拉(?:在|到)?裤[子裆兜]里',
      '膀胱[^。，,;；]{0,4}(?:憋|胀|涨|疼|痛|难受|不舒服|鼓)',
      '(?:小腹|小肚子|下腹|肚子)[^。，,;；]{0,4}(?:憋|胀|涨|坠|疼|痛|硬|鼓)',
      '一滴(?:都)?[^。，,;；]{0,2}(?:出|尿|排)不来',
      '蹲[半一两几0-9]{1,3}(?:天|小时|分钟|钟头)[^。，,;；]{0,8}(?:尿|排|解|一滴)',
      '一(?:整天|天一夜|昼夜|整天整夜)?[没无][^。，,;；]{0,3}(?:小便|尿|排便|大便)',
      '憋了(?:一整天|一天一夜|一晚上|半天)',
      '穿纸尿裤',
      '排尿[^。，,;；]{0,3}费劲',
      '撒不出',
      '尿[^。，,;；]{0,2}憋[^。，,;；]{0,2}憋不住',
      '放屁[^。，,;；]{0,4}(?:兜不住|憋不住|管不住|控制不住|失禁|带)',
      '[屁便屎尿][^。，,;；]{0,4}带(?:了)?出[来东西]',
      '裤[衩子裆兜][^。，,;；]{0,6}(?:湿|屎|尿|黄)',
      '(?:什么|啥)时候[^。，,;；]{0,6}尿[^。，,;；]{0,8}(?:不|没|都)(?:知道|清楚|察觉|感觉到)',
      '尿[^。，,;；]{0,6}(?:自己|都)?(?:不|没)(?:知道|清楚|察觉|感觉到)',
      '低头看[^。，,;；]{0,6}才知道',
      '来不及(?:跑|去|上)厕所',
      '大号[^。，,;；]{0,4}(?:憋不住|控不住|管不住|忍不住|来不及)',
      '两便[^。，,;；]{0,4}(?:都)?(?:管|控|兜|憋)不住',
      '屙(?:尿|屎|不出|不出来|不不出)',
      '尿(?:完|过)[^。，,;；]{0,6}(?:觉得)?没(?:有)?(?:尿|排|解)完',
      '一滴一滴[往外挤]',
      '蹲[半一两几0-9]{1,3}(?:天|小时|分钟|钟头)[^。，,;；]{0,6}(?:尿|排|解)不出',
      '尿意[^。，,;；]{0,3}(?:很|有点|有些)?(?:弱|差|没|无|消失|丧失|减退|淡漠)',
      '便意[^。，,;；]{0,3}(?:很|有点|有些)?(?:弱|差|没|无|消失|丧失|减退|淡漠)',
      '垫(?:着|了)?(?:纸尿裤|尿不湿|尿片)',
      '滴滴答答',
      '一次就几滴',
      '(?:大便|小便|尿|排便|解手|屎)[^。，,;；]{0,6}(?:使劲|用力|费劲|挣|憋)[^。，,;；]{0,4}(?:才|才能|才行)?',
      '(?:用手)?按着肚子[^。，,;；]{0,4}(?:才)?(?:能|行)',
      '要使[^。，,;；]{0,4}(?:很|好)?(?:大)?劲',
      '用手抠',
      '要(?:用|垫|穿)(?:纸尿裤|尿不湿|尿片|护垫)',
      '闻到味',
      '解(?:不|解不)出(?:来)?',
    ],
    deny_self: ['我说没有', '回答没有', '说没有', '并无大小便'],
    after_exclude: ['喝水', '多喝水', '后好了', '就缓解', '便通畅', '后来就好了'],
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
      '后半夜(?:疼|痛|醒)',
      '夜里比白天(?:还|更)(?:痛|疼)',
      '夜间比白天(?:还|更)(?:痛|疼)',
      '静息痛',
      '休息(?:时|的)?也(?:痛|疼)',
      '躺下[^。，,;；]{0,6}(?:更痛|更疼|加重|更厉害)',
      '[^。，,;；]{0,6}翻不了身',
      '盗汗',
      '(?:夜里|晚上|夜间)[^。，,;；]{0,6}(?:更痛|更疼|厉害|加重)',
      '(?:夜里|晚上|夜间)一躺下[^。，,;；]{0,6}(?:痛|疼)',
      '(?:夜里|晚上|夜间)只能睡[0-9一二两三四五六七八九十]{1,3}(?:个)?小时',
      '夜间痛',
      '夜里痛',
      '夜里一直(?:痛|疼)',
      '晚上一直(?:痛|疼)',
      '疼(?:得|的)睡不着',
      '痛(?:得|的)睡不着',
      '翻身都难',
      '翻身困难',
      '翻不了身',
      '休息(?:也|后)?(?:不|没|难以)(?:缓解|改善)',
      '休息也不缓解',
      '只能坐着',
      '根本(?:没法|不能)躺下',
      '没法躺下',
      '躺不下来',
      '整夜都只能坐着',
      '靠坐[^。，,;；]{0,4}(?:一晚|一夜|睡觉)',
      '只能[^。，,;；]{0,4}靠着.{0,2}坐',
      '只能[^。，,;；]{0,4}坐[^。，,;；]{0,4}(?:睡|过夜|一晚|一夜)',
      '躺不[平安]',
      '(?:休息|歇)[^。，,;；]{0,4}(?:不见好|不见轻|不轻反重|也不管用)',
      '(?:夜里|夜间|晚上)[^。，,;；]{0,8}(?:格外|特别|更|越来)(?:凶|厉害|重|痛|疼)',
      '(?:每天|天天)[^。，,;；]{0,6}(?:疼|痛)[^。，,;；]{0,4}醒',
      '睁眼到天亮',
      '(?:晚上|夜里|夜间|后半夜|半夜)[^。，,;；]{0,8}(?:疼|痛)(?:得|的)[^。，,;；]{0,6}(?:坐起来|靠着|靠墙|坐一会)',
      '疼(?:得|的)[^。，,;；]{0,4}半夜醒',
    ],
    before_exclude: ['心', '头'],
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
      '明显瘦',
      '体重(?:明显)?(?:下降|减轻|减少|掉了|掉得|瘦了)',
      '体重(?:(?![没无未否])[^。，,;；]){0,4}(?:掉|降|减|轻|少)',
      '瘦了[^。，,;；]{0,2}圈',
      '掉秤',
      '没(?:节食|减肥)[^。，,;；]{0,6}(?:瘦|轻|掉)',
      '体重瘦(?:了|下来)',
      '半年(?:内|里)?瘦(?:了|下来)',
      '裤子(?:腰围|腰)?[^。，,;；]{0,6}(?:大了|松了|胖了)',
      '[0-9一二两三四五六七八九十]{1,3}个?月[^。，,;；]{0,4}瘦(?:了)?[0-9一二两三四五六七八九十]{1,4}(?:斤|公斤)',
    ],
    before_exclude: ['减肥', '节食', '刻意', '为了体检', '控制体重', '健身', '运动', '锻炼', '减脂', '跑步', '游泳'],
    after_exclude: ['减肥', '节食', '稳定', '成功', '刻意减', '一直在减', '轻松', '开心', '达标', '满意'],
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
      '发热(?!贴|宝宝|器|片|贴贴)',
      '高热',
      '烧到3[89]',
      '体温3[89]',
      '3[89](?:度|℃)',
      '烧不退',
      '反复(?:发烧|发热)',
      '打寒战',
      '畏寒发热',
      '打摆子',
      '打哆嗦',
      '打寒颤',
      '出虚汗',
      '冒虚汗',
      '虚汗',
      '浑身发冷打摆子',
      '三十八度',
      '三十九度',
      '体温[^。，,;；]{0,6}三十[八九]',
      '还有点烧',
      '有点(?:烧|发热|发烧)',
      '夜间盗汗',
      '烧得[^。，,;；]{0,4}(?:迷迷糊糊|糊涂|说胡话|晕|难受|厉害|不行|受不了)',
    ],
    after_char_exclude: ['友'],
    deny_self: ['没有发烧', '没发烧', '不发烧', '没有发热', '没发热', '不发热', '没有烧到', '未发热', '未发烧'],
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
      '做过',
      '手术',
      '切除',
      '术后',
      '手术后',
      '化疗',
      '放疗',
      '治疗过',
      '治疗中',
      '在治疗',
      '治疗',
      '查出',
      '确诊',
      '腰痛',
      '腰疼',
      '腰背痛',
      '背痛',
      '两年',
      '三年',
    ],
    gap: 8,
    standalone: ['肿瘤(?:病|疾)史', '癌症(?:病|疾)史', '既往(?:有)?(?:癌|肿瘤)', '恶性肿瘤史', '(?:癌|瘤|白血病|骨髓瘤)[^。，,;；]{0,8}转移', '可能转移', '腰椎?转移', '骨转移'],
    before_exclude: ['新闻', '网上', '听说', '看到', '视频', '文章', '科普', '搜索', '朋友', '网友', '邻居', '同事', '亲戚', '别人', '有人', '想知道', '想了解', '想问', '是什么', '什么意思', '区别'],
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
      '滑倒',
      '滑了一跤',
      '跌了一跤',
      '撞(?:了|过)?一?下',
      '撞到',
      '车祸',
      '追尾',
      '被车[撞碰]',
      '被[^。，,;；]{0,4}(?:撞|碰|剐|蹭|擦)',
      '脚下一?滑',
      '一屁股坐[在到]?地[上上]',
      '人飞出去',
      '从[^。，,;；]{0,8}(?:摔|跌|掉|滚|滑|跳|溜)(?:下|下来|下去|落)',
      '扭(?:到|伤)?腰',
      '闪(?:到)?腰',
      '搬重物',
      '搬花盆',
      '高处坠落',
      '从(?:床|梯子|楼梯)[^。，,;；]{0,6}(?:摔|跌|掉)',
      `外伤(?:后|之)?[，,]?疼(?:痛)?(?:持续)?${WORSE}`,
      '从[^。，,;；]{0,8}(?:梯|楼|台阶|崖|床)[^。，,;；]{0,4}(?:摔|跌|滚|骨碌|掉)',
      '[摔跌]了一[跤跤斗]',
      '外伤(?:后|之)?腰痛',
      '摔了腰',
      '闪了腰',
      '摔到腰',
      '从楼梯[^。，,;；]{0,4}(?:摔|滚|跌|骨碌)',
      '滚了下去',
      '摔下楼梯',
      '磕在[^。，,;；]{0,4}(?:地|石|台)',
      '骑摩托[^。，,;；]{0,4}(?:摔|撞|磕)',
      '颠(?:了|一下|了几下)',
      '(?:屁股|尾骨|尾巴骨|腰)[^。，,;；]{0,2}着地',
      '从[^。，,;；]{0,4}楼[^。，,;；]{0,4}(?:跳|摔|跌)(?:下|下来|下去)',
    ],
    after_exclude: ['人没事', '人没有事', '没伤到人', '车凹', '小凹', '我没伤', '人没伤'],
    before_exclude: ['梦见', '梦到', '做梦', '梦里', '新闻', '网上', '听说', '看到', '视频', '文章', '朋友', '网友', '邻居', '同事', '亲戚', '别人', '有人'],
  },
  {
    code: 'RF-09',
    label: '足部感觉或行走明显变化',
    severity: 'medium',
    action: '提示就医',
    advice: '足部感觉或行走明显变化建议及时就医评估。',
    subjects: [
      '脚(?:背|底|趾|指头|踝|丫|后跟)?',
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
      '疼(?:得|的)(?:受不了|死去活来|直不起腰|直不起身|打滚|撕心裂肺|不得了|要命|冒冷汗|出冷汗|想哭|忍不了|哭)',
      '痛(?:得|的)(?:受不了|死去活来|直不起腰|直不起身|打滚|撕心裂肺|不得了|要命|冒冷汗|出冷汗|想哭|忍不了|哭)',
      '疼(?:得|的)[^。，,;；]{0,4}(?:受不了|忍不了|冒冷汗|出冷汗|直冒|哭)',
      '痛(?:得|的)[^。，,;；]{0,4}(?:受不了|忍不了|冒冷汗|出冷汗|直冒|哭)',
      '无法忍受(?:的)?疼',
      '难以忍受(?:的)?疼',
      '疼到(?:哭|出汗|冒冷汗|冷汗|晕|休克|发抖)',
      '痛到(?:哭|出汗|冒冷汗|冷汗|晕|休克|发抖)',
      '疼(?:得|的)睡不着',
      '满头大汗',
      '想撞墙',
      '像被[^。，,;；]{0,4}(?:撕|裂|锯|扎)',
      '疼(?:得|的)[^。，,;；]{0,3}打滚',
      '痛(?:得|的)[^。，,;；]{0,3}打滚',
      '疼(?:得|的)[^。，,;；]{0,3}(?:出汗|汗)',
      '钻心',
      '一(?:动|碰)就[^。，,;；]{0,3}(?:钻心|剧痛|疼|痛)',
      '一动[都也]?不敢动',
      '刀割一样',
      '刀割',
      '刀绞',
      '像刀[^。，,;；]{0,2}一样',
      '蜷成(?:一)?团',
      '缩成一团',
      '话都说不出来',
      '话都说不清',
      '叫了救护车',
      '打了120',
      '疼得[^。，,;；]{0,6}(?:直不起|伸不直|弓成)',
      '吗啡',
      '(?:止痛药|止疼药|吗啡|镇痛|止痛片|止疼片|止痛针)[^。，,;；]{0,10}(?:无效|不管用|压不住|止不住|没效果|镇不住|也没用|没用|不顶用|只管)',
      '(?:十分|10分|满分)疼',
      '(?:疼痛|腰疼|腰痛)(?:十分|10分|满分|厉害得)',
      '疼痛评分[0-9０-９]{1,2}分',
      '[6-9０-９]分止痛药',
      '止痛药(?:无效|不管用|止不住|没效果)',
      '痛得[^。，,;；]{0,4}冒冷汗',
      '这辈子(?:最|从来没这么)(?:疼|痛)',
      '最(?:疼|痛)的一次',
      '从来没这么(?:疼|痛)',
      '头一次(?:这么|那么)(?:疼|痛)',
      '怎么[^。，,;；]{0,4}(?:换|变)(?:姿势|体位)[^。，,;；]{0,4}(?:都)?(?:没用|不好|不管用|还是疼|也疼)',
      '疼(?:得|的)[^。，,;；]{0,4}直冒',
      '剧痛难忍',
      '剧烈难忍',
      '难忍',
      '疼得动不了',
      '痛得动不了',
      '动弹不得',
      '疼得[^。，,;；]{0,2}弓[^。，,;；]{0,2}(?:腰|着身)',
      '从来没这么(?:痛|疼)',
      '没这么(?:痛|疼)过',
    ],
    before_exclude: ['心', '头', '牙', '胃', '腹', '脑袋', '偏头'],
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
      // 之前上下文豁免：梦境 / 刻意减肥 / 新闻转述 / 他人 / 物体
      if (contextExcluded(text, match.start, match.end, BEFORE_CONTEXT_EXCLUDE, 'before')) continue;
      if (contextExcluded(text, match.start, match.end, rule.before_exclude ?? [], 'before')) continue;
      // 症状之后跟着「在减肥 / 感冒 / 胃口很好 / 减肥成功 / 人没事」等，说的是别的原因
      if (contextExcluded(text, match.start, match.end, AFTER_CONTEXT_EXCLUDE, 'after')) continue;
      if (contextExcluded(text, match.start, match.end, rule.after_exclude ?? [], 'after')) continue;
      // 「发烧友」「发热贴」：短语之后紧跟的这个字说明说的是别的东西
      const nextChar = text.slice(match.end, match.end + 1);
      if ((rule.after_char_exclude ?? []).includes(nextChar)) continue;
      // 症状后面紧跟「尚未确认 / 未确认」：用户说的是还没确认，不算症状
      if (UNCONFIRMED_AFTER.test(text.slice(match.end))) continue;
      // 第一人称自我否认（「我没有发烧」「我说没有」），向后跨 1~2 个小句查找，
      // 但紧跟温度 / 度数的不算（「发烧到 39」）
      if (rule.deny_self && !temperatureAnchored(text, match.end)) {
        const winStart = startOfFragment(fragments, match.start);
        const winEnd = Math.min(text.length, match.end + 16);
        const frag = text.slice(winStart, winEnd);
        if (rule.deny_self.some((d) => frag.includes(d))) continue;
      }
      // 独立短语要求附近出现相应主体（「手机电量越来越没劲」不是下肢无力）
      if (rule.near && rule.near.length > 0 && !hasNearSubject(text, match.start, rule.near)) continue;
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
  const mildSymptoms = rule.mild_symptoms ?? [];
  const limit = rule.gap ?? 8;
  const progress = [...PROGRESS_MARKERS, ...(rule.mild_symptoms ? [] : [])];
  for (const subjectSource of subjects) {
    for (const subject of findCoreMatches(text, subjectSource)) {
      if (insideThirdParty(spans, subject.start, subject.end)) continue;
      const allSymptoms = [
        ...symptoms.map((s) => ({ source: s, mild: false })),
        ...mildSymptoms.map((s) => ({ source: s, mild: true })),
      ];
      for (const { source: symptomSource, mild } of allSymptoms) {
        for (const symptom of findCoreMatches(text, symptomSource)) {
          if (insideThirdParty(spans, symptom.start, symptom.end)) continue;
          // 主体与症状可以相接、也可以隔几个字；允许同起点（「尿不出」）与症状在前（「麻木的两条腿」）
          const overlap = Math.min(subject.end, symptom.end) - Math.max(subject.start, symptom.start);
          const forward = symptom.start >= subject.start && symptom.start - subject.end <= limit;
          const backward = subject.start >= symptom.start && subject.start - symptom.end <= limit;
          if (!forward && !backward) continue;
          // 主体与症状之间不能跨标点（「放射痛越来越重，从屁股一直到脚踝」不是同一短语）
          const between = text.slice(Math.min(subject.end, symptom.end), Math.max(subject.start, symptom.start));
          if (between && PUNCT.test(between)) continue;
          if (overlap > 0 && overlap < Math.min(subject.end - subject.start, symptom.end - symptom.start)) {
            continue; // 只重叠了一部分：可能是「大小便」里的「小便」，跳过
          }
          const first = symptom.start <= subject.start ? symptom : subject;
          const second = first === subject ? symptom : subject;
          // 轻度症状必须与进行性标记同时出现（「走路多了腿没劲」不是进行性无力）
          if (mild && !hasProgressMarker(text, fragments, first.start, second.end, progress)) continue;
          if (negatedBefore(fragments, masked, first.start)) continue;
          if (locallyNegated(text, first, second)) continue;
          // 症状之后出现第一人称自我否认（「我说没有」「我没有发烧」）→ 判否
          if (rule.deny_self && !temperatureAnchored(text, second.end)) {
            const win = text.slice(second.end, Math.min(text.length, second.end + 16));
            if (rule.deny_self.some((d) => win.includes(d))) continue;
          }
          // 症状紧跟「尚未确认 / 未确认」：尚未确认的项不算症状
          if (UNCONFIRMED_AFTER.test(text.slice(second.end))) continue;
          // 上下文豁免（梦境 / 刻意减肥 / 新闻转述 / 他人叙述 / 短暂性）同样作用于主体×症状路径
          if (contextExcluded(text, first.start, second.end, BEFORE_CONTEXT_EXCLUDE, 'before')) continue;
          if (contextExcluded(text, first.start, second.end, rule.before_exclude ?? [], 'before')) continue;
          if (contextExcluded(text, first.start, second.end, AFTER_CONTEXT_EXCLUDE, 'after')) continue;
          if (contextExcluded(text, first.start, second.end, rule.after_exclude ?? [], 'after')) continue;
          return true;
        }
      }
    }
  }
  return false;
}

/** 轻度症状附近是否存在进行性标记（同一小句内，或紧跟其后的 8 个字内） */
function hasProgressMarker(
  text: string,
  fragments: Fragment[],
  start: number,
  end: number,
  markers: string[],
): boolean {
  const frag = fragmentOf(fragments, start) ?? { start: 0, end: text.length };
  const window = text.slice(Math.max(frag.start, start - 8), Math.min(frag.end, end + 8));
  return markers.some((m) => window.includes(m));
}

/** 短语所在小句内（前后各 12 字）是否出现要求的主体 */
function hasNearSubject(text: string, at: number, sources: string[]): boolean {
  const frag = fragmentOf(splitFragments(text), at);
  const from = Math.max(frag?.start ?? 0, at - 12);
  const to = Math.min(frag?.end ?? text.length, at + 12);
  const scope = text.slice(from, to);
  return sources.some((s) => new RegExp(s).test(scope));
}

/** 把某条规则的病症词替换为占位符（长度不变，位置保持一致） */
function maskVocabulary(text: string, rule: RedFlagRule): string {
  const ranges: [number, number][] = [];
  for (const phrase of [
    ...(rule.standalone ?? []),
    ...(rule.subjects ?? []),
    ...(rule.symptoms ?? []),
    ...(rule.mild_symptoms ?? []),
  ]) {
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

/** 命中位置所在小句的起始边界（找不到则 0） */
function startOfFragment(fragments: Fragment[], at: number): number {
  return fragmentOf(fragments, at)?.start ?? 0;
}

/** 命中位置所在小句的结束边界（找不到则文本末） */
function endOfFragment(fragments: Fragment[], at: number): number {
  const frag = fragmentOf(fragments, at);
  return frag ? frag.end : at + 12;
}

/**
 * 「温度锚定」：短语之后紧跟具体温度/度数（「发烧到 39」「三十八度」）时，
 * 属于确切的发热主诉，自我否认豁免不适用（仍是红旗）。
 */
export function temperatureAnchored(text: string, pos: number): boolean {
  const tail = text.slice(pos, pos + 10);
  return /[0-9０-９]{1,3}\s*(?:度|℃)?|三十[八九]|三[89]度|[0-9]{2}\.5/.test(tail);
}

/** 取命中片段的原文上下文（用于前端高亮与说明） */
export function redFlagExcerpt(rule: RedFlagRule, rawText: string): string {
  const text = normalizeSafetyText(rawText);
  const candidates: string[] = [
    ...(rule.standalone ?? []),
    ...(rule.subjects ?? []),
    ...(rule.symptoms ?? []),
    ...(rule.mild_symptoms ?? []),
  ];
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
      '腰突',
      '算不算.{0,3}(?:突|突出|膨出|脱出)',
      '是不是.{0,3}(?:突出|膨出|脱出)',
      '综合征',
      '(?:是|算|属于|得了).{0,4}(?:梨状肌|肌筋膜|劳损)',
      '梨状肌',
      '(?:腰肌|筋膜|梨状肌).{0,2}(?:还是|或者).{0,4}(?:突出|膨出|劳损)',
      // 第六轮反馈：换一种说法仍应拒答的诊断类提问
      '神经根型',
      '神经根型吗',
      '是不是神经根',
      '(?:l5|ls|s1|l4|l5s1|腰5|腰4)[^。，,;；]{0,4}(?:压迫|受压|突出)',
      '片[子影像][^。，,;；]{0,4}(?:l5|s1|腰5|压迫|突出)',
      '看[^。，,;；]{0,2}(?:片子|影像|ct|核磁|mri)[^。，,;；]{0,6}(?:压迫|突出|脱出|膨出)',
      '有没有可能(?:是|为)',
      '会不会(?:是|因为)',
      '有没有可能[^。，,;；]{0,6}(?:引起|导致|造成)',
      '肾结石',
      '泌尿系结石',
      '是不是[^。，,;；]{0,4}(?:引起|导致)',
      '是什么原因',
      '啥原因',
      '怎么得[上到]?的',
      '要不要紧',
      '要紧吗',
      '问题大(?:不|吗)',
      '严重程[度度]',
      '算不算病',
      '是[^。，,;；]{0,4}(?:引起|导致|造成)的',
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
      '针刀',
      '小针刀',
      '住院',
      '需不需要住院',
      '要不要住院',
      '医生.{0,8}手术',
      '(?:要|需|建议|说|考虑).{0,2}手术',
      '手术.{0,8}(?:怎么|如何|好不好|风险|必要|靠谱|原理|指征)',
      '手术还是',
      '(?:手术|保守|开刀)还是(?:保守|手术|开刀|养)',
      '动(?:刀|手).{0,2}(?:有没有|必要|风险)',
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
      '钙片',
      '钙(?:片|剂|粉)',
      '洛索洛芬',
      '一次.{0,4}(?:吃|用|服用).{0,2}(?:几|多少)(?:粒|片|颗|次|毫克|mg)',
      '(?:几|多少)(?:粒|片|颗)',
      '停掉.{0,4}药',
      '停(?:了)?医生.{0,3}药',
      '不吃(?:药|医生)',
      '(?:想|要|能|可以).{0,2}停(?:药|医生)',
      // 第六轮反馈：换一种说法仍应拒答的用药类提问
      '扶他林',
      '软膏',
      '一天[抹涂]?几[次回]',
      '[抹涂][^。，,;；]{0,2}(?:几次|多少)',
      '乙哌立松',
      '氯唑沙宗',
      '妙纳',
      '泰勒宁',
      '安康信',
      '西乐葆',
      '迈之灵',
      '长期吃',
      '能长期吃',
      '可以长期吃',
      '一直吃',
      '长期(?:用|服)',
      '服药(?:期间|要注意|禁忌)',
      '副作用',
      '过量',
      '重复吃',
      '一起(?:吃|用)',
      '能不能(?:吃|用)[^。，,;；]{0,4}药',
      '吃[^。，,;；]{0,4}药[^。，,;；]{0,4}(?:行|好|可以)',
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
      // 第六轮反馈：换一种说法仍应拒答的治疗类提问
      '卧床休息',
      '卧床[几多两0-9]{1,3}(?:周|天|日)',
      '要[^。，,;；]{0,2}卧床',
      '硬板床',
      '住院',
      '要住院吗',
      '需不需要住院',
      '推拿[^。，,;；]{0,6}(?:按|揉|推)',
      '能不能[^。，,;；]{0,4}(?:按|揉|推|正骨|复位)',
      '把[^。，,;；]{0,4}(?:突出|膨出)[^。，,;；]{0,2}按',
      '按回去',
      '回去',
      '制动',
      '佩戴腰围',
      '拉伸',
      '能不能[^。，,;；]{0,2}锻炼',
      '可以[^。，,;；]{0,2}锻炼',
      '做什么[^。，,;；]{0,2}康复',
      '电疗',
      '超声波',
      '冲击波',
      '艾灸',
      '刮痧',
      '放血',
      '打针[^。，,;；]{0,4}好不好',
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
      '断根吗',
      '能断根吗',
      '断根',
      '恢复上班',
      '(?:什么|多久)(?:时候)?(?:能|可以|才能)(?:恢复|回)?上班',
      '一直(?:这么|这样|腰).{0,3}(?:痛|疼|难受|下去)',
      '这辈子',
      '会不会一直(?:这么|这样|腰|痛|疼|好)',
      '以后.{0,4}一直.{0,2}(?:痛|疼|难受)',
      // 第六轮反馈：换一种说法仍应拒答的预后类提问
      '坐轮椅',
      '瘫[在床上下]',
      '瘫在床上',
      '老了[^。，,;；]{0,4}(?:瘫|残|废)',
      '以后[^。，,;；]{0,4}(?:瘫|残|废)',
      '跑马拉松',
      '半马',
      '全马',
      '能不能[^。，,;；]{0,2}(?:跑|运动|健身|游泳|爬山|旅游|出差|久坐|弯腰|提重物|抱孩子)',
      '还能[^。，,;；]{0,2}(?:正常工作|上班|工作|干活|劳动|运动|跑步|旅游|抱孩子)',
      '工作到退休',
      '正常工作[^。，,;；]{0,4}(?:到|到老|退休)',
      '几周[^。，,;；]{0,4}(?:恢复|好|上班)',
      '多久能[^。，,;；]{0,4}(?:上班|工作|运动|跑步|旅游|恢复)',
      '大概几周',
      '能好利索',
      '好利索',
      '恢复[^。，,;；]{0,2}(?:正常|从前|以前)',
      '回到[^。，,;；]{0,2}(?:正常|从前|以前)',
      '彻底[^。，,;；]{0,2}(?:好|恢复)',
      '除根',
      '根治',
      '复发吗',
      '会不会[^。，,;；]{0,4}(?:复发|再犯|再犯|犯)',
    ],
  },
];

/** 判定问题是否属于某一类越界（供服务与测试复用） */
export function matchesScopeRule(rule: ScopeRule, question: string): boolean {
  const text = normalizeSafetyText(question);
  if (!text) return false;
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
  // 第六轮反馈：「不会瘫痪吧」这类求助要走求保证循环，而不是一次越界拒答
  '不会瘫痪',
  '不会瘫',
  '会不会瘫',
  '不能瘫',
  '会不会[^。，,;；]{0,4}(?:坐轮椅|瘫痪|残废|严重|恶化|加重)',
  '不会残废',
  '会不会残废',
  '不会坐轮椅',
  '会不会坐轮椅',
  '不会严重吧',
  '不会恶化吧',
  '不会有事吧',
  '不会加重吧',
];

/** 同一会话内连续求保证达到该次数 → 给出稳定解释并结束本轮 */
export const REASSURANCE_STREAK = 3;

/** 结束本轮时的固定回复（文案稳定，不做个性化，提示以医生评估为准） */
export const REASSURANCE_REPLY =
  '我能理解你希望听一句“肯定没事”。但要不要紧、会不会好，只有医生结合查体、影像和病史才能判断，我没法给你保证，也不会说“肯定没事”。把你的担心写进复诊问题清单，复诊时请医生评估，以医生的评估为准。';

/** 判断一条用户提问是否为「求保证」类问题（支持字面与正则两种写法） */
export function isReassurance(question: string): boolean {
  const text = normalizeSafetyText(question);
  return REASSURANCE_PATTERNS.some((p) =>
    /[\\^$.*+?()[\]{}|]/.test(p) ? new RegExp(p).test(text) : text.includes(p),
  );
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
