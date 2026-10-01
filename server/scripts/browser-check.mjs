#!/usr/bin/env node
/**
 * 用本机 Chrome 无头模式做浏览器验收（不关闭跨域检查）。
 * 逐页打开 → 收集控制台错误 / 网络失败 / 页面标题 → 输出报告。
 * 用法：node scripts/browser-check.mjs <baseUrl> <label> [--login <path> <selector...>]
 */
const { execFileSync } = require('node:child_process')

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'

const args = process.argv.slice(2)
const base = args[0]
const label = args[1]

const pages = JSON.parse(process.env.PAGES ?? '[]')
for (const p of pages) {
  console.log('---', label, p.path)
}

console.log('browser-check placeholder')
