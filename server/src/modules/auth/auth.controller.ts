import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, Matches } from 'class-validator';
import { AuthService, CONSENT_SCOPES } from './auth.service';
import { CurrentUser } from '../../common/current-user.decorator';
import { Public } from '../../common/public.decorator';

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
}
