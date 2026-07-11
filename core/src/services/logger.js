const fs = require('node:fs');
const path = require('node:path');
const process = require('node:process');
const { ensureDataDir } = require('../config/runtime-paths');

// 尝试加载 winston，失败则使用 fallback
let winston = null;
let DailyRotateFile = null;
try {
  winston = require('winston');
  DailyRotateFile = require('winston-daily-rotate-file');
} catch {
  winston = null;
  DailyRotateFile = null;
}

const LOG_RETENTION_MS = 3 * 24 * 60 * 60 * 1000;
const LOG_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const ROTATED_LOG_RE = /^(?:combined|error)(?:-\d{4}-\d{2}-\d{2}-\d{2})?\.log$/;

let logCleanupTimer = null;

function padDatePart(value) {
  return String(value).padStart(2, '0');
}

function buildHourlyLogFilename(prefix, date = new Date()) {
  const hour = [
    date.getFullYear(),
    padDatePart(date.getMonth() + 1),
    padDatePart(date.getDate()),
    padDatePart(date.getHours())
  ].join('-');
  return `${prefix}-${hour}.log`;
}

function cleanupExpiredLogFiles(logDir, now = Date.now()) {
  if (!fs.existsSync(logDir)) return 0;
  const cutoff = now - LOG_RETENTION_MS;
  let removed = 0;
  for (const entry of fs.readdirSync(logDir, { withFileTypes: true })) {
    if (!entry.isFile() || !ROTATED_LOG_RE.test(entry.name)) continue;
    const filePath = path.join(logDir, entry.name);
    try {
      if (fs.statSync(filePath).mtimeMs < cutoff) {
        fs.unlinkSync(filePath);
        removed += 1;
      }
    } catch {}
  }
  return removed;
}

function startLogCleanup(logDir) {
  cleanupExpiredLogFiles(logDir);
  if (logCleanupTimer) return;
  logCleanupTimer = setInterval(() => {
    cleanupExpiredLogFiles(logDir);
  }, LOG_CLEANUP_INTERVAL_MS);
  logCleanupTimer.unref?.();
}

// 敏感字段正则：包含 code/token/password 等关键字的键名
const SENSITIVE_KEY_RE = /code|token|password|passwd|auth|ticket|cookie|session/i;

/** 对 URL 查询参数中的敏感值和 Bearer Token 进行脱敏 */
function redactString(raw) {
  let result = String(raw || '');
  // 替换 URL 查询参数中的敏感值 (如 ?code=xxx&token=yyy)
  result = result.replace(/([?&](?:code|token|ticket|password)=)[^&\s]+/gi, '$1[REDACTED]');
  // 替换 Bearer Token
  result = result.replace(/(Bearer\s+)[\w.-]+/gi, '$1[REDACTED]');
  return result;
}

/**
 * 递归脱敏元数据对象
 * @param {*} meta - 待脱敏对象
 * @param {number} depth - 当前递归深度，超过 4 层返回 [Truncated]
 */
function sanitizeMeta(meta, depth = 0) {
  if (depth > 4) return '[Truncated]';
  if (meta === null || meta === undefined) return meta;
  if (typeof meta === 'string') return redactString(meta);
  if (typeof meta !== 'object') return meta;
  if (Array.isArray(meta)) {
    return meta.map(item => sanitizeMeta(item, depth + 1));
  }
  const result = {};
  for (const [key, value] of Object.entries(meta)) {
    if (SENSITIVE_KEY_RE.test(String(key))) {
      result[key] = '[REDACTED]';
    } else {
      result[key] = sanitizeMeta(value, depth + 1);
    }
  }
  return result;
}

// ─── Fallback 日志（无 winston 时使用） ───

let fallbackLogDir = null;

function ensureFallbackLogDir() {
  if (fallbackLogDir) return fallbackLogDir;
  const logDir = process.env.FARM_LOG_DIR
    ? path.resolve(process.env.FARM_LOG_DIR)
    : path.join(ensureDataDir(), 'logs');
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
  startLogCleanup(logDir);
  fallbackLogDir = logDir;
  return fallbackLogDir;
}

/** 追加 fallback 日志到文件 */
function appendFallbackLog(level, moduleName, message, meta) {
  try {
    const logDir = ensureFallbackLogDir();
    const entry = {
      ts: new Date().toISOString(),
      level,
      module: moduleName,
      message: redactString(message),
      meta: sanitizeMeta(meta || {})
    };
    const line = `${JSON.stringify(entry)  }\n`;
    fs.appendFileSync(path.join(logDir, buildHourlyLogFilename('combined')), line, 'utf8');
    if (level === 'error') {
      fs.appendFileSync(path.join(logDir, buildHourlyLogFilename('error')), line, 'utf8');
    }
  } catch {}
}

/** 创建 console-based fallback logger */
function createConsoleFallback(moduleName) {
  const writeLog = (level, message, meta) => {
    const timestamp = new Date().toISOString();
    const msg = redactString(message);
    const sanitized = sanitizeMeta(meta);
    appendFallbackLog(level, moduleName, msg, sanitized);
    if (sanitized && Object.keys(sanitized).length > 0) {
      console.warn(`[${timestamp}] [${level}] [${moduleName}] ${msg} ${JSON.stringify(sanitized)}`);
    } else {
      console.warn(`[${timestamp}] [${level}] [${moduleName}] ${msg}`);
    }
  };
  return {
    info: (msg, meta) => writeLog('info', msg, meta),
    warn: (msg, meta) => writeLog('warn', msg, meta),
    error: (msg, meta) => writeLog('error', msg, meta),
    debug: (msg, meta) => writeLog('debug', msg, meta)
  };
}

// ─── Winston Logger ───

let rootLogger = null;

/** 获取/创建根 logger（Winston） */
function getRootLogger() {
  if (rootLogger) return rootLogger;
  if (!winston) { rootLogger = null; return rootLogger; }

  const logDir = process.env.FARM_LOG_DIR
    ? path.resolve(process.env.FARM_LOG_DIR)
    : path.join(ensureDataDir(), 'logs');
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
  startLogCleanup(logDir);

  const level = String(process.env.LOG_LEVEL || 'info').toLowerCase();
  const { combine, timestamp, errors, json, colorize, printf } = winston.format;

  rootLogger = winston.createLogger({
    level,
    defaultMeta: { app: 'qq-farm-bot' },
    transports: [
      // 控制台输出
      new winston.transports.Console({
        format: combine(
          colorize(),
          timestamp(),
          errors({ stack: true }),
          printf(info => {
            const moduleTag = info.module ? `[${info.module}] ` : '';
            const msg = redactString(info.message || '');
            const rest = { ...info };
            delete rest.level;
            delete rest.message;
            delete rest.timestamp;
            delete rest.app;
            delete rest.module;
            const meta = sanitizeMeta(rest);
            const metaStr = meta && Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
            return `${info.timestamp} [${info.level}] ${moduleTag}${msg}${metaStr}`;
          })
        )
      }),
      // 合并日志文件
      new DailyRotateFile({
        filename: path.join(logDir, 'combined-%DATE%.log'),
        datePattern: 'YYYY-MM-DD-HH',
        maxFiles: '3d',
        auditFile: path.join(logDir, '.combined-log-audit.json'),
        format: combine(timestamp(), errors({ stack: true }), json())
      }),
      // 错误日志文件
      new DailyRotateFile({
        filename: path.join(logDir, 'error-%DATE%.log'),
        datePattern: 'YYYY-MM-DD-HH',
        maxFiles: '3d',
        auditFile: path.join(logDir, '.error-log-audit.json'),
        level: 'error',
        format: combine(timestamp(), errors({ stack: true }), json())
      })
    ]
  });
  return rootLogger;
}

/**
 * 创建模块级别的 logger
 * @param {string} name - 模块名称，默认 'app'
 * @returns {{ info, warn, error, debug }} 日志方法
 */
function createModuleLogger(name = 'app') {
  const moduleName = String(name || 'app');
  const logger = getRootLogger();

  // 无 winston 时降级为 console fallback
  if (!logger) return createConsoleFallback(moduleName);

  const child = logger.child({ module: moduleName });
  return {
    info(message, meta = {}) {
      child.info(redactString(message), sanitizeMeta(meta));
    },
    warn(message, meta = {}) {
      child.warn(redactString(message), sanitizeMeta(meta));
    },
    error(message, meta = {}) {
      child.error(redactString(message), sanitizeMeta(meta));
    },
    debug(message, meta = {}) {
      child.debug(redactString(message), sanitizeMeta(meta));
    }
  };
}

module.exports = {
  createModuleLogger,
  sanitizeMeta,
  redactString,
  buildHourlyLogFilename,
  cleanupExpiredLogFiles,
  LOG_RETENTION_MS
};
