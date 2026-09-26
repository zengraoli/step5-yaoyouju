import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';
import { EvidenceService } from './evidence.service';

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

/** 检索（POST /evidence/search） */
class EvidenceSearchBody {
  @ApiProperty({ description: '检索关键词', maxLength: 2000 })
  @IsString()
  @MaxLength(2000)
  q!: string;

  @ApiProperty({ description: '返回片段数量上限（默认 5，最大 50）', required: false })
  @IsOptional()
  @IsNumber()
  limit?: number;
}

/**
 * 医学证据库（B05：来源类型 / 许可 / 核实日期；入库管线状态；停用影响预览）。
 *
 * 仅保留读接口（检索 / 列表 / 详情 / 管线状态），要求登录。
 * 写接口（新建 / 编辑 / 停用启用 / 入库）与停用影响预览属于后台管理职责，
 * 统一在 /admin/evidence 下由后台账号操作（越权 403 并写审计）。
 */
@ApiTags('证据库')
@Controller('evidence')
export class EvidenceController {
  constructor(private readonly evidence: EvidenceService) {}

  /**
   * 证据库检索：关键词 + 本地向量相似度混合打分，只在证据库内、只检索启用中的文档。
   * 返回片段内容、所属文档标题 / 来源类型 / 许可、得分与 retrieval_snapshot。
   */
  @ApiOperation({ summary: '证据库检索（POST，关键词 + 本地向量混合打分，只在证据库内）' })
  @Post('search')
  searchByPost(@Body() body: EvidenceSearchBody) {
    return this.evidence.search(body.q, body.limit ?? 5);
  }

  /** 证据库检索（GET 形式，便于后台与联调直接验证） */
  @ApiOperation({ summary: '证据库检索（GET 形式）' })
  @Get('search')
  searchByGet(@Query('q') q: string, @Query('limit') limit?: string) {
    const query = (q ?? '').trim();
    if (!query) {
      return this.evidence.search('', 0);
    }
    return this.evidence.search(query, parseLimit(limit));
  }

  /** 证据文档列表：来源类型 / 启用状态筛选，带片段数与被引用数 */
  @ApiOperation({ summary: '证据文档列表（来源类型 / 启用状态筛选）' })
  @Get()
  list(@Query() query: ListEvidenceQuery) {
    return this.evidence.list({
      source_type: query.source_type?.trim() || undefined,
      active: parseBool(query.active),
    });
  }

  /** 证据文档详情（含原文） */
  @ApiOperation({ summary: '证据文档详情（含原文）' })
  @Get(':id')
  detail(@Param('id') id: string) {
    return this.evidence.detail(id);
  }

  /** 入库管线状态：待切分 / 已切分 / 失败、片段数、最近一次入库时间、错误信息 */
  @ApiOperation({ summary: '入库管线状态（待切分 / 已切分 / 失败、片段数、最近入库时间）' })
  @Get(':id/pipeline')
  pipeline(@Param('id') id: string) {
    return this.evidence.pipeline(id);
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
