/**
 * 第七轮（最后一轮）安全规则自编用例：100 条反馈与项目里都没有出现过的新说法。
 * 每条用「新用户 + 新病程」走真实接口（POST /auth/login → /episodes → /analyses），
 * 因为命中高危红旗后该账号会停止个性化分析（产品红线第 3 条）。
 *
 * 组成：
 * - SHOULD_TRIGGER 60 条应触发（其中 12 条是病历 / 报告写法）
 * - SHOULD_NOT_TRIGGER 30 条否定或日常说法（其中 12 条转述家人病情、12 条普通腰腿痛加重 / 发麻）
 * - NORMAL_REPORTS 10 段正常报告 / 病历原文
 *
 * 用法：先启动 server（npm run dev），再执行
 *   npx tsx scripts/round7-cases.ts
 */

const BASE = process.env.API_BASE_URL ?? 'http://127.0.0.1:3200';

/** 60 条应触发（口语 / 方言 / 错别字 / 语序 / 病历写法） */
const SHOULD_TRIGGER: string[] = [
  // —— 会阴 / 鞍区感觉 ——
  '下面那一带这两天木木的，擦屁股都没什么知觉',
  '会阴部像贴了块塑料布，摸上去没感觉',
  '肛门周围一圈发木，纸擦过都没知觉',
  '屁股沟里像贴了块胶布一样木',
  '騎車時候會陰部壓着的地方全麻了',
  '入院记录：患者诉会阴部麻木，伴排尿困难',
  // —— 大小便控制 ——
  '尿尿要使很大劲，还得用手按着肚子才行',
  '夜里睡着睡着就尿了，我都五十多了从来没这样',
  '晚上睡着了床单湿了一大片，以前从没有过',
  '膀胱满了也没有尿意，护士说残余尿很多',
  '小解解唔出，腰好痛',
  '尿脬胀得疼可就是尿不下来',
  '这两天弯腰捡东西尿就一下出来了，总是控制不了',
  '想了解一下，我会阴部麻木两天了怎么办',
  '门诊病历：患者3天前出现大小便失禁，鞍区麻木',
  '病人自述会阴部麻木，排尿困难三天',
  '出院记录：患者尿潴留，予留置导尿',
  // —— 下肢进行性无力 ——
  '两条腿一起没劲，站起来都要人扶，比昨天还差',
  '腿越来越没得力气，昨天还能骑电动车今天腿都抬不上去',
  '左脚掌拍地走路，不知不觉越来越严重了',
  '走路右脚尖老是踢到地，这几天越来越频繁',
  '双腿发软像踩着弹簧，连站都站不稳，这几天越来越差',
  '蹲坑起不来，需要家里人拉',
  '麻的范围每天都在扩大，从小腿到了膝盖上面',
  '跑步回来以后两条腿越来越没力气，现在站不稳',
  '入院记录：患者双下肢无力进行性加重一周，伴尿潴留',
  // —— 夜间痛 / 静息痛 ——
  '夜里腰疼得比白天还厉害，平躺也不缓解',
  '休息的时候反而更疼，晚上尤其严重',
  '半夜疼醒，只能坐着等到天亮',
  // —— 体重下降 ——
  '衣服都宽了一圈，没刻意减肥，腰还天天疼',
  '裤腰带往里收了两个孔，没节食，后腰一直隐隐作痛',
  // —— 发热 ——
  '身上滚烫，腰杆疼',
  '浑身发烫，腰也疼得厉害',
  // —— 肿瘤史 ——
  '有胃癌病史，最近腰疼得睡不着',
  '三年前乳腺癌手术，现在腰痛',
  // —— 外伤 / 骨质疏松 ——
  '昨天下楼梯踩空，一屁股坐在台阶上，腰到现在不敢动',
  '七十多岁了有骨质疏松，坐下的时候用力过猛就腰疼得起不来',
  '绝经多年骨头疏松，弯腰捡东西后腰背剧痛',
  '从两米高的架子上掉下来，腰撞在钢管上',
  // —— 剧痛 ——
  '疼得打滚，家属叫了救护车',
  '腰疼得直不起身，汗把衣服都浸透了',
  '这是我这辈子最痛的一次，动都不敢动',
  // —— 足部感觉 / 行走 ——
  '右脚背麻，走路像踩棉花',
  '脚底没感觉，走路深一脚浅一脚',
  '走路不稳，像踩在棉絮上',
  '左脚抬不起来，走路脚尖拖地',
  '走路越来越不稳',
  // —— 病程记录写法 ——
  '病程记录：患者双下肢肌力进行性下降，伴大小便失禁',
  '查体记录：会阴部皮肤感觉减退，鞍区麻木',
  '护理记录：患者近三日反复尿失禁，床单多次浸湿',
  // —— 更多病历 / 报告写法（应触发） ——
  '急诊病历：患者尿失禁伴会阴部麻木，拟进一步检查',
  '住院志：患者近一周双下肢无力加重，现需搀扶行走',
  '体格检查：双侧下肢肌力IV级，鞍区感觉减退',
  '护理交班记录：夜班发现患者尿湿床单三次，本人不知情',
  '出院小结：患者大便失禁，予以止泻及皮肤护理后好转',
  // —— 补足到 100 条（合计 60 应触发 / 30 否定日常 / 10 正常报告） ——
  '尿完还想尿，刚提上裤子又尿了',
  '屁眼周围发麻，坐着跟悬空一样',
  '两条腿软得像面条，一站就往下瘫',
  '脚尖翘不上来，比前些天更差了',
  '一夜没合眼，腰疼得直不起身子',
];

/** 30 条否定或日常说法（其中 12 条转述家人病情、12 条普通腰腿痛加重 / 发麻） */
const SHOULD_NOT_TRIGGER: string[] = [
  // —— 转述家人病情（不是本人症状） ——
  '我爸前列腺增生，老是尿不出来，我腰疼想问问',
  '我妈会阴部麻木去看了医生，我自己只是腰酸',
  '我奶奶大小便失禁住院了，我陪护累得腰疼',
  '我爸大小便失禁住院了，我陪护一周腰疼',
  '我爷爷摔了一跤住院，我这两天腰有点酸',
  '我老婆前几天发烧了我腰有点疼',
  '弟弟摔了一跤我自己腰痛是久坐引起的',
  '孩子发烧了我请假在家照顾腰有点酸',
  '我妈妈糖尿病多年，我自己就是腰不得劲',
  '我爸有肺癌病史，我腰疼是累的',
  '我奶奶骨质疏松好多年了，我自己腰不疼',
  '我妈双腿没劲上下楼困难，我腰还行',
  // —— 普通腰腿痛加重 / 发麻（不是红旗） ——
  '腰腿痛反反复复，最近一周加重，右脚背偶尔发麻',
  '走路多了右腿酸胀发麻，休息后能好',
  '久坐后腰痛，起来走两步能缓解',
  '腰疼伴有右腿酸，咳嗽时不明显',
  '腰疼连着右腿发麻，站久了明显，躺下就好',
  '腰痛加重，左大腿外侧发麻，晚上能睡着',
  '这两天腰疼比前天重了点，弯腰系鞋带都费劲',
  '小腿外侧发麻越来越明显，脚趾头偶尔也麻',
  '腰部酸胀感越来越重，下午尤其明显',
  '腿麻比以前明显了，但走路没问题',
  '坐办公室一下午，腰痛加重，左边屁股往下窜着麻',
  '早上起床腰疼，洗漱后好转',
  // —— 否定 / 已解释 / 天气 / 医嘱示例 ——
  '没有大小便异常，会阴不麻，双腿有力',
  '下肢肌力5级，病理征未引出',
  '上周发烧是因为扁桃体发炎，现在腰不疼',
  '天气预报说明天高温39度，出门注意',
  '医生建议卧床休息两周，避免弯腰搬重物',
  '看恐怖片吓得差点尿裤子，哈哈，腰倒是没事',
];

/** 10 段正常报告 / 病历原文（不能命中任何红旗） */
const NORMAL_REPORTS: string[] = [
  '腰椎MRI平扫：腰椎序列正常，生理曲度存在，L4/5、L5/S1椎间盘轻度退变，硬膜囊前脂肪间隙清晰。',
  '影像所见：腰椎诸骨骨质增生，L5/S1椎间盘后突约3mm，相应硬膜囊前缘受压。诊断：腰椎间盘突出症。',
  '腰椎CT：L4/5椎间盘膨出，椎管容积尚可，黄韧带无明显增厚。',
  '检验：血常规未见明显异常，CRP 3 mg/L，ESR 8 mm/h。',
  '门诊病历：患者腰痛3周，久坐加重，无双下肢放射痛，无大小便障碍。诊断：腰肌劳损。处理：理疗+功能锻炼。',
  '查体：腰椎活动受限，L4/5棘突旁压痛，直腿抬高试验阴性，下肢肌力V级。',
  '病程记录：患者神志清，精神可，大小便正常，睡眠可，体重无明显变化。',
  '复查MRI：与原片对比，硬膜囊受压程度相仿，椎间盘突出无增大。',
  'X线（腰椎正侧位）：脊柱侧弯，腰椎退行性变，椎间隙未见明显狭窄。',
  '出院小结：腰椎间盘突出症，予以卧床、止痛、营养神经治疗，好转后出院。',
];

let seq = Math.floor(Math.random() * 1e8);

async function req(url: string, method = 'GET', data?: unknown, token?: string) {
  const res = await fetch(BASE + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: data ? JSON.stringify(data) : undefined,
  });
  return { status: res.status, body: (await res.json().catch(() => null)) as any };
}

/** 新用户 + 新病程（高危红旗会停掉整个账号的个性化分析，必须一人一条） */
async function newUserAndEpisode(): Promise<{ token: string; episodeId: string }> {
  const phone = '137' + String((seq += 1) % 1e8).padStart(8, '0');
  const login = await req('/auth/login', 'POST', { phone, code: '123456' });
  const token = login.body?.data?.token as string;
  if (!token) throw new Error(`登录失败：${login.body?.message ?? '未知原因'}`);
  await req('/auth/consents', 'POST', { scope: '健康信息处理' }, token);
  const ep = await req('/episodes', 'POST', { title: '第七轮自编用例' }, token);
  return { token, episodeId: ep.body.data.id as string };
}

/** 提交分析，判断是否命中红旗（high 40911 / medium 40910 / 带 safety_notice） */
async function flagged(text: string): Promise<boolean> {
  const { token, episodeId } = await newUserAndEpisode();
  const r = await req('/analyses', 'POST', { episode_id: episodeId, symptom_change: text }, token);
  const notice = r.body?.data?.safety_notice;
  return (
    r.body?.code === 40910 ||
    r.body?.code === 40911 ||
    (r.status === 202 && Boolean(notice)) ||
    (r.status === 200 && Boolean(notice))
  );
}

async function main() {
  const missed: string[] = [];
  const falsePositives: string[] = [];
  const recordStyle = SHOULD_TRIGGER.filter((t) => /病历|记录|入院|出院|查体|护理|病程记录/.test(t));
  const familyStyle = SHOULD_NOT_TRIGGER.filter((t) => /我(爸|妈|爷爷|奶奶|老婆|孩子|弟弟|爸爸|母亲|父亲)/.test(t));
  const ordinaryStyle = SHOULD_NOT_TRIGGER.filter((t) => /麻|疼|痛|酸|胀/.test(t) && !/我(爸|妈|爷爷|奶奶|老婆|孩子|弟弟)/.test(t));

  for (const t of SHOULD_TRIGGER) {
    if (!(await flagged(t))) {
      missed.push(t);
      console.log('MISS', t);
    }
  }
  for (const t of SHOULD_NOT_TRIGGER) {
    if (await flagged(t)) {
      falsePositives.push(t);
      console.log('FP', t);
    }
  }
  for (const t of NORMAL_REPORTS) {
    if (await flagged(t)) {
      falsePositives.push(t);
      console.log('FP(REPORT)', t);
    }
  }

  console.log('');
  console.log(`应触发：${SHOULD_TRIGGER.length} 条，命中 ${SHOULD_TRIGGER.length - missed.length} 条` +
    `（其中病历 / 报告写法 ${recordStyle.length} 条，命中 ${recordStyle.length - missed.filter((t) => recordStyle.includes(t)).length} 条）`);
  console.log(`否定 / 日常：${SHOULD_NOT_TRIGGER.length} 条，误判 ${falsePositives.filter((t) => SHOULD_NOT_TRIGGER.includes(t)).length} 条` +
    `（转述家人 ${familyStyle.length} 条、普通腰腿痛 ${ordinaryStyle.length} 条）`);
  console.log(`正常报告：${NORMAL_REPORTS.length} 段，误判 ${falsePositives.filter((t) => NORMAL_REPORTS.includes(t)).length} 段`);
  console.log(
    `合计：命中率 ${(((SHOULD_TRIGGER.length - missed.length) / SHOULD_TRIGGER.length) * 100).toFixed(1)}%，` +
      `误判率 ${((falsePositives.length / (SHOULD_NOT_TRIGGER.length + NORMAL_REPORTS.length)) * 100).toFixed(1)}%`,
  );
  if (missed.length > 0) console.log('未命中：', missed.join(' | '));
  if (falsePositives.length > 0) console.log('误判：', falsePositives.join(' | '));
  process.exitCode = missed.length + falsePositives.length > 0 ? 1 : 0;
}

void main();
