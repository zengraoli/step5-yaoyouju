import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { IsBoolean, IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';
import { EvidenceService } from './evidence.service';
import { CurrentUser } from '../../common/current-user.decorator';

/** 列表筛选：来源类型（指南 / 研究 / 审核科普）、启用状态 */
class ListEvidenceQuery {
  @IsOptional()
  @IsString()
  source_type?: string;

  /** 启用状态（查询字符串形式，避免隐式类型转换把 'false' 变成 true） */
  @IsOptional()
  @IsString()
  active?: string;
}

/** 新建 / 编辑证据文档 */
class EvidenceDocBody {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  source_type?: string;

  @IsOptional()
  @IsString()
  source_url?: string | null;

  @IsOptional()
  @IsString()
  license?: string | null;

  @IsOptional()
  @IsString()
  verified_at?: string | null;

  @IsOptional()
  @IsString()
  raw_text?: string | null;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

/** 新建证据文档（标题与来源类型必填） */
class EvidenceCreateBody {
  @IsString()
  @MaxLength(200)
  title!: string;

  @IsString()
  source_type!: string;

  @IsOptional()
  @IsString()
  source_url?: string | null;

  @IsOptional()
  @IsString()
  license?: string | null;

  @IsOptional()
  @IsString()
  verified_at?: string | null;

  @IsOptional()
  @IsString()
  raw_text?: string | null;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

/** 停用 / 启用 */
class EvidenceActiveBody {
  @IsBoolean()
  active!: boolean;

  @IsOptional()
  @IsString()
  reason?: string | null;
}

/** 检索（POST /evidence/search） */
class EvidenceSearchBody {
  @IsString()
  @MaxLength(2000)
  q!: string;

  @IsOptional()
  @IsNumber()
  limit?: number;
}

/**
 * 医学证据库（B05：来源类型 / 许可 / 核实日期；入库管线状态；停用影响预览）。
 *
 * 读接口（列表 / 详情 / 检索 / 管线状态 / 影响预览）与写接口（新建 / 编辑 / 停用启用 / 入库）
 * 都要求登录；写接口的 actor_id 记录到审计日志（T14 后台账号体系落地后改为后台身份）。
 */
@Controller('evidence')
export class EvidenceController {
  constructor(private readonly evidence: EvidenceService) {}

  /**
   * 证据库检索：关键词 + 本地向量相似度混合打分，只在证据库内、只检索启用中的文档。
   * 返回片段内容、所属文档标题 / 来源类型 / 许可、得分与 retrieval_snapshot。
   */
  @Post('search')
  searchByPost(@Body() body: EvidenceSearchBody) {
    return this.evidence.search(body.q, body.limit ?? 5);
  }

  /** 证据库检索（GET 形式，便于后台与联调直接验证） */
  @Get('search')
  searchByGet(@Query('q') q: string, @Query('limit') limit?: string) {
    const query = (q ?? '').trim();
    if (!query) {
      return this.evidence.search('', 0);
    }
    return this.evidence.search(query, parseLimit(limit));
  }

  /** 证据文档列表：来源类型 / 启用状态筛选，带片段数与被引用数 */
  @Get()
  list(@Query() query: ListEvidenceQuery) {
    return this.evidence.list({
      source_type: query.source_type?.trim() || undefined,
      active: parseBool(query.active),
    });
  }

  /** 证据文档详情（含原文） */
  @Get(':id')
  detail(@Param('id') id: string) {
    return this.evidence.detail(id);
  }

  /** 入库管线状态：待切分 / 已切分 / 失败、片段数、最近一次入库时间、错误信息 */
  @Get(':id/pipeline')
  pipeline(@Param('id') id: string) {
    return this.evidence.pipeline(id);
  }

  /** 停用影响预览：引用该证据的分析列表（分析 ID、episode、版本、引用的 statement） */
  @Get(':id/impact')
  impact(@Param('id') id: string) {
    return this.evidence.impactPreview(id);
  }

  /** 新建证据文档（标题、来源类型、来源地址、许可、核实日期） */
  @Post()
  create(@CurrentUser() user: { id: string }, @Body() body: EvidenceCreateBody) {
    return this.evidence.create(user.id, body);
  }

  /** 编辑证据文档（改动写审计） */
  @Patch(':id')
  update(@CurrentUser() user: { id: string }, @Param('id') id: string, @Body() body: EvidenceDocBody) {
    return this.evidence.update(user.id, id, body);
  }

  /** 停用 / 启用：停用时返回影响预览，供审核人确认；启用立即生效 */
  @Post(':id/active')
  setActive(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body() body: EvidenceActiveBody,
  ) {
    return this.evidence.setActive(user.id, id, body.active, body.reason);
  }

  /**
   * 切分入库：把文档原文切分为片段写入 evidence_chunk，并计算本地 16 维向量。
   * 幂等：重复 ingest 不会重复产生片段（按位置更新）。
   */
  @Post(':id/ingest')
  ingest(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.evidence.ingest(user.id, id);
  }
}

/** limit 解析：非正整数回落默认值 5，上限 50 */
function parseLimit(value: string | undefined): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 5;
  return Math.min(Math.floor(n), 50);
}

/** 布尔查询参数解析：'1' / 'true' → true，'0' / 'false' → false，其余视为未筛选 */
function parseBool(value: string | undefined): boolean | undefined {
  const text = (value ?? '').trim().toLowerCase();
  if (text === '1' || text === 'true') return true;
  if (text === '0' || text === 'false') return false;
  return undefined;
}
