// Minimales Logging mit Zeitstempel und Level. LOG_LEVEL=debug|info|warn|error
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = LEVELS[process.env.LOG_LEVEL] ?? LEVELS.info;

function out(level, scope, msg, extra) {
  if (LEVELS[level] < threshold) return;
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [${scope}] ${msg}`;
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  extra === undefined ? fn(line) : fn(line, extra);
}

export function logger(scope) {
  return {
    debug: (m, e) => out('debug', scope, m, e),
    info: (m, e) => out('info', scope, m, e),
    warn: (m, e) => out('warn', scope, m, e),
    error: (m, e) => out('error', scope, m, e),
  };
}
