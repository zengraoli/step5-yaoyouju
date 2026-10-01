#!/usr/bin/env node
/**
 * Android deep link 验收：README 里的 17 个链接，冷启动与热启动各打开一遍，确认真的跳到对应页面。
 */
import { execFileSync } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'

const ADB = process.env.ADB ?? 'adb'
const PKG = 'com.yaoyouju.android'
const sh = (cmd) => execFileSync(ADB, ['shell', cmd], { encoding: 'utf8', timeout: 60000 })
const CODES = ['A01','A02','A03','A04','A05','A06','A07','A08','A09','A10','A11','A12','A13','A15','A16','A17','A18']
/** 每个编号打开后页面上应出现的关键文案（A01 登录页 / A03 就医提示 …） */
const MARKERS = {
  A01: '手机号', A02: '和上次相比', A03: '就医', A04: '困惑', A05: '录入报告', A06: '核对',
  A07: '一页分析', A08: '原文', A09: '问与解释', A10: '病程', A11: '记录今天', A12: '复诊摘要',
  A13: '内容', A15: '内容', A16: '反馈', A17: '我的', A18: '服务',
}
const dumpText = () => {
  sh('uiautomator dump /sdcard/yyj-ui.xml >/dev/null 2>&1')
  const xml = execFileSync(ADB, ['shell', 'cat', '/sdcard/yyj-ui.xml'], { encoding: 'buffer', timeout: 60000 }).toString('utf8')
  return (xml.match(/text="([^"]*)"/g) ?? []).join(' ')
}

let pass = 0
let fail = 0
for (const mode of ['冷启动', '热启动']) {
  for (const code of CODES) {
    if (mode === '冷启动') sh(`am force-stop ${PKG}`)
    sh(`am start -a android.intent.action.VIEW -d "yaoyoujuapp://${code}" >/dev/null 2>&1`)
    await delay(mode === '冷启动' ? 6500 : 3000)
    const text = dumpText()
    const marker = MARKERS[code]
    const ok = !marker || text.includes(marker)
    if (ok) pass += 1
    else {
      fail += 1
      console.log(`  ✗ ${mode} ${code} 期望「${marker}」`, text.slice(0, 120))
    }
    console.log(`  ${ok ? '✓' : '✗'} ${mode} yaoyoujuapp://${code}`)
  }
}
console.log(`\ndeep link：${pass} 通过, ${fail} 失败`)
process.exit(fail > 0 ? 1 : 0)
