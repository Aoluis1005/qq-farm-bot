/**
 * 通用工具函数
 */

const Long = require('long');
const { createModuleLogger, sanitizeMeta } = require('../services/logger');
const coreLogger = createModuleLogger('core');

// ============ 服务器时间状态 ============
let serverTimeMs = 0;
let localTimeAtSync = 0;

// ============ 类型转换 ============
function toLong(val) {
    return Long.fromNumber(val);
}

function toNum(val) {
    if (val === null || val === undefined) return 0;
    if (Long.isLong(val)) return val.toNumber();
    if (typeof val === 'object' && 'low' in val && 'high' in val) {
        if (typeof val.toNumber === 'function') return val.toNumber();
        return (val.low >>> 0) + (val.high * 0x100000000);
    }
    if (typeof val.toNumber === 'function') {
        return val.toNumber();
    }
    return Number(val) || 0;
}

// ============ 时间相关 ============
function now() {
    const d = new Date();
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
}

/** 获取当前推算的服务器时间(秒) */
function getServerTimeSec() {
    if (!serverTimeMs) return Math.floor(Date.now() / 1000);
    const elapsed = Date.now() - localTimeAtSync;
    return Math.floor((serverTimeMs + elapsed) / 1000);
}

/** 同步服务器时间 */
function syncServerTime(ms) {
    serverTimeMs = ms;
    localTimeAtSync = Date.now();
}

/**
 * 将时间戳归一化为秒级
 * 大于 1e12 认为是毫秒级，转换为秒级
 */
function toTimeSec(val) {
    const n = toNum(val);
    if (n <= 0) return 0;
    if (n > 1e12) return Math.floor(n / 1000);
    return n;
}

// ============ 日志 ============
let logHook = null;
function setLogHook(hook) { logHook = hook; }

function normalizeMeta(meta) {
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return {};
    return sanitizeMeta(meta);
}

function resolveModuleTag(moduleName) {
    const moduleMap = {
        farm: '农场',
        friend: '好友',
        warehouse: '仓库',
        task: '任务',
        system: '系统',
    };
    const m = String(moduleName || '').trim();
    return moduleMap[m] || '系统';
}

function inferModuleFromTag(tag) {
    const t = String(tag || '').trim();
    const tagMap = {
        农场: 'farm',
        商店: 'warehouse',
        购买: 'warehouse',
        仓库: 'warehouse',
        好友: 'friend',
        任务: 'task',
        活跃: 'task',
        系统: 'system',
        错误: 'system',
        WS: 'system',
        心跳: 'system',
        推送: 'system',
    };
    return tagMap[t] || 'system';
}

function normalizeLogArgs(arg1, arg2, arg3) {
    // 新写法: log(msg, meta)
    if (typeof arg2 !== 'string') {
        return {
            tag: '',
            msg: String(arg1 || ''),
            meta: arg2 || null,
        };
    }
    // 兼容旧写法: log(tag, msg, meta)
    return {
        tag: String(arg1 || ''),
        msg: String(arg2 || ''),
        meta: arg3 || null,
    };
}

function log(arg1, arg2, arg3 = null) {
    const { tag, msg, meta } = normalizeLogArgs(arg1, arg2, arg3);
    const safeMeta = normalizeMeta(meta);
    if (!safeMeta.module) safeMeta.module = inferModuleFromTag(tag);
    const displayTag = resolveModuleTag(safeMeta.module);
    coreLogger.info(msg, { tag: displayTag, ...safeMeta });
    if (logHook) {
        try { logHook(displayTag, msg, false, safeMeta); } catch {}
    }
}

function logWarn(arg1, arg2, arg3 = null) {
    const { tag, msg, meta } = normalizeLogArgs(arg1, arg2, arg3);
    const safeMeta = normalizeMeta(meta);
    if (!safeMeta.module) safeMeta.module = inferModuleFromTag(tag);
    const displayTag = resolveModuleTag(safeMeta.module);
    coreLogger.warn(msg, { tag: displayTag, ...safeMeta });
    if (logHook) {
        try { logHook(displayTag, msg, true, safeMeta); } catch {}
    }
}

// ============ 异步工具 ============
function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

function randomDelay(minMs, maxMs) {
    const min = Math.max(0, Math.floor(minMs) || 0);
    const max = Math.max(min, Math.floor(maxMs) || min);
    const delay = min + Math.floor(Math.random() * (max - min + 1));
    return new Promise(r => setTimeout(r, delay));
}

// ============ 格式化工具 ============
function pad2(num) {
    return String(num).padStart(2, '0');
}

function formatLocalDateTime24(date = new Date()) {
    const d = date instanceof Date ? date : new Date();
    const yyyy = d.getFullYear();
    const mm = pad2(d.getMonth() + 1);
    const dd = pad2(d.getDate());
    const hh = pad2(d.getHours());
    const min = pad2(d.getMinutes());
    const ss = pad2(d.getSeconds());
    return `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}`;
}

// ============ 错误判定 ============
/** 判断是否是瞬时网络错误（可忽略/可重试）。统一实现，避免各模块漂移导致误判。 */
function isTransientNetworkError(err) {
    const msg = String((err && err.message) || err || '');
    if (!msg) return false;
    return [
        '连接未打开', '请求超时', '请求已中断',
        '连接关闭', '发送失败', '请求队列已满',
        '连接已在加密途中关闭', 'worker exited'
    ].some(keyword => msg.includes(keyword));
}

module.exports = {
    toLong, toNum, now,
    setLogHook,
    getServerTimeSec, syncServerTime, toTimeSec,
    log, logWarn, sleep, randomDelay,
    pad2, formatLocalDateTime24, isTransientNetworkError,
};
