import { describe, expect, it } from 'vitest'
import { getBaseUrl } from '@/api/request'

/** 默认指向本机 server（127.0.0.1:3200） */
describe('请求基地址', () => {
  it('默认基地址可配置且不带尾斜杠', () => {
    const url = getBaseUrl()
    expect(url.startsWith('http')).toBe(true)
    expect(url.endsWith('/')).toBe(false)
  })
})
