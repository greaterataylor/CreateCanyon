import { Catch, HttpException, HttpStatus, type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";
import { ZodError } from "zod";
import { DomainError } from "@createcanyon/domain";
import type { FastifyReply, FastifyRequest } from "fastify";

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  public catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<FastifyReply>();
    const request = context.getRequest<FastifyRequest>();
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let body: Record<string, unknown> = { code: "INTERNAL_ERROR", message: "An unexpected error occurred" };
    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const payload = exception.getResponse();
      body = typeof payload === "string" ? { message: payload } : (payload as Record<string, unknown>);
    } else if (exception instanceof ZodError) {
      status = 400; body = { code: "VALIDATION_ERROR", message: "Invalid request", issues: exception.issues.map(i => ({ path: i.path, message: i.message })) };
    } else if (exception instanceof DomainError) {
      status = HttpStatus.UNPROCESSABLE_ENTITY;
      body = { code: exception.code, message: exception.message };
    }
    if (status >= 500) request.log.error({ requestId: request.id, errorType: exception instanceof Error ? exception.name : "Unknown" }, "Unhandled API error");
    response.status(status).send({ ...body, statusCode: status, requestId: request.id, path: request.url, timestamp: new Date().toISOString() });
  }
}
