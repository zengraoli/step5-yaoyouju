import {
  LocalMockAdapter,
  chunkRelevantToReport,
  segmentPairs,
  imagingTypes,
  type GenerateInput,
  type KnownItem,
} from './model-adapter'
import type { RetrievedChunk } from '../evidence/evidence-retrieval'

const known = (text: string): KnownItem => ({
  text,
  source: '报告原文',
  occurred_at: '2026-09-29T16:00:00.000Z',
  verify_status: '尚未确认',
  care_event_id: 'c',
})

const chunk = (content: string): RetrievedChunk => ({
  chunk_id: 'd-1',
  doc_id: 'd',
  doc_title: '《腰椎 MRI 报告常见术语说明（演示）》',
  content,
  score: 1,
})

describe('LlmAdapter 节段 / 影像类型相关性（F12 第 1 条：不凭空补未知节段、不类型错配）', () => {
  it('segmentPairs / imagingTypes 归一', () => {
    expect([...segmentPairs('L5/S1 指第 5 节腰椎与骶骨')]).toContain('L5S1')
    expect([...segmentPairs('L4-L5 椎间盘轻度膨出')]).toContain('L4L5')
    expect(imagingTypes('腰椎 MRI')).toEqual(new Set(['mri']))
    expect(imagingTypes('腰椎 CT 平扫')).toEqual(new Set(['ct']))
  })

  it('CT + L4-L5 报告不应引用解释 L5/S1 的 MRI 片段', () => {
    expect(chunkRelevantToReport('L5/S1 指第 5 节腰椎与第 1 节骶椎之间的椎间盘', '2026-09-30 CT L4-L5-mild-disc-bulge')).toBe(false)
    // MRI + L5/S1 报告则相关
    expect(chunkRelevantToReport('L5/S1 指第 5 节腰椎与第 1 节骶椎之间的椎间盘', 'MRI：L5/S1 椎间盘轻度突出')).toBe(true)
    // 一般性内容（无声称节段 / 类型）视为相关
    expect(chunkRelevantToReport('腰痛时避免久坐，适当活动', '2026-09-30 CT L4-L5-mild-disc-bulge')).toBe(true)
  })

  it('generateDraft：CT/L4-L5 报告不生成 L5/S1 解释、不伪造输入没有的节段', () => {
    const input: GenerateInput = {
      known: [known('2026-09-30 CT\nF11-SYNTHETIC-CT-9134-L4-L5-mild-disc-bulge')],
      evidence: [chunk('L5/S1 指第 5 节腰椎与第 1 节骶椎之间的椎间盘，是腰痛相关报告常提到的位置。')],
      videoCandidates: [],
      context: { episode_title: 't', report_describes_leg: false, has_report: true },
    }
    const draft = new LocalMockAdapter().generateDraft(input)
    expect(draft.explain.some((e) => e.text.includes('L5/S1'))).toBe(false)
    expect(draft.explain).toHaveLength(0)
    // 已知段仍如实包含输入
    expect(draft.known[0].text).toContain('L4-L5-mild-disc-bulge')
  })

  it('generateDraft：MRI/L5/S1 报告仍生成 L5/S1 解释（相关命中）', () => {
    const input: GenerateInput = {
      known: [known('MRI：L5/S1 椎间盘轻度突出')],
      evidence: [chunk('L5/S1 指第 5 节腰椎与第 1 节骶椎之间的椎间盘，是腰痛相关报告常提到的位置。')],
      videoCandidates: [],
      context: { episode_title: 't', report_describes_leg: false, has_report: true },
    }
    const draft = new LocalMockAdapter().generateDraft(input)
    expect(draft.explain.some((e) => e.text.includes('L5/S1'))).toBe(true)
  })
})
