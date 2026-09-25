import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
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

  // OpenAPI 文档页：/api-docs。统一响应由全局拦截器包装，这里主要展示路径与参数。
  const swaggerConfig = new DocumentBuilder()
    .setTitle('腰有据服务端 API')
    .setDescription(
      '腰痛理解与复诊助手服务端（API + AI 任务 Worker）。统一返回 { code, data, message }；' +
        '错误码见 server/docs/errors.md。时间一律 UTC ISO8601。',
    )
    .setVersion('0.16')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'token', description: '用户端登录令牌（POST /auth/login 获得）' },
      'user-token',
    )
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'token', description: '后台管理令牌（POST /admin/auth/login 获得）' },
      'admin-token',
    )
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api-docs', app, document, {
    swaggerOptions: { persistAuthorization: true },
  });

  const port = Number(process.env.PORT ?? 3200);
  await app.listen(port);
  // 仅输出非敏感信息
  console.log(`[api] 腰有据服务端已启动: http://127.0.0.1:${port}`);
  console.log(`[api] 接口文档（OpenAPI）: http://127.0.0.1:${port}/api-docs`);
}

bootstrap().catch((err) => {
  console.error('[api] 启动失败:', err instanceof Error ? err.message : err);
  process.exit(1);
});
