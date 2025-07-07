import pino from 'pino';

const globalLogger = pino({ level: process.env.SENGO_LOG_LEVEL || 'error' });
export function getLogger(context: Record<string, any> = {}) {
  return globalLogger.child(context);
}
export function setLogLevel(level: string) {
  globalLogger.level = level;
}
export function setLogFile(file: string) {
  // Not implemented: would require pino.destination and re-creating logger
}
