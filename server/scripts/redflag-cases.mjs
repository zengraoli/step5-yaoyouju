/**
 * 追加 60 条红旗说法 / 否定说法 / 正常报告描述（主持者要求的补充用例）。
 * 仅用来覆盖反馈里没列到的表达，不修改规则本身。
 */
const RED = [
  '会阴部像坐过粽子一样麻',
  '下面麻麻的，使不上劲',
  '肛门周围发木',
  '蛋蛋发麻',
  '屁股沟那一带木木的',
  '两条腿跟灌了铅一样抬不起来',
  '右腿从上周开始一点点没力气',
  '腿软，上楼要扶扶手',
  '走五十米就得歇',
  '脚翘不起来（足下垂）',
  '最近老摔跤，腿不听使唤',
  '一天要上十次厕所却尿不出多少',
  '尿线变细，要使劲才能尿出来',
  '小肚子胀，尿潴留',
  '大便失禁，自己不知道',
  '大便在裤子里了',
  '憋不住尿，咳嗽就漏',
  '夜里三点疼醒，白天反而轻些',
  '夜间静止时痛得更厉害',
  '晚上只能睡两小时',
  '晚上一躺下腰就痛',
  '四个月瘦了二十斤',
  '没节食也瘦了一圈',
  '裤子腰围大了一圈',
  '夜里发烧到 38.5',
  '腰疼伴着打寒战',
  '低烧两周了，腰痛也加重',
  '三年前胃癌手术后，最近腰痛',
  '乳腺癌化疗期间腰痛',
  '有肿瘤家族史加腰痛',
  '两周前从梯子上摔下来，腰痛越来越重',
  '车祸后腰痛持续加重',
  '搬花盆闪到腰，之后越来越痛',
  '左脚背发麻，走路像踩棉花',
  '右脚底木木的',
  '腿越来越沉，拖地走',
  '双腿像绑了沙袋',
];

const NEG = [
  '会阴部感觉好多了，没再发麻',
  '不麻了，昨天麻今天没麻',
  '双腿完全有劲，能跑能跳',
  '肌力五级，正常',
  '下肢肌力正常，病理征阴性',
  '大小便能自主控制，无失禁',
  '从没大小便失禁',
  '小便如常，没有排尿困难',
  '无尿频尿急尿痛',
  '没有夜间盗汗',
  '不发烧，精神好',
  '体重稳定，没有下降',
  '大小便正常',
  '无阳性体征',
  '二便调',
  '食纳可，夜寐安',
  '无双下肢放射痛',
  '没有踩棉花感',
  '步态稳健，无共济失调',
];

const NORMAL_REPORT = [
  '腰椎 MRI 平扫：腰椎序列正常，生理曲度存在。L4/5 椎间盘轻度退变，相应水平椎管稍窄。结论：轻度腰椎退行性改变。',
  '影像所见：L3/4、L4/5 椎间盘信号减低，T2 加权像髓核信号减低，考虑椎间盘退变。硬膜囊前脂肪间隙清晰。',
  'X 线：腰椎生理曲度变直，椎体边缘轻度增生。',
  '检查所见无异常；双侧椎间孔未见明显狭窄。',
  'MRI：T11-L2 椎体及椎间盘未见确切异常，脊髓信号未见异常。',
  '腰椎正侧位片：椎体形态如常，无滑脱。',
];

let pass = 0;
let fail = 0;
function check(name, cond, extra) {
  if (cond) { pass += 1; } else { fail += 1; console.log('FAIL', name, extra ?? ''); }
}

const BASE = 'http://127.0.0.1:3200';
async function req(url, method = 'GET', data, token) {
  const res = await fetch(BASE + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: data ? JSON.stringify(data) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

const login = await req('/auth/login', 'POST', { phone: '13977778888', code: '123456' });
const token = login.body.data.token;
await req('/auth/consents', 'POST', { scope: '健康信息处理' }, token);
const ep = await req('/episodes', 'POST', { title: '安全规则补充用例' }, token);
const epId = ep.body.data.id;

for (const t of RED) {
  const r = await req('/analyses', 'POST', { episode_id: epId, symptom_change: t }, token);
  const blocked = r.body.code === 40911 || r.body.code === 40910 || (r.body.code === 202 && r.body.data?.safety_notice) || (r.body.code === 0 && r.body.data?.safety_notice);
  check('红旗: ' + t, blocked, r.body.code);
}
for (const t of NEG) {
  const r = await req('/analyses', 'POST', { episode_id: epId, symptom_change: t }, token);
  check('否定: ' + t, r.body.code !== 40910 && r.body.code !== 40911, r.body.code);
}
for (const t of NORMAL_REPORT) {
  const r = await req('/analyses', 'POST', { episode_id: epId, report_text: t }, token);
  check('报告: ' + t.slice(0, 20), r.body.code !== 40910 && r.body.code !== 40911, r.body.code);
}
console.log(`附加用例：通过 ${pass}，失败 ${fail}`);
process.exitCode = fail > 0 ? 1 : 0;
