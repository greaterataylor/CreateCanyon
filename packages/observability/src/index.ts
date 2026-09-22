import pino, { type Logger, type LoggerOptions } from "pino";

const redactPaths = [
  "req.headers.authorization",
  "req.headers.cookie",
  "request.headers.authorization",
  "request.headers.cookie",
  "password",
  "token",
  "accessToken",
  "refreshToken",
  "clientSecret",
  "stripeSecretKey",
  "*.password",
  "*.token",
];

export function createLogger(options: { readonly level: string; readonly service?: string }): Logger {
  const configuration: LoggerOptions = {
    level: options.level,
    base: { service: options.service ?? "createcanyon" },
    redact: { paths: redactPaths, censor: "[REDACTED]" },
    serializers: {
      err: pino.stdSerializers.err,
      error: pino.stdSerializers.err,
    },
  };
  return pino(configuration);
}
