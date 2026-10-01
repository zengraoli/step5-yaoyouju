/**
 * 安全规则新增用例（严格验收第四轮：反馈里从没出现过的说法）。
 *
 * 共 92 条：45 条应触发 / 27 条否定或日常说法 / 20 段正常报告，每条用**新病程**重跑，
 * 报告命中率与误判率。用例全部新编，与反馈列表和 redflag-cases.mjs 不重复。
 *
 * 用法：先启动 server（npm run dev），再执行
 *   node scripts/redflag-extra.mjs
 */
const BASE = process.env.API_BASE_URL ?? 'http://127.0.0.1:3200'

/** 应触发（45）——口语 / 错别字 / 语序变化，反馈里没出现过 */
export const RED = [
  '屁股沟里那块肉木木的，擦屁股都没感觉',
  '下面像打了麻药一样没知觉',
  '会阴那块热辣辣地发麻',
  '下身一阵阵发麻，坐久了更明显',
  '大腿根那一圈发木',
  '菊花边上麻麻的',
  '睾丸附近发麻',
  '屁股中间那条沟按着没感觉',
  '腰以下像隔着一层棉裤',
  '左脚大拇指翘不起来',
  '右脚脚踝勾不上来',
  '两条腿一点劲都使不上',
  '腿软得跪下去了',
  '走路像踩在棉花上，深一脚浅一脚',
  '腿越来越沉，抬腿费劲',
  '膝盖发软打弯',
  '上下楼要手脚并用',
  '走两步就得扶墙',
  '夜里尿湿了床单',
  '尿在裤子里了才知道',
  '大便不受控制地流出来',
  '想尿却尿不出来，小肚子憋得慌',
  '尿意来了憋不住，还没到厕所就尿了',
  '排便要用很大力，汗都出来了',
  '大便干燥加重，一周才解一次',
  '晚上被疼醒三四回',
  '夜里腰疼得翻不了身',
  '静息时也疼，躺下更厉害',
  '夜里盗汗把枕头浸湿',
  '半年瘦了6公斤',
  '体重掉了十斤，裤腰松了两扣',
  '吃得多却一直掉秤',
  '反复低烧一个月',
  '发烧到39度2，腰像断了一样',
  '五年前做过结肠癌手术，现在腰痛',
  '甲状腺癌术后两年，最近腰疼得睡不着',
  '化疗后腰痛越来越重',
  '从二楼摔下来过以后腰一直疼',
  '被电动车撞了之后腰痛加重',
  '搬冰箱闪到腰，之后疼得下不了床',
  '腰疼得满头大汗',
  '疼得想撞墙',
  '腰疼得像被撕开一样',
  '夜里疼得直打滚',
  '疼得受不了，一夜没合眼',
]

/** 否定或日常说法（27）——不能误判 */
export const NEG = [
  '屁股有点凉，不是麻',
  '腿上有点酸，走路正常',
  '昨天腿麻，今天好了',
  '腿没什么力气，可能是没睡好',
  '大小便正常，一天一次',
  '排尿有点费劲，喝水后就好了',
  '这几天大便偏干，多吃蔬菜就好',
  '夜里偶尔醒，不是疼醒的',
  '最近瘦了四五斤，我在刻意减肥',
  '体重轻了一点，胃口很好',
  '白天有点低烧，医生说是感冒',
  '三年前做过阑尾炎手术，和腰没关系',
  '我妈上个月摔了一跤，我腰没事',
  '孩子他爸出了车祸，我就是久坐腰酸',
  '去年扭过腰，早就好了',
  '不小心在门上碰了一下胳膊',
  '腰有点酸，贴了膏药好多了',
  '久坐后腰酸，起身走走就缓解',
  '阴天下雨腰有点不得劲',
  '来例假的时候腰酸',
  '抱孩子抱久了腰酸',
  '睡觉落枕了，脖子疼',
  '腿抽筋，补了钙好一些',
  '爬完山腿酸，休息两天就好',
  '体检一切正常',
  '报告写着未见异常',
  '大小便通畅，无特殊不适',
]

/** 正常报告 / 门诊记录（20）——不能误判 */
export const NORMAL_REPORT = [
  '腰椎正侧位X线：生理曲度存在，椎体边缘略增生，椎间隙无狭窄。',
  'MRI提示：L3/4、L4/5椎间盘轻度退变，纤维环完整，脊髓形态信号正常。',
  'CT：腰椎诸骨骨质结构正常，未见骨折征象，椎管通畅。',
  'B超：双肾、输尿管、膀胱未见明显异常。',
  '血常规：白细胞 6.2×10^9/L，中性粒细胞比例正常；C反应蛋白 <5 mg/L。',
  '尿常规：未见白细胞、红细胞及蛋白。',
  '体格检查：双下肢肌力V级，肌张力正常，感觉对称存在，病理征未引出。',
  '直腿抬高试验（-），加强试验（-），坐骨神经压痛（-）。',
  '门诊病历：腰痛2月，久坐加重，活动后缓解；无发热、无外伤、二便正常。',
  '处理：避免久坐，腰背肌功能锻炼，2周后复查。',
  '腰椎MRI：腰5骶1椎间盘轻度膨出，硬膜囊前脂肪线清晰，椎间孔无狭窄。',
  'DR：骨盆各骨未见异常，骶髂关节间隙正常。',
  '核磁增强：未见异常强化灶。',
  '住院记录：患者神志清楚，生命体征平稳，心肺腹未见异常。',
  '出院小结：腰痛症状缓解，嘱腰背肌锻炼，门诊随访。',
  '检验报告：肝肾功能、电解质均在正常范围。',
  '心电图：窦性心律，正常心电图。',
  '脊柱外科会诊：考虑腰背肌筋膜炎，建议康复理疗，暂不需手术。',
  '护理记录：患者可自行翻身、坐起，二便自控。',
  '随访记录：疼痛评分由6分降至3分，继续功能锻炼。',
]

async function req(url, method = 'GET', data, token) {
  const res = await fetch(BASE + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: data ? JSON.stringify(data) : undefined,
  })
  return { status: res.status, body: await res.json().catch(() => null) }
}

const missed = []
const falsePositives = []

async function main() {
  const phone = '139' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0')
  const login = await req('/auth/login', 'POST', { phone, code: '123456' })
  const token = login.body?.data?.token
  if (!token) throw new Error(`登录失败：${login.body?.message ?? '未知原因'}`)
  await req('/auth/consents', 'POST', { scope: '健康信息处理' }, token)

  /** 每条说法都用新病程；命中 = 40910 / 40911（high）或带 safety_notice（medium） */
  async function triggered(text) {
    const ep = await req('/episodes', 'POST', { title: '新增用例' }, token)
    const r = await req('/analyses', 'POST', { episode_id: ep.body.data.id, symptom_change: text }, token)
    return (
      r.body.code === 40910 ||
      r.body.code === 40911 ||
      (r.status === 202 && Boolean(r.body.data?.safety_notice)) ||
      (r.status === 200 && Boolean(r.body.data?.safety_notice))
    )
  }

  let redHit = 0
  for (const t of RED) {
    if (await triggered(t)) redHit += 1
    else {
      missed.push(t)
      console.log('MISS', t)
    }
  }
  let negOk = 0
  for (const t of NEG) {
    if (!(await triggered(t))) negOk += 1
    else {
      falsePositives.push(t)
      console.log('FP', t)
    }
  }
  let reportOk = 0
  for (const t of NORMAL_REPORT) {
    if (!(await triggered(t))) reportOk += 1
    else {
      falsePositives.push(t)
      console.log('FP(REPORT)', t)
    }
  }

  const hitRate = ((redHit / RED.length) * 100).toFixed(1)
  const fpRate = (((NEG.length - negOk) + (NORMAL_REPORT.length - reportOk)) / (NEG.length + NORMAL_REPORT.length) * 100).toFixed(1)
  console.log('')
  console.log(`应触发命中率：${hitRate}%（${redHit}/${RED.length}）`)
  console.log(`否定 / 日常 / 正常报告误判率：${fpRate}%（${NEG.length + NORMAL_REPORT.length - negOk - reportOk}/${NEG.length + NORMAL_REPORT.length}）`)
  if (missed.length) console.log('未命中：', missed.join(' | '))
  if (falsePositives.length) console.log('误判：', falsePositives.join(' | '))
  process.exitCode = missed.length === 0 && falsePositives.length === 0 ? 0 : 1
}

import { fileURLToPath } from 'node:url'
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (isMain) {
  main().catch((e) => {
    console.error('用例执行失败:', e instanceof Error ? e.message : e)
    process.exit(1)
  })
}
