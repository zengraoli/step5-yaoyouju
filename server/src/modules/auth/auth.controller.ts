import { Body, Controller, Delete, Get, Param, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, Matches } from 'class-validator';
import { AuthService, CONSENT_SCOPES } from './auth.service';
import { CurrentUser } from '../../common/current-user.decorator';
import { Public } from '../../common/public.decorator';
import { Response } from 'express';

class SendCodeDto {
  @ApiProperty({ description: '11 位手机号', example: '13800001234' })
  @Matches(/^1\d{10}$/, { message: '请输入正确的 11 位手机号' })
  phone!: string;
}

class LoginDto {
  @ApiProperty({ description: '11 位手机号', example: '13800001234' })
  @Matches(/^1\d{10}$/, { message: '请输入正确的 11 位手机号' })
  phone!: string;

  @ApiProperty({ description: '短信验证码（演示固定 123456）', example: '123456' })
  @Matches(/^\d{6}$/, { message: '验证码为 6 位数字' })
  code!: string;
}

class GrantConsentDto {
  @ApiProperty({ description: '同意范围', enum: [...CONSENT_SCOPES] })
  @IsIn([...CONSENT_SCOPES], { message: '同意范围不正确' })
  scope!: string;
}

class DeleteAccountDto {
  @ApiProperty({ description: '11 位手机号（与登录手机号一致）', example: '13800001234' })
  @Matches(/^1\d{10}$/, { message: '请输入正确的 11 位手机号' })
  phone!: string;

  @ApiProperty({ description: '短信验证码（二次确认）', example: '123456' })
  @Matches(/^\d{6}$/, { message: '验证码为 6 位数字' })
  code!: string;
}

@ApiTags('认证与同意')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** 获取验证码（演示：固定验证码，仅写脱敏日志） */
  @Public()
  @ApiOperation({ summary: '获取短信验证码（演示固定码，手机号脱敏）' })
  @Post('sms-code')
  sendCode(@Body() dto: SendCodeDto) {
    return this.auth.sendCode(dto.phone);
  }

  /** 手机号 + 验证码登录 / 注册 */
  @Public()
  @ApiOperation({ summary: '手机号 + 验证码登录 / 注册（首次自动创建用户）' })
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.phone, dto.code);
  }

  /** 当前登录用户 */
  @ApiOperation({ summary: '当前登录用户信息与同意记录' })
  @Get('me')
  me(@CurrentUser() user: { id: string }) {
    return this.auth.me(user.id);
  }

  /** 同意记录（可查） */
  @ApiOperation({ summary: '我的同意记录（可查）' })
  @Get('consents')
  consents(@CurrentUser() user: { id: string }) {
    return this.auth.listConsents(user.id);
  }

  /** 同意某项范围（单独勾选） */
  @ApiOperation({ summary: '同意某项范围（如健康信息处理，单独勾选）' })
  @Post('consents')
  grant(@CurrentUser() user: { id: string }, @Body() dto: GrantConsentDto) {
    return this.auth.grantConsent(user.id, dto.scope);
  }

  /** 撤回同意（立即生效） */
  @ApiOperation({ summary: '撤回同意（立即生效）' })
  @Post('consents/:scope/revoke')
  revoke(@CurrentUser() user: { id: string }, @Param('scope') scope: string) {
    return this.auth.revokeConsent(user.id, scope);
  }

  /** 退出登录（吊销当前令牌，旧令牌立即失效） */
  @ApiOperation({ summary: '退出登录（吊销当前令牌）' })
  @Post('logout')
  logout(@Req() req: { headers: Record<string, unknown> }, @Body() _body: unknown) {
    const header = (req.headers['authorization'] ?? '') as string;
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    return this.auth.logout(token);
  }

  /** 我的数据导出（JSON 全文，含病程 / 记录 / 分析 / 问答 / 反馈） */
  @ApiOperation({ summary: '导出我的数据（JSON 全文）' })
  @Get('export')
  exportData(@CurrentUser() user: { id: string }) {
    return this.auth.exportData(user.id);
  }

  /** 申请删除账户（验证码二次确认 → 24 小时冷静期） */
  @ApiOperation({ summary: '申请删除账户（验证码二次确认后进入 24 小时冷静期）' })
  @Post('delete-request')
  deleteRequest(@CurrentUser() user: { id: string }, @Body() dto: DeleteAccountDto) {
    return this.auth.requestDeletion(user.id, dto.code, dto.phone);
  }

  /** 冷静期结束后确认删除（再次输入验证码，硬删全部数据） */
  @ApiOperation({ summary: '确认删除账户（冷静期后生效，硬删全部数据）' })
  @Post('delete-confirm')
  deleteConfirm(@CurrentUser() user: { id: string }, @Body() dto: DeleteAccountDto) {
    return this.auth.confirmDeletion(user.id, dto.code, dto.phone);
  }

  /** 取消删除申请 */
  @ApiOperation({ summary: '取消删除账户申请' })
  @Post('delete-cancel')
  deleteCancel(@CurrentUser() user: { id: string }) {
    return this.auth.cancelDeletion(user.id);
  }
}
