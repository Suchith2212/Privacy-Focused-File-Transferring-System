/**
 * Structured logger using pino.
 * - Development: pretty-printed colored output via pino-pretty
 * - Production: JSON lines for log aggregation (Datadog, Logtail, etc.)
 */
const pino = require("pino");

const isDev = String(process.env.NODE_ENV || "development").toLowerCase() !== "production";

const logger = pino(
  {
    level: process.env.LOG_LEVEL || "info",
    base: { pid: process.pid, service: "ghostdrop" },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: [
        "*.password",
        "*.token",
        "*.innerToken",
        "*.tokenHash",
        "*.secret",
        "req.headers.authorization",
        "req.headers['x-session-token']"
      ],
      censor: "[REDACTED]"
    }
  },
  isDev
    ? pino.transport({
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "SYS:HH:MM:ss",
          ignore: "pid,hostname,service"
        }
      })
    : pino.destination({ sync: false })
);

module.exports = logger;
