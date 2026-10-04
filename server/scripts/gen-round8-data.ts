import { writeFileSync } from 'node:fs'
import { ROUND8_TRIGGER, ROUND8_NOT } from '../src/modules/safety/safety.corpus'

const out =
  '// 由 scripts/gen-round8-data.ts 从 safety.corpus.ts 生成，避免两份数据漂移\n' +
  `export const ROUND8_TRIGGER = ${JSON.stringify(ROUND8_TRIGGER, null, 2)}\n\n` +
  `export const ROUND8_NOT = ${JSON.stringify(ROUND8_NOT, null, 2)}\n`
writeFileSync(new URL('./round8-data.mjs', import.meta.url), out, 'utf8')
console.log(`生成 round8-data.mjs：TRIGGER=${ROUND8_TRIGGER.length}，NOT=${ROUND8_NOT.length}`)
