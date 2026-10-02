import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { Public } from '../../common/public.decorator';
import { RED_FLAG_RULES } from './safety.rules';

class EmergencyNoticeQuery {
  @ApiProperty({ description: '命中的信号名（顿号分隔；仅用于正文提示，判定一律以服务端规则为准）', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  signals?: string;

  @ApiProperty({ description: '是否命中 high 级红旗（1=停止个性化分析）', required: false })
  @IsOptional()
  @IsString()
  stop?: string;
}

/**
 * 就医提示（R03）：公开接口，无需登录、不被付费或上传阻断。
 * 文案与 App A03「需要及时寻求专业帮助」一致；命中信号由安全规则引擎（T04）判定，
 * 前端把命中的信号名通过 signals 参数带入，正文据此展示（不写死任何具体症状）。
 */
@ApiTags('就医提示')
@Controller('safety')
export class SafetyNoticeController {
  @Public()
  @ApiOperation({ summary: '就医提示内容（公开，命中红旗时展示，不被登录 / 付费 / 上传阻断）' })
  @Get('emergency-notice')
  emergencyNotice(@Query() query: EmergencyNoticeQuery) {
    const signals = (query.signals ?? '')
      .split(/[、,，]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .slice(0, 6);
    const high = query.stop === '1';
    const body = signals.length > 0
      ? `你刚才描述的内容包含需要医生及时评估的信号：${signals.join('、')}。这类变化需要医生及时评估，本产品无法替你判断严重程度，${high ? '本轮不会生成个性化分析' : '个性化分析仍会生成，但请以医生的评估为准'}。`
      : '如果你出现了需要医生及时评估的变化，请尽快就医。这类提示不会被登录、付费或上传阻断；本产品无法替你判断严重程度。';
    return {
      title: '需要及时寻求专业帮助',
      headline: high ? '建议尽快就医' : '建议及时就医评估',
      body,
      matched: signals.map((label) => ({
        label,
        rule_code: RED_FLAG_RULES.find((r) => r.label === label)?.code ?? '',
      })),
      offline_note: '本页在网络异常时也可查看。',
      actions: [
        { type: 'call', label: '拨打 120 / 前往急诊' },
        { type: 'hospital', label: '查找附近医院' },
        { type: 'doctor', label: '联系我的主治医生' },
      ],
      bring_list: [
        '已录入的检查报告原文',
        '症状开始时间与最近变化记录',
        '正在使用的药物与既有医嘱',
      ],
      summary_action: {
        label: '生成一页“就诊交接”摘要（仅整理已有信息）',
      },
      footer_note: '此提示由临床审定规则触发，不是诊断结论；请以医生的评估为准。',
    };
  }
}
