import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { ResponseInterceptor } from './common/response.interceptor';
import { AllExceptionsFilter } from './common/all-exceptions.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter());
  const port = Number(process.env.PORT ?? 3200);
  await app.listen(port);
  // 仅输出非敏感信息
  console.log(`[api] 腰有据服务端已启动: http://127.0.0.1:${port}`);
}

bootstrap().catch((err) => {
  console.error('[api] 启动失败:', err instanceof Error ? err.message : err);
  process.exit(1);
});
