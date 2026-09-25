import { SetMetadata } from '@nestjs/common';

/** 标记路由为公开（无需登录），如就医提示 */
export const Public = () => SetMetadata('isPublic', true);
