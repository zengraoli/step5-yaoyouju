import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { ContentsService } from './contents.service';
import { CurrentUser } from '../../common/current-user.decorator';

class ListContentsQuery {
  /** 按类型筛选：视频 / 图文组件 / 案例 */
  @ApiProperty({ description: '按类型筛选：视频 / 图文组件 / 案例', required: false })
  @IsOptional()
  @IsString()
  type?: string;
}

/**
 * 内容库用户端接口（/contents，App A13 / A15、Web W07）。
 * 需登录（全局守卫）；只返回已发布且未下线内容：
 * 草稿 / 待审 / 已审定 / 已撤回 / 更正中、以及已下线内容一律 404，列表中也不出现。
 */
@ApiTags('内容库')
@Controller('contents')
export class ContentsController {
  constructor(private readonly contents: ContentsService) {}

  /**
   * 已发布内容列表：每条带适用范围、不适用范围、当前版本号与推荐理由。
   * 「视频推荐」开关关闭时视频推荐位为空（不报错）；「案例卡片」开关关闭时案例内容不返回。
   */
  @ApiOperation({ summary: '已发布内容列表（只返回已发布且未下线内容）' })
  @Get()
  list(@CurrentUser() user: { id: string }, @Query() query: ListContentsQuery) {
    return this.contents.listPublished(user.id, query.type);
  }

  /** 内容详情：当前版本脚本、字幕与文字替代、审核记录、版本链 */
  @ApiOperation({ summary: '内容详情：当前版本脚本、字幕与文字替代、审核记录、版本链' })
  @Get(':id')
  detail(@Param('id') id: string) {
    return this.contents.detail(id);
  }
}
