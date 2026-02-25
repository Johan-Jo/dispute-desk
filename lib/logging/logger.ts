/**
 * Structured JSON logger.
 *
 * All log output goes through this module to ensure consistent format.
 * Fields: timestamp, level, message, and structured context.
 */

type LogLevel = "info" | "warn" | "error" | "debug";

interface LogContext {
  shopId?: string;
  disputeId?: string;
  packId?: string;
  requestId?: string;
  action?: string;
  durationMs?: number;
  [key: string]: unknown;
}

function emit(level: LogLevel, message: string, ctx?: LogContext) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...ctx,
  };

  switch (level) {
    case "error":
      console.error(JSON.stringify(entry));
      break;
    case "warn":
      console.warn(JSON.stringify(entry));
      break;
    case "debug":
      if (process.env.LOG_LEVEL === "debug") console.debug(JSON.stringify(entry));
      break;
    default:
      console.log(JSON.stringify(entry));
  }
}

export const logger = {
  info: (message: string, ctx?: LogContext) => emit("info", message, ctx),
  warn: (message: string, ctx?: LogContext) => emit("warn", message, ctx),
  error: (message: string, ctx?: LogContext) => emit("error", message, ctx),
  debug: (message: string, ctx?: LogContext) => emit("debug", message, ctx),

  /** Time an async operation and log the result. */
  async timed<T>(action: string, ctx: LogContext, fn: () => Promise<T>): Promise<T> {
    const start = Date.now();
    try {
      const result = await fn();
      emit("info", `${action} completed`, { ...ctx, action, durationMs: Date.now() - start });
      return result;
    } catch (err) {
      emit("error", `${action} failed`, {
        ...ctx,
        action,
        durationMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  },
};
