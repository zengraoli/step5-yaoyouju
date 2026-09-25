/**
 * 个性化分析关闭 / 服务不可用时的回退内容（A18）。
 * 原则：明确说明原因，保留已录入信息与已审核资料入口，不无限重试、不生成解释。
 */

export interface FallbackEvent {
  event_type: string;
  source_type: string;
  raw_text: string | null;
  occurred_at: string;
  verify_status: string;
}

export interface FallbackInput {
  episode_title: string;
  events: FallbackEvent[];
  reason: 'switch_off' | 'service_unavailable';
}

export interface FallbackSections {
  known: { text: string; source: string; occurred_at: string; verify_status: string }[];
  explain: { text: string }[];
  unknown: string[];
  next: { text: string; type: string }[];
  videos: unknown[];
  meta: {
    fallback: true;
    reason: FallbackInput['reason'];
    disclaimer: string;
    version: number;
  };
}

const SOURCE_LABEL: Record<string, string> = {
  自述: '自述',
  报告原文: '报告原文',
  医生记录: '医生记录',
};

export function buildFallbackSections(input: FallbackInput): FallbackSections {
  const reasonText =
    input.reason === 'switch_off'
      ? '个性化分析当前已关闭，本轮不生成个性化解释。'
      : '分析服务暂时不可用，本轮不生成个性化解释。';
  return {
    known: input.events.map((e) => ({
      text: e.raw_text ?? `（${e.event_type}，无原文）`,
      source: SOURCE_LABEL[e.source_type] ?? e.source_type,
      occurred_at: e.occurred_at,
      verify_status: e.verify_status,
    })),
    explain: [],
    unknown: [
      '个性化解释未生成：本轮为回退结果',
      '未确认的项目仍显示“尚未确认”，未显示不等于正常',
    ],
    next: [
      { text: '在设置中开启个性化分析后可获得一页分析', type: '设置' },
      { text: '仍可查看已审核科普与复诊摘要', type: '资料' },
      { text: '出现新的严重信号请直接就医，不被本产品流程阻断', type: '就医提示' },
    ],
    videos: [],
    meta: {
      fallback: true,
      reason: input.reason,
      disclaimer: `${reasonText}本产品不作诊断。`,
      version: 1,
    },
  };
}
