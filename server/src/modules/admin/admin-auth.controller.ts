import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';
import { Public } from '../../common/public.decorator';
import { CurrentAdmin } from '../../common/current-admin.decorator';
import { AdminAuthService, AdminContext, AdminLoginResult } from './admin-auth.service';

class AdminLoginDto {
  /** 后台账号（无自助注册，账号由超级管理线下开通） */
  @ApiProperty({ description: '后台账号（无自助注册，账号由超级管理线下开通）', maxLength: 50 })
  @IsString()
  @IsNotEmpty({ message: '请输入账号' })
  @MaxLength(50)
  name!: string;

  /** 口令（只用于校验，不写日志、不写审计） */
  @ApiProperty({ description: '口令（取 .env 的 ADMIN_DEMO_PASSWORD，只校验不记录）', maxLength: 100 })
  @IsString()
  @IsNotEmpty({ message: '请输入口令' })
  @MaxLength(100)
  password!: string;

  /** TOTP 演示固定码（6 位数字，取 env ADMIN_TOTP_DEMO_CODE） */
  @ApiProperty({ description: 'TOTP 演示固定码（6 位数字，取 .env 的 ADMIN_TOTP_DEMO_CODE）' })
  @Matches(/^\d{6}$/, { message: '验证码为 6 位数字' })
  totp!: string;
}

/**
 * 后台登录（T14，B01）：账号 + 口令 + TOTP。
 * - 无自助注册接口；
 * - 连续失败 5 次锁定 15 分钟（40300 账号已锁定）；
 * - 短会话：令牌 30 分钟有效，返回 token + 角色 + 姓名；
 * - 登录成功 / 失败都写审计（失败只记录账号，不记录口令与验证码）。
 */
@ApiTags('后台·认证')
@Controller('admin/auth')
export class AdminAuthController {
  constructor(private readonly adminAuth: AdminAuthService) {}

  @Public()
  @ApiOperation({ summary: '后台登录：账号 + 口令 + TOTP（连续失败 5 次锁定 15 分钟）' })
  @Post('login')
  login(@Body() dto: AdminLoginDto): AdminLoginResult {
    return this.adminAuth.login(dto.name, dto.password, dto.totp);
  }

  /** 登出（写审计；无状态令牌由客户端丢弃） */
  @ApiOperation({ summary: '后台登出（写审计）' })
  @Post('logout')
  logout(@CurrentAdmin() admin: AdminContext): { ok: true } {
    return this.adminAuth.logout(admin);
  }

  /** 当前后台账号：角色与权限 */
  @ApiOperation({ summary: '当前后台账号：角色与权限' })
  @Get('me')
  me(@CurrentAdmin() admin: AdminContext): AdminLoginResult['admin'] {
    return this.adminAuth.me(admin.id);
  }
}
