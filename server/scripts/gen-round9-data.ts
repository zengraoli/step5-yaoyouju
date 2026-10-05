import { writeFileSync } from 'node:fs'
import { ROUND9_TRIGGER, ROUND9_NOT } from '../src/modules/safety/safety.corpus'

const out =
  '// 由 scripts/gen-round8-data.ts 从 safety.corpus.ts 生成，避免两份数据漂移\n' +
  `export const ROUND9_TRIGGER = ${JSON.stringify(ROUND9_TRIGGER, null, 2)}\n\n` +
  `export const ROUND9_NOT = ${JSON.stringify(ROUND9_NOT, null, 2)}\n`
writeFileSync(new URL('./round9-data.mjs', import.meta.url), out, 'utf8')
console.log(`生成 round9-data.mjs：TRIGGER=${ROUND9_TRIGGER.length}，NOT=${ROUND9_NOT.length}`)
