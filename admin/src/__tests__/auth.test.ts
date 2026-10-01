import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useAuthStore } from '@/stores/auth'

beforeEach(() => {
  setActivePinia(createPinia())
})

/** 后台登录态：令牌只存 sessionStorage（不长期驻留本地存储） */
describe('后台登录态 store', () => {
  it('未登录时没有权限', () => {
    const auth = useAuthStore()
    auth.logout()
    expect(auth.isLoggedIn).toBe(false)
    expect(auth.hasPermission('audit.view')).toBe(false)
  })

  it('超级管理员通配全部权限', () => {
    const auth = useAuthStore()
    auth.admin = {
      id: 'x',
      name: 'super',
      role: { id: 'r', name: '超级管理员' },
      permissions: ['*'],
      mfa_enabled: true,
    }
    expect(auth.hasPermission('audit.view')).toBe(true)
    expect(auth.hasPermission('case.manage')).toBe(true)
    expect(auth.role).toBe('超级管理员')
  })

  it('普通角色只拿自己权限内的', () => {
    const auth = useAuthStore()
    auth.admin = {
      id: 'y',
      name: 'editor',
      role: { id: 'r', name: '运营编辑' },
      permissions: ['content.draft', 'content.submit'],
      mfa_enabled: true,
    }
    expect(auth.hasPermission('content.draft')).toBe(true)
    expect(auth.hasPermission('content.publish')).toBe(false)
    expect(auth.hasPermission('audit.view')).toBe(false)
  })
})
