/**
 * 安全规则集（临床审定规则，演示实现）。
 * - 红旗规则 RF-xx：命中即提示就医；high 级同时停止个性化分析（R03）。
 * - 服务范围规则 OOS-xx：诊断 / 手术 / 用药 / 预后越界，明确不答，转为复诊问题。
 * 规则集带版本号，变更需递增版本并记录（B07 规则集版本）。
 *
 * 匹配策略（验收反馈第 2 条）：
 * 1. 文本先归一化：全角→半角、去掉空白、统一标点，提升口语 / 错别字文本的命中率；
 * 2. 每条规则列出一组「核心症状短语」（正则片段），覆盖书面语、口语与常见错别字；
 *    短语中的多字词一律用 `(?:甲|乙)` 分组，不用 `[甲乙]` 字符类，避免只匹配半个词；
 * 3. 命中核心短语后向前看，最多跨过 3 个非标点字寻找否定词（没有 / 无 / 未 / 不…），
 *    命中即判为否定说法；向后紧跟「正常 / 良好 / 无异常 / 未见…」同样判为否定；
 * 4. 同一规则下任意一个短语被「肯定」命中即触发。
 */

export const RULE_SET_VERSION = 'safety-rules-v2.0';

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
  '阴性',
];

const NEGATION_SOURCE = NEGATION_WORDS.map(escapeRegExp).join('|');
/** 以「否定词 + 0~3 个非标点字」结尾 */
const TRAILING_NEGATION = new RegExp(`(?:${NEGATION_SOURCE})[^\uFF0C\u3002\uFF1B,.;]{0,3}$`);
/** 只含否定词（紧邻） */
const STRICT_NEGATION = new RegExp(`(?:${NEGATION_SOURCE})$`);

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

/** 该次出现是否为否定说法（向前找否定词，或向后紧跟「正常」） */
export function isNegatedMention(text: string, match: CoreMatch): boolean {
  const before = text.slice(Math.max(0, match.start - 12), match.start);
  if (STRICT_NEGATION.test(before)) return true;
  if (TRAILING_NEGATION.test(before)) return true;
  const after = text.slice(match.end, match.end + 8);
  return NORMAL_AFTER_WORDS.some((w) => after.startsWith(w));
}

/** 归一化文本中该核心短语是否被「肯定」命中 */
export function affirmativeOnset(text: string, core: string): boolean {
  for (const match of findCoreMatches(text, core)) {
    if (!isNegatedMention(text, match)) return true;
  }
  return false;
}

export type SafetyAction = '提示就医' | '停止个性化分析';
export type SafetySeverity = 'high' | 'medium';

export interface RedFlagRule {
  code: string;
  label: string;
  severity: SafetySeverity;
  action: SafetyAction;
  /** 命中后展示的提示（不含诊断结论） */
  advice: string;
  /** 核心症状短语（正则片段，覆盖口语 / 书面语 / 常见错别字） */
  phrases: string[];
}

/** 疼痛 / 加重等常用片段（复用） */
const WORSE = '(?:加重|变重|越来越严重|加重了|更痛|更疼|越来越痛)';

/**
 * 红旗规则集 v2：
 * 会阴/鞍区感觉、下肢进行性无力、大小便控制、持续不缓解的夜间痛、
 * 不明原因体重下降、伴发热、肿瘤史新发腰痛、外伤后持续加重、足部感觉与行走变化。
 */
export const RED_FLAG_RULES: RedFlagRule[] = [
  {
    code: 'RF-01',
    label: '会阴部麻木',
    severity: 'high',
    action: '停止个性化分析',
    advice: '会阴部（或鞍区）麻木需要尽快由医生评估，请前往医院就诊。',
    phrases: [
      '会阴(?:部|区|处)?[，,]?(?:感觉)?(?:麻木|发麻|发木)',
      '会阴(?:部|区|处)?[，,]?(?:感觉)?(?:减退|减弱|消失)',
      '会阴(?:有点|有些|一点)?(?:麻|麻木|发麻)',
      '会音(?:麻木|发麻)',
      '马鞍区(?:感觉)?(?:麻木|发麻|减退|减弱|消失)',
      '鞍区(?:感觉)?(?:麻木|发麻|减退|减弱|消失)',
      '屁股(?:有点|有些|一点)?(?:麻|麻木|发麻)',
      '臀部(?:麻木|发麻)',
      '肛门(?:周围|边缘)?(?:麻木|发麻)',
      '生殖器(?:麻木|发麻)',
      '下身(?:麻木|发麻)',
    ],
  },
  {
    code: 'RF-02',
    label: '双腿进行性无力',
    severity: 'high',
    action: '停止个性化分析',
    advice: '下肢无力如果在加重，需要尽快由医生评估，请前往医院就诊。',
    phrases: [
      '双腿[，,]?(?:进行性|逐渐|越来越|越发)?(?:无力|没劲|软弱|发软)',
      '双腿越来越没(?:有力|力气)',
      '双腿[，,]?力量(?:减弱|下降|变差)',
      '双腿[，,]?使不上(?:劲|力气)',
      '两条腿[，,]?(?:进行性|逐渐)?(?:无力|没劲)',
      '两条腿越来越没(?:有力|力气)',
      '双退(?:无力|没劲)',
      '双退越来越没(?:有力|力气)',
      '下肢[，,]?(?:进行性|逐渐|越来越)?(?:无力|没劲)',
      '下(?:肢|脚)[，,]?进行性(?:无力|没劲)',
      '腿越(?:来越)?越?没(?:有力|力气)',
      '腿越来越没(?:有力|劲|力气)',
      '走路(?:越来越)?费劲',
      '腿软(?:站|走)不住',
      '足下垂',
      '垂足',
      '腿部肌肉(?:萎缩)',
      '大腿(?:开始|逐渐|越来越|越发)?(?:无力|没劲|发软)',
      '(?:双|左|右)腿(?:麻木|发麻)(?:无力|没劲)?',
    ],
  },
  {
    code: 'RF-03',
    label: '大小便控制变化',
    severity: 'high',
    action: '停止个性化分析',
    advice: '大小便控制出现变化需要尽快由医生评估，请立即就医。',
    phrases: [
      '大小便(?:控|管)?制[，,]?(?:出现|有|开始|有点)?(?:变化|异常|障碍|困难|问题|减退|不能|无法|差)',
      '大小便(?:控|管)?制(?:失灵|不行|不好|不行了)',
      '大小便(?:失禁)',
      '大小变失禁',
      '大便憋不住',
      '憋不住(?:大|小)?便',
      '大便失禁',
      '便失禁',
      '尿失禁',
      '小便失禁',
      '解不出(?:小)?(?:便|尿)',
      '尿不出(?:来|尿)',
      '排不出尿',
      '无法排尿',
      '排尿(?:困难|障碍)',
      '排便(?:困难|障碍)',
      '尿潴留',
      '便秘(?:加重|厉害)',
      '便意(?:消失|丧失|淡漠)',
      '大小便[，,]?功能(?:异常|障碍)',
      '大小便(?:感觉)?(?:减退|减弱|消失)',
      '尿(?:意|感)(?:消失|减弱)',
    ],
  },
  {
    code: 'RF-04',
    label: '持续不缓解的夜间痛',
    severity: 'medium',
    action: '提示就医',
    advice: '夜间或静息时持续不缓解的疼痛建议及时就医评估。',
    phrases: [
      "夜间痛[，,]?(?:持续)?(?:不缓|不缓解|没有缓解|没缓解)",
      '夜间疼(?:痛)?(?:持续)?(?:不缓|不缓解|没有缓解|没缓解)',
      '夜间痛醒',
      '夜里痛醒',
      '半夜痛醒',
      '晚上痛醒',
      '夜里比白天(?:还|更)(?:痛|疼)',
      '休息(?:时|态)?也(?:痛|疼)',
      '静息痛',
      '夜间痛',
      '夜里痛',
      '半夜痛',
      '夜里疼得睡不(?:着|好)',
    ],
  },
  {
    code: 'RF-05',
    label: '不明原因体重下降',
    severity: 'medium',
    action: '提示就医',
    advice: '不明原因体重下降伴疼痛建议及时就医评估。',
    phrases: [
      '体重(?:明显|大幅度|快速|一下子)?(?:下降|减轻|减少|掉了|掉了)',
      '体重瘦(?:了|下来)',
      '掉(?:了|过)[0-9一二两三四五六七八九十]{1,6}斤',
      '瘦(?:了|下来)[0-9一二两三四五六七八九十]{1,6}斤',
      '不明原因(?:消瘦|体重)',
      '明显消瘦',
      '半年(?:内|里)?瘦(?:了|下来)',
    ],
  },
  {
    code: 'RF-06',
    label: '伴发热',
    severity: 'medium',
    action: '提示就医',
    advice: '腰痛伴发热建议及时就医评估。',
    phrases: ['(?:发烧|发热|低烧|高热|发烧了)', '体温(?:升高|增高|超过38)'],
  },
  {
    code: 'RF-07',
    label: '肿瘤史新发腰痛',
    severity: 'medium',
    action: '提示就医',
    advice: '有肿瘤病史者新发腰痛建议及时就医评估。',
    phrases: [
      '肿瘤(?:病|疾)史',
      '癌症(?:病|疾)史',
      '癌(?:症)病史',
      '化疗(?:后)?腰痛',
      '肿瘤(?:病|疾)史(?:后)?[，,]?新(?:发)?腰痛',
    ],
  },
  {
    code: 'RF-08',
    label: '外伤后持续加重',
    severity: 'medium',
    action: '提示就医',
    advice: '外伤后持续加重的疼痛建议及时就医评估。',
    phrases: [
      '摔(?:了|过)?一?跤',
      '摔伤',
      '撞(?:了|过)?一?下',
      '车祸',
      '扭(?:到|伤)?腰',
      '闪(?:到)?腰',
      '被车(?:撞|碰)',
      `外伤(?:后|之)?[，,]?疼(?:痛)?(?:持续)?${WORSE}`,
      '外伤(?:后|之)?腰痛',
      '搬重物(?:后)?腰痛(?:加重|变重)',
    ],
  },
  {
    code: 'RF-09',
    label: '足部感觉或行走明显变化',
    severity: 'medium',
    action: '提示就医',
    advice: '足部感觉或行走明显变化建议及时就医评估。',
    phrases: [
      '脚(?:麻|发麻|麻木)',
      '脚背(?:麻木|发麻)',
      '脚底(?:麻木|发麻)',
      '脚(?:趾|指)头(?:麻木|发麻)',
      '无知觉',
      '走路(?:越来越)?不稳',
      '步态(?:不稳|异常)',
      '踩(?:棉花|棉絮)',
    ],
  },
];

/** 判定原始文本是否命中某条红旗规则（供服务与测试复用） */
export function matchesRedFlagRule(rule: RedFlagRule, rawText: string): boolean {
  const text = normalizeSafetyText(rawText);
  if (!text) return false;
  return rule.phrases.some((core) => affirmativeOnset(text, core));
}

/** 取命中片段的原文上下文（用于前端高亮与说明） */
export function redFlagExcerpt(rule: RedFlagRule, rawText: string): string {
  const text = normalizeSafetyText(rawText);
  for (const core of rule.phrases) {
    const match = findCoreMatches(text, core)[0];
    if (match) {
      const start = Math.max(0, match.start - 6);
      return rawText.slice(start, Math.min(rawText.length, start + match.text.length + 14));
    }
  }
  return rawText.slice(0, 40);
}

export type ScopeCategory = '诊断' | '手术' | '用药' | '预后';

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
      '我是不是(?:腰|腰椎|椎间盘)',
      '是(?:什|啥)么(?:病|症|毛病)',
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
    ],
  },
  {
    code: 'OOS-04',
    category: '预后',
    reply:
      '我没法预测以后会怎样，也不会说“肯定没事”或“一定会严重”。要不要紧、会不会变化，需要医生结合查体和影像随访判断。',
    followup_question: '请医生评估我的情况后续大致会如何变化，需要注意什么',
    negationAware: false,
    phrases: ['瘫痪', '会残留', '一辈子(?:治不好|好不了)', '以后(?:能|能不|能不能)好', '会不会(?:越来越|越来)越(?:严|重)', '预后'],
  },
];

/** 判定问题是否属于某一类越界（供服务与测试复用） */
export function matchesScopeRule(rule: ScopeRule, question: string): boolean {
  const text = normalizeSafetyText(question);
  if (!text) return false;
  if (rule.negationAware === true) {
    return rule.phrases.some((core) => affirmativeOnset(text, core));
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
  '不要紧',
  '问题不大',
  '不会有事',
  '我心里踏实',
  '放心',
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
