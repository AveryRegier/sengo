import { getLogger as getCloxLogger, Logger as CloxLoggerType, LogLevel, MetaData } from 'clox';

export type Logger = CloxLoggerType;

const mainLogger = getCloxLogger({ name: 'sengo' });

export const getLogger = (context?: MetaData): Logger => {
    return mainLogger.child(context || {});
};

export default mainLogger;

export function setLogLevel(level: LogLevel) {
    mainLogger.level = level;
}

setLogLevel('debug');