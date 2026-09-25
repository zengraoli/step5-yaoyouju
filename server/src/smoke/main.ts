/**
 * 端到端冒烟脚本（T15）：依次跑通服务端用户主流程，并另跑红旗命中分支。
 *
 * 前置条件：API 服务已在 3200 运行。脚本先探测 /health，未运行则给出明确提示并以非 0 退出。
 * Worker：由本脚本以子进程启动（tsx src/worker/main.ts，node:child_process spawn），消费完任务后关闭。
 * 数据隔离：使用独立测试手机号 13700008888（登录自动创建），不污染种子演示用户数据；
 *           测试产生的数据仅归属该测试用户，演示无害，默认保留（可重复运行）。
 *
 * 运行：npm run smoke
 * 全部通过输出「SMOKE OK」并以 0 退出；任何一步失败打印明确原因并以非 0 退出。
 */
import { spawn, type ChildProcess } from 'node:child_process';
import * as path from 'node:path';

const BASE = process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:3200';
const SERVER_DIR = process.cwd();
const TEST_PHONE = '13700008888';
const TEST_CODE = process.env.DEMO_SMS_CODE ?? '123456';

/** 主流程报告原文（含术语，无红旗） */
const REPORT_TEXT =
  '腰椎 MRI 平扫：腰椎生理曲度变直。L5/S1 椎间盘轻度膨出，硬膜囊前缘轻度受压。椎体形态信号未见明显异常。报告未描述下肢肌力情况。';

/** 红旗命中文本（会阴部麻木 + 大小便控制困难，均 high 级） */
const RED_FLAG_TEXT = '会阴部麻木，大小便控制困难';

interface ApiResp {
  code: number;
  // 松类型：冒烟脚本只做结构断言，不依赖严格 DTO 类型
  data: any;
  message: string;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const log = (msg: string): void => {
  console.log(msg);
};

const step = (n: number, total: number, title: string): void => {
  log(`\n[${n}/${total}] ${title}`);
};

const pass = (msg: string): void => {
  log(`  ✔ ${msg}`);
};

/** 冒烟失败：携带明确原因，交由顶层统一打印并以非 0 退出 */
class SmokeError extends Error {}

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new SmokeError(msg);
}

async function api(
  method: string,
  urlPath: string,
  opts: { token?: string; body?: unknown } = {},
): Promise<{ status: number; json: ApiResp }> {
  const headers: Record<string, string> = {};
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  let body: string | undefined;
  if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  let res: Response;
  try {
    res = await fetch(`${BASE}${urlPath}`, { method, headers, body });
  } catch (err) {
    throw new SmokeError(`请求 ${method} ${urlPath} 网络失败：${err instanceof Error ? err.message : String(err)}`);
  }
  const text = await res.text();
  let json: ApiResp;
  try {
    json = JSON.parse(text) as ApiResp;
  } catch {
    throw new SmokeError(`${method} ${urlPath} 返回非 JSON（HTTP ${res.status}）：${text.slice(0, 200)}`);
  }
  return { status: res.status, json };
}

async function withTimeout<T>(p: Promise<T>, ms: number, msg: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new SmokeError(msg)), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

// ---------- Worker 子进程 ----------

function startWorker(): { worker: ChildProcess; ready: Promise<void> } {
  const tsxCli = path.join(SERVER_DIR, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const worker = spawn(process.execPath, [tsxCli, 'src/worker/main.ts'], {
    cwd: SERVER_DIR,
    env: { ...process.env, WORKER_POLL_INTERVAL_MS: process.env.WORKER_POLL_INTERVAL_MS ?? '300' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let resolved = false;
  let resolveReady: () => void = () => {};
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });
  const onData = (buf: Buffer): void => {
    for (const line of buf.toString().split(/\r?\n/)) {
      if (!line.trim()) continue;
      log(`    [worker] ${line}`);
      if (!resolved && line.includes('已启动')) {
        resolved = true;
        resolveReady();
      }
    }
  };
  worker.stdout?.on('data', onData);
  worker.stderr?.on('data', onData);
  worker.on('exit', (code, signal) => {
    log(`    [worker] 子进程退出（code=${code} signal=${signal}）`);
    if (!resolved) {
      resolved = true;
      resolveReady();
    }
  });
  return { worker, ready };
}

async function stopWorker(worker: ChildProcess): Promise<void> {
  if (worker.exitCode === null && worker.signalCode === null) {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        try {
          worker.kill('SIGKILL');
        } catch {
          // 忽略
        }
        resolve();
      }, 3000);
      worker.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
      try {
        worker.kill('SIGTERM');
      } catch {
        clearTimeout(timer);
        resolve();
      }
    });
  }
  // 销毁父进程侧的管道读句柄，避免 Windows 上 process.exit 时 libuv 断言
  worker.stdout?.destroy();
  worker.stderr?.destroy();
}

// ---------- 主流程 ----------

async function main(): Promise<void> {
  const TOTAL = 10;
  log('腰有据服务端冒烟测试（T15）');
  log(`目标：${BASE}；测试手机号：${TEST_PHONE}`);

  // 0. 探测 API 服务是否已运行
  step(0, TOTAL, '检查 API 服务（/health）');
  try {
    const { status, json } = await api('GET', '/health');
    assert(status === 200 && json.code === 0, `/health 返回异常（HTTP ${status}, code ${json.code}）`);
    pass(`API 服务已在运行（/health db=${json.data?.db}）`);
  } catch (err) {
    log(`  ✘ 无法连接 ${BASE}：${err instanceof Error ? err.message : String(err)}`);
    log('  请先在另一个终端启动 API 服务：npm run dev（端口 3200），再运行 npm run smoke');
    process.exit(2);
  }

  // 启动 Worker 子进程
  log('\n启动 AI 任务 Worker 子进程（tsx src/worker/main.ts）…');
  const { worker, ready } = startWorker();
  try {
    await withTimeout(ready, 20000, 'Worker 启动超时（20s）');
    assert(worker.exitCode === null, 'Worker 子进程启动后即退出，请检查 Worker 日志');
    pass('Worker 子进程已启动并就绪');

    let token = '';
    let episodeId = '';
    let reportId = '';
    let reportCareEventId = '';
    let analysisId = '';

    // 1. 登录
    step(1, TOTAL, `登录（${TEST_PHONE}）`);
    {
      const { status, json } = await api('POST', '/auth/login', {
        body: { phone: TEST_PHONE, code: TEST_CODE },
      });
      // 注意：NestJS @Post() 默认返回 201，故接受 200 / 201
      assert((status === 200 || status === 201) && json.code === 0, `登录失败：code=${json.code} message=${json.message}`);
      assert(typeof json.data?.token === 'string' && json.data.token.length > 0, '登录未返回 token');
      token = json.data.token as string;
      pass('登录成功，已获取 token');
    }

    // 2. 同意（健康信息处理）
    step(2, TOTAL, '同意健康信息处理');
    {
      const { json } = await api('POST', '/auth/consents', {
        token,
        body: { scope: '健康信息处理' },
      });
      assert(json.code === 0, `同意失败：${json.message}`);
      const granted = Array.isArray(json.data)
        ? json.data.some((c: { scope: string; granted: boolean }) => c.scope === '健康信息处理' && c.granted)
        : false;
      assert(granted, '同意记录中未看到已生效的「健康信息处理」');
      pass('已同意「健康信息处理」');
    }

    // 3. 关键变化确认（创建病程）
    step(3, TOTAL, '关键变化确认（创建病程）');
    {
      const { json } = await api('POST', '/episodes', {
        token,
        body: { title: '冒烟·久坐后腰痛', onset_date: '2026-09-20', onset_certainty: '已确认' },
      });
      assert(json.code === 0, `创建病程失败：${json.message}`);
      assert(typeof json.data?.id === 'string' && json.data.id.length > 0, '创建病程未返回 id');
      episodeId = json.data.id as string;
      pass(`病程已创建（id=${episodeId.slice(0, 8)}…）`);
    }

    // 4. 录入报告（粘贴文字）
    step(4, TOTAL, '录入报告（粘贴文字）');
    {
      const { json } = await api('POST', '/reports', {
        token,
        body: { episode_id: episodeId, raw_text: REPORT_TEXT, report_date: '2026-09-22' },
      });
      assert(json.code === 0, `录入报告失败：${json.message}`);
      assert(typeof json.data?.id === 'string', '录入报告未返回 id');
      reportId = json.data.id as string;
      reportCareEventId = (json.data.care_event_id as string) ?? '';
      assert(Array.isArray(json.data?.extracted_terms) && json.data.extracted_terms.length > 0, '报告未抽取到术语');
      pass(`报告已录入（id=${reportId.slice(0, 8)}…，术语 ${json.data.extracted_terms.length} 个）`);
    }

    // 5. 结构化核对
    step(5, TOTAL, '结构化核对（GET /episodes/{id}/structured）');
    {
      const { json } = await api('GET', `/episodes/${episodeId}/structured`, { token });
      assert(json.code === 0, `结构化核对失败：${json.message}`);
      assert(Array.isArray(json.data?.items) && json.data.items.length > 0, '结构化核对未返回条目');
      assert(typeof json.data?.summary === 'object', '结构化核对未返回汇总');
      pass(`结构化核对通过（共 ${json.data.items.length} 条，summary=${JSON.stringify(json.data.summary)}）`);
    }

    // 6. 生成分析（POST → 202 → Worker 消费 → 轮询 → 校验五段结构）
    step(6, TOTAL, '生成一页分析（POST /analyses → Worker → 轮询 → 校验）');
    let taskId = '';
    {
      const { status, json } = await api('POST', '/analyses', {
        token,
        body: { episode_id: episodeId, report_text: REPORT_TEXT },
      });
      assert(status === 202 && json.code === 0, `提交分析未返回 202（HTTP ${status}, code ${json.code}）`);
      assert(json.data?.status === 'queued', `提交分析状态异常：${JSON.stringify(json.data)}`);
      assert(typeof json.data?.task_id === 'string', '提交分析未返回 task_id');
      taskId = json.data.task_id as string;
      pass(`分析任务已创建（task=${taskId.slice(0, 8)}…，等待 Worker 消费）`);
    }
    {
      const start = Date.now();
      let done: any = null;
      while (Date.now() - start < 45000) {
        const { json } = await api('GET', `/analyses/task/${taskId}`, { token });
        assert(json.code === 0, `查询任务失败：${json.message}`);
        const st = json.data?.status;
        if (st === 'completed') {
          done = json.data;
          break;
        }
        if (st === 'failed') {
          throw new SmokeError(`分析任务失败（回退）：${json.data?.reason ?? '未知原因'}`);
        }
        await sleep(500);
      }
      assert(done !== null, '等待分析任务完成超时（45s），Worker 可能未消费');
      assert(typeof done.analysis?.id === 'string', '任务完成但未返回分析');
      analysisId = done.analysis.id as string;
      pass(`Worker 已消费任务并生成分析（analysis=${analysisId.slice(0, 8)}…）`);
    }
    {
      const { json } = await api('GET', `/analyses/${analysisId}`, { token });
      assert(json.code === 0, `获取分析详情失败：${json.message}`);
      const s = json.data?.sections;
      assert(s && typeof s === 'object', '分析缺少 sections');
      assert(Array.isArray(s.known) && s.known.length > 0, '分析 known 段为空');
      assert(Array.isArray(s.explain) && s.explain.length > 0, '分析 explain 段为空');
      assert(Array.isArray(s.unknown), '分析 unknown 段不是数组');
      assert(Array.isArray(s.next) && s.next.length > 0, '分析 next 段为空');
      assert(Array.isArray(s.videos), '分析 videos 段不是数组');
      for (const [i, item] of s.explain.entries()) {
        assert(Array.isArray(item?.citations) && item.citations.length > 0, `第 ${i + 1} 条解释缺少 citations`);
        for (const c of item.citations) {
          assert(typeof c?.evidence_doc_id === 'string' && c.evidence_doc_id.length > 0, `第 ${i + 1} 条解释的引用缺少 evidence_doc_id`);
          assert(typeof c?.statement === 'string' && c.statement.length > 0, `第 ${i + 1} 条解释的引用缺少 statement`);
        }
      }
      const disclaimer = (json.data?.disclaimer ?? s?.meta?.disclaimer ?? '') as string;
      assert(disclaimer.includes('不作诊断'), `disclaimer 未包含「不作诊断」：${disclaimer}`);
      pass(`五段结构完整，${s.explain.length} 条解释均带引用，disclaimer 含「不作诊断」`);
    }

    // 7. 原文对照（reports 接口校验术语位置 + analysis known 段 care_event_id）
    step(7, TOTAL, '原文对照（术语位置 + known 段 care_event_id）');
    {
      const { json } = await api('GET', `/reports/${reportId}`, { token });
      assert(json.code === 0, `获取报告详情失败：${json.message}`);
      const raw = json.data?.raw_text as string;
      const terms = json.data?.extracted_terms as { term: string; start: number; end: number }[];
      assert(typeof raw === 'string' && raw.length > 0, '报告详情缺少原文');
      assert(Array.isArray(terms) && terms.length > 0, '报告详情缺少术语');
      for (const t of terms) {
        assert(raw.slice(t.start, t.end) === t.term, `术语「${t.term}」位置校验失败（[${t.start},${t.end}] → 「${raw.slice(t.start, t.end)}」）`);
      }
      pass(`术语位置校验通过（${terms.map((t) => t.term).join('、')}）`);

      const { json: aJson } = await api('GET', `/analyses/${analysisId}`, { token });
      const known = aJson.data?.sections?.known as { care_event_id?: string }[];
      assert(Array.isArray(known) && known.length > 0, '分析 known 段为空');
      const hasCareEventId = known.some((k) => typeof k.care_event_id === 'string' && k.care_event_id.length > 0);
      assert(hasCareEventId, '分析 known 段未带 care_event_id，无法定位原文');
      if (reportCareEventId) {
        assert(
          known.some((k) => k.care_event_id === reportCareEventId),
          '分析 known 段未包含报告对应的 care_event_id',
        );
      }
      pass('known 段带 care_event_id，可定位到病程原文');
    }

    // 8. 记录今天（缺失字段显示「尚未确认」）
    step(8, TOTAL, '记录今天（POST /episodes/{id}/today-logs，校验缺失字段）');
    {
      const { json } = await api('POST', `/episodes/${episodeId}/today-logs`, {
        token,
        body: { sit_minutes: 30 },
      });
      assert(json.code === 0, `记录今天失败：${json.message}`);
      assert(json.data?.sit_minutes === 30, `sit_minutes 应为 30，实际 ${json.data?.sit_minutes}`);
      assert((json.data?.sit_minutes_display as string).includes('30'), `sit_minutes_display 异常：${json.data?.sit_minutes_display}`);
      assert(json.data?.planned_activity_done === '尚未确认', `planned_activity_done 应为「尚未确认」，实际 ${json.data?.planned_activity_done}`);
      assert(json.data?.sleep_impact_display === '尚未确认', `sleep_impact_display 应为「尚未确认」，实际 ${json.data?.sleep_impact_display}`);
      assert(json.data?.top_worry === '尚未确认', `top_worry 应为「尚未确认」，实际 ${json.data?.top_worry}`);
      assert(json.data?.leg_change === '尚未确认', `leg_change 应为「尚未确认」，实际 ${json.data?.leg_change}`);
      pass('已记录 sit_minutes=30，其余缺失字段均显示「尚未确认」');
    }

    // 9. 生成复诊摘要（生成 → 查询 → 纠正 → 导出文本，校验水印脚注）
    step(9, TOTAL, '生成复诊摘要（generate → get → 纠正 → 导出文本）');
    let summaryId = '';
    {
      const { json } = await api('POST', `/episodes/${episodeId}/followup/generate`, { token });
      assert(json.code === 0, `生成复诊摘要失败：${json.message}`);
      assert(typeof json.data?.id === 'string', '生成复诊摘要未返回 id');
      assert(Array.isArray(json.data?.content?.sections) && json.data.content.sections.length === 6, '复诊摘要不是固定六段');
      summaryId = json.data.id as string;
      pass(`复诊摘要已生成（summary=${summaryId.slice(0, 8)}…，六段齐全）`);
    }
    {
      const { json } = await api('GET', `/episodes/${episodeId}/followup`, { token });
      assert(json.code === 0, `查询复诊摘要失败：${json.message}`);
      assert(json.data?.id === summaryId, '查询到的摘要与刚生成的不一致');
      pass('查询最新复诊摘要一致');
    }
    {
      const sections = [
        { key: 'onset', title: '起病与时间', items: [{ text: '2026-09-20 起久坐后腰痛', source: '自述', verify_status: '已确认' }] },
        { key: 'symptom', title: '当前症状', items: [{ text: '腰部酸痛，起身活动可缓解', source: '自述', verify_status: '已确认' }] },
        { key: 'report', title: '检查与报告', items: [{ text: 'L5/S1 椎间盘轻度膨出', source: '报告原文', verify_status: '已确认' }] },
        { key: 'advice', title: '既往医嘱与行动', items: [{ text: '每 40 分钟起身活动', source: '医生记录', verify_status: '已确认' }] },
        { key: 'worry', title: '我的主要担心', items: [{ text: '担心是否加重（冒烟纠正补充）', source: '自述' }] },
        { key: 'questions', title: '想请医生确认的问题', items: [{ text: '是否需要复查下肢肌力', from: '用户加入' }] },
      ];
      const { json } = await api('PUT', `/episodes/${episodeId}/followup/${summaryId}`, {
        token,
        body: { sections },
      });
      assert(json.code === 0, `纠正复诊摘要失败：${json.message}`);
      assert(json.data?.corrected === true, '纠正后 corrected 应为 true');
      pass('复诊摘要已纠正（corrected=true）');
    }
    {
      const { json } = await api('POST', `/episodes/${episodeId}/followup/${summaryId}/export`, {
        token,
        body: { format: '文本' },
      });
      assert(json.code === 0, `导出复诊摘要失败：${json.message}`);
      const text = json.data?.text as string;
      assert(typeof text === 'string' && text.length > 0, '导出未返回文本');
      assert(text.includes('就诊交接摘要'), '导出文本缺少头部「就诊交接摘要」');
      assert(text.includes('不作诊断'), '导出文本缺少水印脚注（不作诊断）');
      assert(text.includes('本摘要已被用户纠正修改'), '导出文本未标注「已被用户纠正修改」');
      pass('导出文本含头部、水印脚注与纠正标记');
    }

    // 10. 红旗命中分支（应 40910/40911 + 就医提示 + 不创建任务）
    step(10, TOTAL, '红旗命中分支（POST /analyses 命中红旗）');
    {
      const { status, json } = await api('POST', '/analyses', {
        token,
        body: { episode_id: episodeId, symptom_change: RED_FLAG_TEXT },
      });
      assert(status === 409, `红旗命中应返回 HTTP 409，实际 ${status}`);
      assert(json.code === 40910 || json.code === 40911, `红旗命中应返回 40910/40911，实际 code=${json.code}`);
      assert(/就医|就诊|医院|评估|停止个性化/.test(json.message), `红旗命中 message 缺少就医提示：${json.message}`);
      const notice = json.data;
      assert(notice && typeof notice === 'object', '红旗命中未返回就医提示内容');
      const hasAdvice =
        (typeof notice.headline === 'string' && notice.headline.includes('就医')) ||
        (Array.isArray(notice.matched) && notice.matched.length > 0);
      assert(hasAdvice, '红旗命中的就医提示内容不完整');
      assert(notice.task_id === undefined && notice.status !== 'queued', '红旗命中不应创建任务');
      pass(`命中红旗返回 code=${json.code}，附就医提示，未创建任务`);
    }

    log('\n全部 10 个步骤通过。');
    log('SMOKE OK');
  } finally {
    await stopWorker(worker);
  }
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    const reason = err instanceof Error ? err.message : String(err);
    log(`\nSMOKE FAIL: ${reason}`);
    process.exit(1);
  });
