import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { IsIn, IsNotEmpty, Matches } from 'class-validator';
import { AuthService, CONSENT_SCOPES } from './auth.service';
import { CurrentUser } from '../../common/current-user.decorator';
import { Public } from '../../common/public.decorator';

class SendCodeDto {
  @Matches(/^1\d{10}$/, { message: '请输入正确的 11 位手机号' })
  phone!: string;
}

class LoginDto {
  @Matches(/^1\d{10}$/, { message: '请输入正确的 11 位手机号' })
  phone!: string;

  @Matches(/^\d{6}$/, { message: '验证码为 6 位数字' })
  code!: string;
}

class GrantConsentDto {
  @IsIn([...CONSENT_SCOPES], { message: '同意范围不正确' })
  scope!: string;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** 获取验证码（演示：固定验证码，仅写脱敏日志） */
  @Public()
  @Post('sms-code')
  sendCode(@Body() dto: SendCodeDto) {
    return this.auth.sendCode(dto.phone);
  }

  /** 手机号 + 验证码登录 / 注册 */
  @Public()
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.phone, dto.code);
  }

  /** 当前登录用户 */
  @Get('me')
  me(@CurrentUser() user: { id: string }) {
    return this.auth.me(user.id);
  }

  /** 同意记录（可查） */
  @Get('consents')
  consents(@CurrentUser() user: { id: string }) {
    return this.auth.listConsents(user.id);
  }

  /** 同意某项范围（单独勾选） */
  @Post('consents')
  grant(@CurrentUser() user: { id: string }, @Body() dto: GrantConsentDto) {
    return this.auth.grantConsent(user.id, dto.scope);
  }

  /** 撤回同意（立即生效） */
  @Post('consents/:scope/revoke')
  revoke(@CurrentUser() user: { id: string }, @Param('scope') scope: string) {
    return this.auth.revokeConsent(user.id, scope);
  }
}
