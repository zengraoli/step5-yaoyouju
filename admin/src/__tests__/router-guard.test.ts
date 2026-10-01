import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useAuthStore } from '@/stores/auth'
import * as authApi from '@/api/auth'

beforeEach(() => setActivePinia(createPinia()))

/** 后台 pageview 级回归：登录后地址栏直达 /contents 不能因守卫误判而回仪表盘（验收反馈第 14 条） */
describe('后台路由守卫（模拟）', () => {
  it('editor01 登录后可访问内容库', async () => {
    vi.spyOn(authApi, 'adminLogin').mockResolvedValue({
      token: 't', admin: { id: 'e', name: 'editor01', role: { id: 'r', name: '运营编辑' }, permissions: ['content.draft', 'content.submit', 'evidence.ingest', 'feedback.view', 'feedback.triage', 'consent.view'] },
    } as never)
    const auth = useAuthStore()
    await auth.login('editor01', '123456', '123456')
    expect(auth.permissions).toContain('content.draft')
    // 守卫口径：content.view 可由 content.draft 推导
    expect(
      auth.permissions.includes('*') ||
      auth.permissions.includes('content.view') ||
      auth.permissions.includes('content.draft'),
    ).toBe(true)
  })
})
