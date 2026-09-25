import { DbService } from '../db/db.service';
import { APP_DDL, ensureEvidenceColumns } from '../db/schema';
import { consumeOneTask } from '../modules/analyses/analysis-pipeline';
import { LocalMockAdapter } from '../modules/analyses/model-adapter';
import { LocalEvidenceRetriever } from '../modules/evidence/evidence-retrieval';

/**
 * AI 任务 Worker（独立进程：npm run worker = tsx src/worker/main.ts）。
 *
 * 轮询 SQLite analysis_task 表，消费排队中的分析任务（docs/system-design.md 第 5 节）：
 * 受控检索（仅证据库）→ 大模型适配层生成与引用核对 → 保存分析版本。
 * 不依赖 Nest 容器，只共享 db.service 等纯 TS 模块；演示实现用本地模拟适配层，不调用外部服务。
 */

const POLL_INTERVAL_MS = Number(process.env.WORKER_POLL_INTERVAL_MS ?? 1500);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const db = new DbService();
  // 确保表存在（IF NOT EXISTS，幂等）；演示种子数据由 API 服务启动时写入
  db.app.exec(APP_DDL);
  ensureEvidenceColumns(db.app);

  const adapter = new LocalMockAdapter();
  const retriever = new LocalEvidenceRetriever(db.app);
  let running = true;
  const stop = () => {
    running = false;
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  console.log(`[worker] AI 任务 Worker 已启动，轮询间隔 ${POLL_INTERVAL_MS}ms（适配层：${adapter.name}）`);

  while (running) {
    try {
      const r = consumeOneTask(db.app, adapter, retriever);
      if (r.processed) {
        if (r.status === 'completed') {
          console.log(`[worker] 任务 ${r.taskId} 已完成，生成分析 ${r.analysisId}`);
        } else if (r.status === 'failed') {
          console.warn(`[worker] 任务 ${r.taskId} 失败（回退）：${r.reason}`);
        } else {
          console.warn(`[worker] 任务 ${r.taskId} 将重试：${r.reason}`);
        }
      }
    } catch (err) {
      // 单次处理异常不应中断轮询
      console.error('[worker] 处理任务出错:', err instanceof Error ? err.message : err);
    }
    await sleep(POLL_INTERVAL_MS);
  }

  console.log('[worker] 已停止');
  db.app.close();
  db.identity.close();
}

// 仅当作为主模块运行时启动轮询；被 import 时不启动（便于测试复用 consumeOneTask）
if (require.main === module) {
  main().catch((err) => {
    console.error('[worker] 启动失败:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
