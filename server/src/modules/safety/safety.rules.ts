/**
 * 安全规则集（临床审定规则，演示实现）。
 * - 红旗规则 RF-xx：命中即提示就医；high 级同时停止个性化分析（R03）。
 * - 服务范围规则 OOS-xx：诊断 / 手术 / 用药越界，明确不答，转为复诊问题。
 * 规则集带版本号，变更需递增版本并记录（B07 规则集版本）。
 */

export const RULE_SET_VERSION = 'safety-rules-v1.0';

export type SafetyAction = '提示就医' | '停止个性化分析';
export type SafetySeverity = 'high' | 'medium';

export interface RedFlagRule {
  code: string;
  label: string;
  severity: SafetySeverity;
  action: SafetyAction;
  /** 命中后展示的提示（不含诊断结论） */
  advice: string;
  patterns: RegExp[];
}

export const RED_FLAG_RULES: RedFlagRule[] = [
  {
    code: 'RF-01',
    label: '会阴部麻木',
    severity: 'high',
    action: '停止个性化分析',
    advice: '会阴部麻木需要尽快由医生评估，请前往医院就诊。',
    patterns: [/会阴[部处]?[，,。\s]*(感觉)?[麻木]/, /马鞍区[麻木]/, /屁股[麻木].*(大小便|排便)/],
  },
  {
    code: 'RF-02',
    label: '双腿进行性无力',
    severity: 'high',
    action: '停止个性化分析',
    advice: '下肢无力如果在加重，需要尽快由医生评估，请前往医院就诊。',
    patterns: [/双腿[，,。\s]*(进行性)?[无力没劲]/, /下[肢脚][，,。\s]*进行性[无力没劲]/, /腿[越来]?[没无]劲/],
  },
  {
    code: 'RF-03',
    label: '大小便控制变化',
    severity: 'high',
    action: '停止个性化分析',
    advice: '大小便控制出现变化需要尽快由医生评估，请立即就医。',
    patterns: [/大小便[，,。\s]*(控制|失禁|困难|障碍|排不出)/, /排便[困难障碍].*腰痛/, /尿潴留/, /便失禁/],
  },
  {
    code: 'RF-04',
    label: '外伤后持续加重',
    severity: 'medium',
    action: '提示就医',
    advice: '外伤后持续加重的疼痛建议及时就医评估。',
    patterns: [/(摔|撞|扭|搬).{0,8}(后|之后).{0,10}(加重|越来越[痛重]|更痛|变重)/, /外伤.{0,6}腰痛/],
  },
  {
    code: 'RF-05',
    label: '伴发热',
    severity: 'medium',
    action: '提示就医',
    advice: '腰痛伴发热建议及时就医评估。',
    patterns: [/腰痛.{0,3}[发热发烧]/, /[发热发烧].{0,3}腰痛/],
  },
  {
    code: 'RF-06',
    label: '不明原因体重下降',
    severity: 'medium',
    action: '提示就医',
    advice: '不明原因体重下降伴疼痛建议及时就医评估。',
    patterns: [/体重[下降减轻].{0,6}(痛|腰痛)/, /消瘦.{0,4}腰痛/],
  },
  {
    code: 'RF-07',
    label: '肿瘤史新发腰痛',
    severity: 'medium',
    action: '提示就医',
    advice: '有肿瘤病史者新发腰痛建议及时就医评估。',
    patterns: [/肿瘤[病历]?[史].{0,6}腰痛/, /癌症.{0,6}腰痛/],
  },
];

export type ScopeCategory = '诊断' | '手术' | '用药';

export interface ScopeRule {
  code: string;
  category: ScopeCategory;
  /** 明确不答的标准回复（不作诊断、不给建议） */
  reply: string;
  /** 转为复诊问题 */
  followup_question: string;
  patterns: RegExp[];
}

export const OUT_OF_SCOPE_RULES: ScopeRule[] = [
  {
    code: 'OOS-01',
    category: '诊断',
    reply: '我不能判断这是什么病，也不能确认严重程度。这需要医生结合查体、影像和病史判断。',
    followup_question: '请医生结合查体和影像，确认我的情况属于什么诊断',
    patterns: [
      /是不是[椎腰]?[椎间]?[间盘盘]?[突出膨出]/,
      /是[什啥]么[病症]/,
      /能[不能确诊]/,
      /确诊/,
      /严重吗/,
      /能治好吗/,
      /恶[化性]/,
    ],
  },
  {
    code: 'OOS-02',
    category: '手术',
    reply: '是否需要手术要由医生评估，我不能给出手术建议。',
    followup_question: '请医生评估我的情况是否需要手术或其他治疗',
    patterns: [/[需要不]?[要]?手术/, /微创/, /开刀/, /融合术/, /消融/],
  },
  {
    code: 'OOS-03',
    category: '用药',
    reply: '我不能提供用药或剂量建议，请咨询医生或药师。',
    followup_question: '请医生确认我正在使用的药物是否适合当前情况',
    patterns: [/吃[什啥]药/, /用[什啥]药/, /止疼药/, /止痛药/, /布洛芬/, /药[物品剂量]/],
  },
];
