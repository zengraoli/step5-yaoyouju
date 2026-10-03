/**
 * 安全规则补充用例（严格验收反馈第 1、2 条）。
 *
 * 约 97 条自编红旗说法 / 否定或日常说法 / 正常报告描述，逐条用**新病程**重跑：
 * 早期版本把所有说法提交到同一个病程，第一条命中后后面每条都因为「病程已有红旗」
 * 被计为通过，掩盖了大量未命中的说法。这里每条都用新病程，报告真实命中率与误判率。
 *
 * 用法：先启动 server（npm run dev），再执行
 *   node scripts/redflag-cases.mjs
 */
const BASE = process.env.API_BASE_URL ?? 'http://127.0.0.1:3200'

/** 应触发的红旗说法（口语 / 书面语 / 错别字 / 语序变化） */
export const RED = [
  // 会阴 / 鞍区感觉
  '昨晚不小心尿裤子了自己都没感觉到',
  '屁股中间那块麻麻的没感觉',
  '屁股中间那一圈摸着没感觉了',
  '坐马桶的时候屁股底下像隔了一层布',
  '会阴部像坐过粽子一样麻',
  '下面麻麻的，使不上劲',
  '肛门周围发木',
  '蛋蛋发麻',
  '屁股沟那一带木木的',
  '会阴部没有感觉了',
  '下身木木的，坐久了更明显',
  '菊花周围一圈发麻',
  '生殖器周围麻木',
  // 下肢无力 / 行走
  '左脚背翘不起来了',
  '右脚抬不起来走路拖着脚',
  '双下肢肌力进行性下降',
  '腿麻木无力加重了',
  '双腿突然没力气站不起来',
  '两条腿跟灌了铅一样抬不起来',
  '右腿从上周开始一点点没力气',
  '腿软，上楼要扶扶手',
  '走五十米就得歇',
  '脚翘不起来（足下垂）',
  '最近老摔跤，腿不听使唤',
  '左脚背发麻，走路像踩棉花',
  '右脚底木木的',
  '腿越来越沉，拖地走',
  '双腿像绑了沙袋',
  '右腿抬不起来',
  '左腿使不上劲',
  '走路越来越费劲',
  '腿不听使唤，老是磕碰',
  '双下肢无力',
  // 大小便控制
  '大便失控了两回',
  '屎尿都兜不住了',
  '小便失噤好几次了',
  '这两天憋不住尿裤子都湿了',
  '大便拉在身上了自己没察觉',
  '一天要上十次厕所却尿不出多少',
  '尿线变细，要使劲才能尿出来',
  '小肚子胀，尿潴留',
  '大便失禁，自己不知道',
  '大便在裤子里了',
  '憋不住尿，咳嗽就漏',
  '大小便控制出现变化',
  '这两天大小便控制困难',
  '大便憋不住',
  '尿不出来',
  '解不出小便',
  // 夜间痛 / 发热 / 体重
  '夜里三点疼醒，白天反而轻些',
  '夜间静止时痛得更厉害',
  '晚上只能睡两小时',
  '晚上一躺下腰就痛',
  '夜里发烧到 38.5',
  '腰疼伴着打寒战',
  '低烧两周了，腰痛也加重',
  '四个月瘦了二十斤',
  '没节食也瘦了一圈',
  '裤子腰围大了一圈',
  '没减肥体重却掉了七八公斤',
  '夜里盗汗，体重掉得厉害',
  // 肿瘤史 / 外伤 / 剧痛
  '三年前胃癌手术后，最近腰痛',
  '乳腺癌化疗期间腰痛',
  '有肿瘤家族史加腰痛',
  '两周前从梯子上摔下来，腰痛越来越重',
  '车祸后腰痛持续加重',
  '搬花盆闪到腰，之后越来越痛',
  '我三年前得过乳腺癌',
  '有肺癌病史最近腰痛越来越重',
  '腰疼还一直发高烧39度',
  '疼得受不了',
  '腰疼得死去活来',
  '疼得直不起腰',
  '夜里疼得睡不着',
]

/** 否定或日常说法（不能误判为红旗） */
export const NEG = [
  '会阴部感觉好多了，没再发麻',
  '不麻了，昨天麻今天没麻',
  '双腿完全有劲，能跑能跳',
  '肌力五级，正常',
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
  '会阴部没有麻木，大小便也正常',
  '会阴部没有麻木，大小便也正常，可以正常上班',
  '孩子发烧了我请假在家照顾腰有点酸',
  '我老婆前几天发烧了我腰有点疼',
  '弟弟摔了一跤我自己腰痛是久坐引起的',
  '没有大小便失禁，会阴不麻，下肢有力',
  '大小便控制可，无异常',
  '不发烧，无外伤史',
  '否认肿瘤病史',
  '无尿潴留，无排尿困难',
  '否认行走不稳',
  '下肢无萎缩',
  '没有明显体重下降',
  '疼痛可以忍受，不影响睡眠',
  '每天久坐8小时腰酸，活动后缓解',
  '腰痛三年，与天气有关',
  '贴了膏药后感觉轻松些',
  '最近睡眠差，腰有点酸',
  '不小心撞了一下桌子，腰没事',
]

/** 正常报告 / 门诊记录（不能误判） */
export const NORMAL_REPORT = [
  '腰椎 MRI 平扫：腰椎序列正常，生理曲度存在。L4/5 椎间盘轻度退变，相应水平椎管稍窄。结论：轻度腰椎退行性改变。',
  '影像所见：L3/4、L4/5 椎间盘信号减低，T2 加权像髓核信号减低，考虑椎间盘退变。硬膜囊前脂肪间隙清晰。',
  'X 线：腰椎生理曲度变直，椎体边缘轻度增生。',
  '检查所见无异常；双侧椎间孔未见明显狭窄。',
  'MRI：T11-L2 椎体及椎间盘未见确切异常，脊髓信号未见异常。',
  '腰椎正侧位片：椎体形态如常，无滑脱。',
  '体格检查：脊柱无侧弯，棘突无压痛，直腿抬高试验阴性，双下肢肌力5级，感觉正常，病理征未引出。',
  '门诊病历：患者因腰痛就诊，无发热，无外伤史，否认大小便异常，会阴区无麻木，下肢无进行性无力。诊断：腰肌劳损。',
  '门诊记录：……无大小便异常，会阴区无麻木，下肢无进行性无力。诊断：腰肌劳损。',
  '患者否认大小便失禁及会阴部麻木，查体未见异常，诊断：腰肌劳损。',
  '腰椎CT：L5/S1椎间盘轻度膨出，硬膜囊无明显受压，椎间孔无明显狭窄，椎旁软组织未见异常。',
  '腰椎MRI：腰4/5、腰5/骶1椎间盘轻度退变，未见脊髓及神经根明显受压征象，无椎旁脓肿。',
  '复查报告：与上次相比椎间盘退变程度无明显变化，椎间隙无进一步狭窄，序列稳定。',
]

async function req(url, method = 'GET', data, token) {
  const res = await fetch(BASE + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: data ? JSON.stringify(data) : undefined,
  })
  return { status: res.status, body: await res.json().catch(() => null) }
}

let pass = 0
let fail = 0
const missed = []
const falsePositives = []

/**
 * 每条说法都用「新用户 + 新病程」：
 * 命中高危红旗后该账号会停止个性化分析（产品红线第 3 条，第七轮第 4 条），
 * 因此复用一个用户会让后面的用例全部被拦住，统计失真。
 */
async function newUser() {
  const phone = '139' + String(seq += 1).padStart(8, '0')
  const login = await req('/auth/login', 'POST', { phone, code: '123456' })
  const token = login.body?.data?.token
  if (!token) throw new Error(`登录失败：${login.body?.message ?? '未知原因'}`)
  await req('/auth/consents', 'POST', { scope: '健康信息处理' }, token)
  return token
}

let seq = Math.floor(Math.random() * 1e8)

async function main() {
  /**
   * 每条说法都用新病程。命中即算触发：
   * - high 级（会阴麻木 / 下肢无力 / 大小便控制）→ 40911 或 40910，不建任务；
   * - medium 级（夜痛 / 发热 / 体重 / 肿瘤史 / 外伤 / 剧痛）→ 202 建任务但附带 safety_notice，
   *   客户端据此展示就医提示（个性化分析仍生成）。
   */
  async function blocked(text) {
    const token = await newUser()
    const ep = await req('/episodes', 'POST', { title: '安全规则用例' }, token)
    const r = await req('/analyses', 'POST', { episode_id: ep.body.data.id, symptom_change: text }, token)
    const notice = r.body.data?.safety_notice
    return (
      r.body.code === 40910 ||
      r.body.code === 40911 ||
      (r.status === 202 && Boolean(notice)) ||
      (r.status === 200 && Boolean(notice))
    )
  }

  for (const t of RED) {
    const hit = await blocked(t)
    if (hit) pass += 1
    else {
      fail += 1
      missed.push(t)
      console.log('MISS', t)
    }
  }
  for (const t of NEG) {
    const hit = await blocked(t)
    if (!hit) pass += 1
    else {
      fail += 1
      falsePositives.push(t)
      console.log('FP', t)
    }
  }
  for (const t of NORMAL_REPORT) {
    const hit = await blocked(t)
    if (!hit) pass += 1
    else {
      fail += 1
      falsePositives.push(t)
      console.log('FP(REPORT)', t)
    }
  }

  console.log('')
  console.log(`红旗命中：${RED.length - missed.length}/${RED.length}`)
  console.log(`否定 / 日常 / 正常报告不误判：${NEG.length + NORMAL_REPORT.length - falsePositives.length}/${NEG.length + NORMAL_REPORT.length}`)
  if (missed.length > 0) console.log('未命中：', missed.join(' | '))
  if (falsePositives.length > 0) console.log('误判：', falsePositives.join(' | '))
  console.log(`附加用例：通过 ${pass}，失败 ${fail}`)
  process.exitCode = fail > 0 ? 1 : 0
}

import { fileURLToPath } from 'node:url'
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (isMain) {
  main().catch((e) => {
    console.error('用例执行失败:', e instanceof Error ? e.message : e)
    process.exit(1)
  })
}
