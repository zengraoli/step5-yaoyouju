import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as express from 'express';
import { AppModule } from './app.module';
import { ResponseInterceptor } from './common/response.interceptor';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { REQUEST_ID_HEADER, newRequestId, runWithRequestId } from './common/request-context';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // 三端（App H5 5201 / Web 5202 / Admin 5203）均为跨域访问，开启 CORS（Bearer 令牌，不带 Cookie）
  app.enableCors({
    origin: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
    exposedHeaders: [REQUEST_ID_HEADER],
  });
  // 请求 ID：由服务端生成（不信任客户端自带的 X-Request-Id，避免重复 / 伪造），
  // 写响应头并进入审计日志（验收反馈第 16、32 条）
  app.use(
    (
      req: { headers: Record<string, unknown> },
      res: { setHeader(k: string, v: string): void },
      next: () => void,
    ) => {
      const requestId = newRequestId();
      res.setHeader(REQUEST_ID_HEADER, requestId);
      runWithRequestId(requestId, () => next());
    },
  );
  // 请求体上限：超大请求体 / JSON 格式错误统一返回中文错误，而不是 500（验收反馈第 31 条）
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true, limit: '2mb' }));
  app.use(
    (
      err: { type?: string; status?: number; message?: string },
      _req: unknown,
      res: { status(code: number): { json(body: unknown): void } },
      next: () => void,
    ) => {
      if (!err || typeof err !== 'object') return next();
      if (err.type === 'entity.too.large') {
        res.status(413).json({ code: 40000, data: null, message: '内容过长，请分段提交' });
        return;
      }
      if (err.type === 'entity.parse.failed' || err.status === 400) {
        res.status(400).json({ code: 40000, data: null, message: '请求内容不是合法的 JSON，请检查后重试' });
        return;
      }
      next();
    },
  );
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      // 关闭隐式类型转换：标题传数字、数字传文本一律按中文校验错误返回，
      // 而不是悄悄转换后落库（验收反馈第 27 条）
      transformOptions: { enableImplicitConversion: false },
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
