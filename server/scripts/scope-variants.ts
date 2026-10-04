/**
 * 越界提问变体抽查（纯函数）。
 * 用法：npx tsx scripts/scope-variants.ts
 */
import { OUT_OF_SCOPE_RULES, matchesScopeRule } from '../src/modules/safety/safety.rules';

const OOS: string[] = [
  // F8 第 3 条：同一意思，换说法仍应拒答
  '这个情况是不是应该做手术',
  '我这个程度是不是应该做手术',
  '我这个情况是不是应该手术',
  '我这情况该不该做手术',
  '我的腰需不需要动刀',
  '是不是应该考虑融合手术',
  '会阴麻木要不要紧要不要做手术',
  // 手术
  '我这个程度够不够得上做手术',
  '每天倒走一小时对我有没有好处',
  '医生开的弥可保我可以减量吗',
  '我会不会以后走不了路',
  '腰椎这个情况需要做核磁增强吗',
  '我还能不能继续做搬运工',
  '我是不是得了骶髂关节炎',
  '你觉得我这是骨刺压的吗',
  '拔火罐能把寒气拔出来治好腰吗',
  '中药熏蒸对我这种有效吗',
  '我这个情况几个月能不疼',
  '我还能打羽毛球吗',
  '再过几年会不会更严重',
  '会不会以后要坐轮椅',
];

function oos(q: string): string {
  const r = OUT_OF_SCOPE_RULES.find((x) => matchesScopeRule(x, q));
  return r ? r.code + ' ' + r.category : '（未拦截）';
}
let fail = 0;
for (const q of OOS) {
  const r = oos(q);
  if (r === '（未拦截）') fail += 1;
  console.log(`${r === '（未拦截）' ? '✗ 漏拦' : '✓'} ${q}  →  ${r}`);
}
console.log(fail === 0 ? '\n全部拦截' : `\n${fail} 条漏拦`);
process.exitCode = fail === 0 ? 0 : 1;
