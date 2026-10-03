import { afterEach, describe, expect, it, vi } from 'vitest'
import { publishContent } from '@/api/contents'

/**
 * 第七轮验收反馈第 7 条：运营编辑点「发起发布」必须真的生成确认单。
 * 服务端按「是否携带 confirmation_id」区分「发起」与「确认后执行」，
 * 因此发起时请求体不能带 confirmation_id（带空对象即可）。
 */
describe('内容发布接口参数', () => {
  it('发起发布不带确认单 ID', async () => {
    let sent: unknown = null
    const fetchMock = async (_url: string, init: RequestInit): Promise<Response> => {
      sent = init.body
      return new Response(JSON.stringify({ code: 0, data: {}, message: 'ok' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    vi.stubGlobal('fetch', fetchMock)
    await publishContent('c1')
    expect(sent).toBe('{}')
    vi.unstubAllGlobals()
  })

  it('确认后执行带上确认单 ID', async () => {
    let sent: unknown = null
    const fetchMock = async (_url: string, init: RequestInit): Promise<Response> => {
      sent = init.body
      return new Response(JSON.stringify({ code: 0, data: {}, message: 'ok' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    vi.stubGlobal('fetch', fetchMock)
    await publishContent('c1', 'conf-1')
    expect(sent).toBe(JSON.stringify({ confirmation_id: 'conf-1' }))
    vi.unstubAllGlobals()
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})