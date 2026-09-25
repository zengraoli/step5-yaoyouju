import { SetMetadata } from '@nestjs/common';

export const REQUIRE_CONSENT_KEY = 'requireConsent';

/** 标记路由需要的同意范围（默认要求「健康信息处理」） */
export const RequireConsent = (scope = '健康信息处理') =>
  SetMetadata(REQUIRE_CONSENT_KEY, scope);
