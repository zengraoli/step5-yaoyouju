import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useAuthStore } from '@/stores/auth'

beforeEach(() => setActivePinia(createPinia()))

/** 与 router/index.ts 的越权判定保持一致（地址栏直达不能照常渲染） */
function hasAdminPermission(perms: string[], required: string): boolean {
  if (perms.includes('*')) return true
  if (perms.includes(required)) return true
  if (required === 'content.view' && (perms.includes('content.draft') || perms.includes('content.review'))) return true
  if (required === 'switch.manage_low' && perms.includes('switch.manage')) return true
  if (required === 'model.view' && (perms.includes('model.manage') || perms.includes('eval.manage'))) return true
  if (required === 'eval.view' && perms.includes('eval.manage')) return true
  if (required === 'audit.view' && perms.includes('audit.export_approve')) return true
  return false
}

describe('后台路由权限判定', () => {
  it('运营编辑可进内容库（持有 content.draft）', () => {
    const auth = useAuthStore()
    auth.admin = { id: 'e', name: 'editor01', role: { id: 'r', name: '运营编辑' }, permissions: ['content.draft', 'content.submit', 'evidence.ingest', 'feedback.view', 'feedback.triage', 'consent.view'], mfa_enabled: true }
    expect(hasAdminPermission(auth.permissions, 'content.view')).toBe(true)
  })

  it('运营编辑不能看成员 / 审计 / 模型 / 开关', () => {
    const auth = useAuthStore()
    auth.admin = { id: 'e', name: 'editor01', role: { id: 'r', name: '运营编辑' }, permissions: ['content.draft'], mfa_enabled: true }
    expect(hasAdminPermission(auth.permissions, 'user.view')).toBe(false)
    expect(hasAdminPermission(auth.permissions, 'audit.view')).toBe(false)
    expect(hasAdminPermission(auth.permissions, 'model.view')).toBe(false)
    expect(hasAdminPermission(auth.permissions, 'switch.manage_low')).toBe(false)
  })

  it('技术负责人 / 合规支持不能读内容库', () => {
    expect(hasAdminPermission(['switch.manage', 'model.manage'], 'content.view')).toBe(false)
    expect(hasAdminPermission(['audit.view', 'user.view'], 'content.view')).toBe(false)
  })

  it('临床审核可只读查看模型与评测', () => {
    expect(hasAdminPermission(['content.review', 'model.view', 'eval.view'], 'model.view')).toBe(true)
    expect(hasAdminPermission(['content.review', 'model.view', 'eval.view'], 'eval.view')).toBe(true)
  })
})
