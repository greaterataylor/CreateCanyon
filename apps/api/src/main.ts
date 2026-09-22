import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import { AppModule } from "./app.module.js";
import { HttpExceptionFilter } from "./common/http-exception.filter.js";
import { API_ENV } from "./common/tokens.js";
import type { ApiEnvironment } from "@createcanyon/config";

export async function bootstrap() {
  const adapter = new FastifyAdapter({
    bodyLimit: 2 * 1024 * 1024,
    trustProxy: false,
    logger: { level: process.env.LOG_LEVEL ?? "info", redact: ["req.headers.authorization", "req.headers.cookie", "res.headers['set-cookie']"] },
  });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, { rawBody: true, bufferLogs: true });
  const env = app.get<ApiEnvironment>(API_ENV);
  app.enableShutdownHooks();
  app.setGlobalPrefix("v1");
  app.useGlobalFilters(new HttpExceptionFilter());
  app.enableCors({ origin: env.CORS_ALLOWED_ORIGINS, credentials: false, allowedHeaders: ["Content-Type", "Authorization", "Idempotency-Key"] });
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(rateLimit, { global: true, max: 120, timeWindow: "1 minute" });
  adapter.getInstance().addHook("preSerialization", async (_req, reply, payload) => {
    reply.header("Cache-Control", "private, no-store");
    return JSON.parse(JSON.stringify(payload, (_key, value) => typeof value === "bigint" ? value.toString() : value));
  });
  if (env.NODE_ENV !== "production") {
    const spec = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle("CreateCanyon Network API").setVersion("0.2.0").addBearerAuth().build());
    SwaggerModule.setup("docs", app, spec);
  }
  await app.listen(env.PORT, env.HOST);
  return app;
}
bootstrap().catch((error: unknown) => { console.error("API startup failed", error); process.exitCode = 1; });
