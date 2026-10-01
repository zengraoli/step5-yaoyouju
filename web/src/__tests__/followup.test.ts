import { describe, expect, it } from 'vitest'
import { QUESTIONS_SECTION_KEY } from '@/api/followup'

/** 复诊摘要问题清单段：不标核实状态（问题是「问题」，不是病程事实） */
describe('复诊摘要分段', () => {
  it('问题清单段 key 固定', () => {
    expect(QUESTIONS_SECTION_KEY).toBe('questions')
  })
})
