import { Controller, Get } from '@nestjs/common';
import { Public } from '../../common/public.decorator';

/**
 * 就医提示（R03）：公开接口，无需登录、不被付费或上传阻断。
 * 文案与 App A03「需要及时寻求专业帮助」一致；命中信号由安全规则引擎（T04）判定，
 * 这里返回固定的提示内容，网络异常时前端也可直接展示本页静态内容。
 */
@Controller('safety')
export class SafetyNoticeController {
  @Public()
  @Get('emergency-notice')
  emergencyNotice() {
    return {
      title: '需要及时寻求专业帮助',
      headline: '建议尽快就医',
      body: '你刚才选择了：会阴部麻木、双腿进行性无力。这类变化需要医生及时评估，本产品无法替你判断严重程度，本轮不会生成个性化分析。',
      offline_note: '本页在网络异常时也可查看。',
      actions: [
        { type: 'call', label: '拨打 120 / 前往急诊' },
        { type: 'hospital', label: '查找附近医院' },
        { type: 'doctor', label: '联系我的主治医生（已保存）' },
      ],
      bring_list: [
        '已录入的检查报告原文（2026-08-30 腰椎MRI）',
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
