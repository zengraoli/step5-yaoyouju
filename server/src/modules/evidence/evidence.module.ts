import { Module } from '@nestjs/common';
import { DbModule } from '../../db/db.module';
import { AuditService } from '../../common/audit.service';
import { EvidenceService } from './evidence.service';
import { EvidenceController } from './evidence.controller';

/**
 * 医学证据库（B05 / EVIDENCE_DOC、EVIDENCE_CHUNK，docs/system-design.md 第 3 节）。
 *
 * T11：
 * - 证据文档管理（来源类型 / 许可 / 核实日期 / 启用状态，带片段数与被引用数）；
 * - 切分入库管线（POST /evidence/{id}/ingest、GET /evidence/{id}/pipeline，幂等）；
 * - 本地检索（POST /evidence/search，关键词 + 本地向量混合打分，只在证据库内、只检索启用中的文档）；
 * - 停用影响预览（列出引用该证据的分析与内容）。
 *
 * 演示实现用「证据片段表 + 本地检索」替代原设计的 pgvector 向量库（见 docs/brief.md）。
 * analyses（分析编排）与 qa（问与解释）复用本模块的检索实现（evidence-retrieval.ts）。
 */
@Module({
  imports: [DbModule],
  controllers: [EvidenceController],
  providers: [EvidenceService, AuditService],
  exports: [EvidenceService],
})
export class EvidenceModule {}
