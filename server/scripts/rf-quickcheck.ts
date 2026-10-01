/**
 * 第五轮安全规则快速核对（纯函数，无需启动 server）。
 * 覆盖：项1 应触发 + 项2 不应触发 + 既有 redflag-cases / redflag-extra 全部用例。
 * 用法：npx tsx scripts/rf-quickcheck.ts
 */
import { RED_FLAG_RULES, matchesRedFlagRule } from '../src/modules/safety/safety.rules';
// @ts-ignore - .mjs 用例数组
import { RED as R1, NEG as N1, NORMAL_REPORT as NR1 } from './redflag-cases.mjs';
// @ts-ignore
import { RED as R2, NEG as N2, NORMAL_REPORT as NR2 } from './redflag-extra.mjs';

/** 项1：应触发（HR 反馈本文原句） */
const ITEM1_TRIGGER: string[] = [
  '这两天尿尿老是尿不干净憋也憋不住',
  '上厕所的时候感觉不到尿出来了',
  '大号拉在裤子里了自己一点没察觉',
  '排尿费劲要使劲按着肚子才尿得出',
  '夜里遗尿了两次我都四十多了',
  '肛门好像松了老是漏便',
  '撒尿撒不出憋了一整天',
  '不知不觉就尿到裤子上了',
  '一天一夜没小便了肚子胀得像鼓一样',
  '现在得穿纸尿裤才敢出门尿老是自己流',
  '大腿根内侧和私处都木了',
  '阴囊和屁眼周围发麻',
  '坐在凳子上屁股贴凳子那一圈都是木的',
  '骑车时坐垫压着的那块地方现在一点知觉都没有',
  '跟老婆同房时下面没感觉了',
  '脚尖踮不起来了比上周还差',
  '两条腿越来越软站一会儿就要跪下去',
  '下肢乏力逐渐加重',
  '右下肢肌力从5级掉到3级',
  '腿上的麻一路往上爬已经麻到肚脐了',
  '腰痛加上浑身发冷打摆子',
  '晚上出虚汗还有点烧',
  '体温一直在三十八度上下腰背疼得翻身都难',
  '休息也不缓解夜间疼痛明显',
  '疼得一整夜只能坐着根本没法躺下',
  '搬家时从楼梯上滚下去了',
  '骑摩托摔了腰磕在马路牙子上一动就钻心地痛',
  '七十多岁了打个喷嚏腰就疼得动不了',
  '骨髓瘤还在治疗中最近腰疼',
  '之前的甲状腺癌医生说可能转移了',
  '去年查出淋巴瘤现在腰痛越来越厉害',
  '疼痛评分9分止痛药无效',
  '这次疼得跟刀割一样从来没这么痛过',
  '痛得整个人蜷成一团连话都说不出来',
  '腰痛剧烈难忍叫了救护车',
];

/** 项2：不应触发（当前被判为红旗的否定/日常说法） */
const ITEM2_NOT: string[] = [
  '医生问我有没有大小便失禁，我说没有',
  '体重没有下降',
  '否认发热',
  '消瘦',
  '看科普说发烧加腰痛要警惕我没有发烧',
  '以前体重掉过那是减肥成功现在一直很稳定',
  '闺女夜里烧到39度我抱了一宿腰酸背痛',
  '股票跌了心疼得睡不着腰也有点酸',
  '为了体检达标减肥两个月瘦了10斤挺开心',
  '做梦梦到从山上摔下去醒来腰有点僵',
  '发热贴贴在腰上暖暖的很舒服',
  '新买的车被撞了个小凹坑人没事',
];

function flagged(text: string): string[] {
  return RED_FLAG_RULES.filter((r) => matchesRedFlagRule(r, text)).map((r) => r.code);
}

const groups: { name: string; items: string[]; want: 'hit' | 'miss' }[] = [
  { name: '项1 应触发', items: ITEM1_TRIGGER, want: 'hit' },
  { name: '项2 不应触发', items: ITEM2_NOT, want: 'miss' },
  { name: '既有 RED/redflag-cases', items: R1 as string[], want: 'hit' },
  { name: '既有 NEG/redflag-cases', items: N1 as string[], want: 'miss' },
  { name: '既有 正常报告/redflag-cases', items: NR1 as string[], want: 'miss' },
  { name: '既有 RED/redflag-extra', items: R2 as string[], want: 'hit' },
  { name: '既有 NEG/redflag-extra', items: N2 as string[], want: 'miss' },
  { name: '既有 正常报告/redflag-extra', items: NR2 as string[], want: 'miss' },
];

let totalFail = 0;
for (const g of groups) {
  const bad: string[] = [];
  for (const t of g.items) {
    const f = flagged(t);
    const isHit = f.length > 0;
    if (g.want === 'hit' && !isHit) bad.push('未命中: ' + t);
    if (g.want === 'miss' && isHit) bad.push(`误判: ${t} → ${f.join(',')}`);
  }
  const ok = g.items.length - bad.length;
  console.log(`${g.name}：${ok}/${g.items.length}${bad.length ? '  ✗' : '  ✓'}`);
  for (const b of bad) console.log('   ' + b);
  totalFail += bad.length;
}
console.log(totalFail === 0 ? '\n全部通过' : `\n共 ${totalFail} 条不达标`);
process.exitCode = totalFail === 0 ? 0 : 1;
