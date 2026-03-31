import pino from "pino";

export function createLogger() {
  const isProd = process.env.NODE_ENV === "production";

  if (isProd) {
    return pino({ level: "info" });
  }

  // В dev проще читать логи локально.
  return pino({
    level: process.env.LOG_LEVEL ? process.env.LOG_LEVEL : "info",
    transport: {
      target: "pino-pretty",
      options: {
        colorize: true,
        translateTime: "SYS:standard",
      },
    },
  });
}

