const process = require('node:process');
const { parentPort, workerData } = require('node:worker_threads');

const { CONFIG } = require('../config/config');
const { getLevelExpProgress } = require('../config/gameConfig');
const {
    getAutomation,
    getPreferredSeed,
    getConfigSnapshot,
    applyConfigSnapshot
} = require('../models/store');
const {
    checkAndClaimEmails,
    getEmailDailyState
} = require('../services/email');
const {
    checkFarm,
    startFarmCheckLoop,
    stopFarmCheckLoop,
    refreshFarmCheckLoop,
    getLandsDetail,
    getAvailableSeeds,
    runFarmOperation,
    runFertilizerByConfig,
    ORGANIC_FERTILIZER_ID,
    fertilize,
    removePlant
} = require('../services/farm');
const {
    checkFriends,
    startFriendCheckLoop,
    stopFriendCheckLoop,
    refreshFriendCheckLoop,
    runBadOnceOnStartup,
    getFriendsList,
    getFriendLandsDetail,
    doFriendOperation,
    getFriendDogInfo,
    batchGetFriendDogInfo,
    syncFriendsFromGids,
    fetchFriendsDogInfo,
    delFriend
} = require('../services/friend');
const { getInteractRecords } = require('../services/interact');
const { processInviteCodes } = require('../services/invite');
const {
    autoBuyFertilizer,
    checkAndBuyFertilizerBoth,
    buyFreeGifts,
    getFreeGiftDailyState
} = require('../services/mall');
const {
    performDailyMonthCardGift,
    getMonthCardDailyState
} = require('../services/monthcard');
const {
    performDailyVipGift,
    getVipDailyState
} = require('../services/qqvip');
const {
    createScheduler,
    getSchedulerRegistrySnapshot
} = require('../services/scheduler');
const {
    performDailyShare,
    getShareDailyState
} = require('../services/share');
const {
    resetSessionGains,
    recordOperation,
    initStatsWithPersistence,
    saveStats
} = require('../services/stats');
const {
    initStatusBar,
    setStatusPlatform,
    setRecordGoldExpHook,
    statusData
} = require('../services/status');
const {
    cleanupTaskSystem,
    checkAndClaimTasks,
    getTaskClaimDailyState,
    getTaskDailyStateLikeApp,
    getGrowthTaskStateLikeApp
} = require('../services/task');
const {
    sellAllFruits,
    getBag,
    getBagItems,
    openFertilizerGiftPacksSilently
} = require('../services/warehouse');
const {
    connect,
    stopNetwork,
    getWs,
    getUserState,
    networkEvents
} = require('../utils/network');
const { loadProto } = require('../utils/proto');
const { setLogHook, log, toNum } = require('../utils/utils');

// 设置环境变量中的账号ID
if (parentPort && workerData && workerData.accountId && !process.env.FARM_ACCOUNT_ID) {
    process.env.FARM_ACCOUNT_ID = String(workerData.accountId);
}

// ==================== IPC 通信 ====================

/** 发送消息给主进程 */
function sendToMaster(message) {
    if (process.send) {
        process.send(message);
        return;
    }
    if (parentPort) {
        parentPort.postMessage(message);
    }
}

/** 监听主进程消息 */
function onMasterMessage(handler) {
    if (process.send) process.on('message', handler);
    if (parentPort) parentPort.on('message', handler);
}

/** 退出 Worker 进程 */
function exitWorker(code = 0) {
    if (parentPort) {
        try { parentPort.close(); } catch { }
    }
    setImmediate(() => process.exit(code));
}

// ==================== 格式化工具 ====================

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
    return `${yyyy  }-${  mm  }-${  dd  } ${  hh  }:${  min  }:${  ss}`;
}

// ==================== 日志/统计钩子 ====================

setLogHook((tag, msg, isWarn, meta) => {
    sendToMaster({
        type: 'log',
        data: {
            time: formatLocalDateTime24(new Date()),
            tag,
            msg,
            isWarn,
            meta: meta || {}
        }
    });
});

setRecordGoldExpHook((gold, exp) => {
    const { recordGoldExp } = require('../services/stats');
    recordGoldExp(gold, exp);
    sendToMaster({
        type: 'stat_update',
        data: { gold, exp }
    });
});

// ==================== 全局状态 ====================

let isRunning = false;
let loginReady = false;
let appliedConfigRevision = 0;
let unifiedSchedulerRunning = false;

// ==================== 工具函数 ====================

/** 判断是否是瞬时网络错误（可忽略） */
function isTransientNetworkError(err) {
    const msg = String(err && err.message || '');
    if (!msg) return false;
    return ['连接未打开', '请求超时', '请求已中断', '连接关闭', '发送失败', '请求队列已满']
        .some(text => msg.includes(text));
}

// ==================== 农场/好友/偷菜 Tick 任务 ====================

let farmTaskRunning = false;
let nextFarmRunAt = 0;
let lastStatusHash = '';
let lastStatusSentAt = 0;
let onSellGain = null;
let onFarmHarvested = null;
let harvestSellRunning = false;
let onWsError = null;
let onDisconnectHandler = null;
let wsErrorHandledAt = 0;
let lastDailyRunDate = '';
let friendSyncPaused = false;

const workerScheduler = createScheduler('worker');

/** 每日任务是否启用 */
function isDailyRoutineEnabled() { return true; }

/** 获取当天日期键 */
function getLocalDateKey() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y  }-${  m  }-${  day}`;
}

// ==================== 每日任务 ====================

async function runDailyRoutines(force = false) {
    if (!loginReady || friendSyncPaused) return;
    try {
        await checkAndClaimEmails(force);
        await performDailyShare(force);
        await performDailyMonthCardGift(force);
        await buyFreeGifts(force);
        await performDailyVipGift(force);
    } catch (err) {
        log('系统', `每日任务调度失败: ${  err.message}`, {
            module: 'system',
            event: '每日任务',
            result: 'error'
        });
    }
}

function stopDailyRoutineTimer() {
    workerScheduler.clear('daily_routine_interval');
}

function startDailyRoutineTimer() {
    stopDailyRoutineTimer();
    lastDailyRunDate = getLocalDateKey();
    runDailyRoutines(true).catch(() => null);

    // 每 60 秒检查一次日期是否变化
    workerScheduler.setIntervalTask('daily_routine_interval', 60000, () => {
        if (!loginReady) return;
        const today = getLocalDateKey();
        if (today === lastDailyRunDate) return;
        lastDailyRunDate = today;
        runDailyRoutines(true)
            .then(() => runBadOnceOnStartup(true))
            .catch(() => null);
    });
}

// ==================== 间隔计算 ====================

function normalizeIntervalRangeSec(minVal, maxVal, defaultVal) {
    const def = Math.max(1, Number.parseInt(defaultVal, 10) || 3);
    let min = Math.max(1, Number.parseInt(minVal, 10) || def);
    let max = Math.max(1, Number.parseInt(maxVal, 10) || def);
    if (min > max) [min, max] = [max, min];
    return { min, max };
}

function applyIntervalsToRuntime(intervals) {
    const iv = intervals && typeof intervals === 'object' ? intervals : {};
    const farmDefault = Math.max(2, Number.parseInt(iv.farm, 10) || 2);
    const farmRange = normalizeIntervalRangeSec(iv.farmMin, iv.farmMax, farmDefault);
    CONFIG.farmCheckIntervalMin = farmRange.min * 1000;
    CONFIG.farmCheckIntervalMax = farmRange.max * 1000;
    CONFIG.farmCheckInterval = CONFIG.farmCheckIntervalMin;

    const helpRange = normalizeIntervalRangeSec(iv.helpMin, iv.helpMax, 30);
    CONFIG.helpCheckIntervalMin = helpRange.min * 1000;
    CONFIG.helpCheckIntervalMax = helpRange.max * 1000;

    const stealRange = normalizeIntervalRangeSec(iv.stealMin, iv.stealMax, 25);
    CONFIG.stealCheckIntervalMin = stealRange.min * 1000;
    CONFIG.stealCheckIntervalMax = stealRange.max * 1000;
}

/** 在 [minMs, maxMs] 范围内随机取一个毫秒数 */
function randomIntervalMs(minMs, maxMs) {
    const min = Math.max(1, Math.floor(Number(minMs) || 3));
    const max = Math.max(min, Math.floor(Number(maxMs) || min * 2));
    if (max === min) return min;
    return min + Math.floor(Math.random() * (max - min + 1));
}

// ==================== 统一调度时间重置 ====================

function resetUnifiedSchedule() {
    const farmDelay = randomIntervalMs(
        CONFIG.farmCheckIntervalMin || CONFIG.farmCheckInterval || 3000,
        CONFIG.farmCheckIntervalMax || CONFIG.farmCheckInterval || 5000
    );
    const helpDelay = randomIntervalMs(
        CONFIG.helpCheckIntervalMin || 30000,
        CONFIG.helpCheckIntervalMax || 35000
    );
    const stealDelay = randomIntervalMs(
        CONFIG.stealCheckIntervalMin || 25000,
        CONFIG.stealCheckIntervalMax || 30000
    );
    const now = Date.now();
    nextFarmRunAt = now + farmDelay;
    nextHelpRunAt = now + helpDelay;
    nextStealRunAt = now + stealDelay;
}

// ==================== 农场 Tick ====================

async function runFarmTick(autoConfig) {
    if (farmTaskRunning || friendSyncPaused) return;
    farmTaskRunning = true;

    const nextDelay = randomIntervalMs(
        CONFIG.farmCheckIntervalMin || CONFIG.farmCheckInterval || 3000,
        CONFIG.farmCheckIntervalMax || CONFIG.farmCheckInterval || 5000
    );

    try {
        if (autoConfig.farm) await checkFarm();
        if (autoConfig.task) await checkAndClaimTasks();
        if (autoConfig.email) await checkAndClaimEmails();
        if (autoConfig.fertilizer_gift) await openFertilizerGiftPacksSilently();
    } catch { } finally {
        nextFarmRunAt = Date.now() + nextDelay;
        farmTaskRunning = false;
    }
}

// ==================== 帮助 Tick ====================

let helpTaskRunning = false;
let nextHelpRunAt = 0;

async function runHelpTick(autoConfig) {
    if (helpTaskRunning || friendSyncPaused) return;
    if (!autoConfig.friend_help) return;
    helpTaskRunning = true;

    const nextDelay = randomIntervalMs(
        CONFIG.helpCheckIntervalMin || 30000,
        CONFIG.helpCheckIntervalMax || 35000
    );

    try {
        await checkFriends({ onlyHelp: true });
    } catch (err) {
        if (!isTransientNetworkError(err)) {
            log('系统', `帮助巡查执行失败: ${  err.message}`, {
                module: 'system',
                event: '帮助巡查',
                result: 'error'
            });
        }
    } finally {
        nextHelpRunAt = Date.now() + nextDelay;
        helpTaskRunning = false;
    }
}

// ==================== 偷菜 Tick ====================

let stealTaskRunning = false;
let nextStealRunAt = 0;

async function runStealTick(autoConfig) {
    if (stealTaskRunning || friendSyncPaused) return;
    if (!autoConfig.friend_steal) return;
    stealTaskRunning = true;

    const nextDelay = randomIntervalMs(
        CONFIG.stealCheckIntervalMin || 25000,
        CONFIG.stealCheckIntervalMax || 30000
    );

    try {
        await checkFriends({ onlySteal: true });
    } catch (err) {
        if (!isTransientNetworkError(err)) {
            log('系统', `偷菜巡查执行失败: ${  err.message}`, {
                module: 'system',
                event: '偷菜巡查',
                result: 'error'
            });
        }
    } finally {
        nextStealRunAt = Date.now() + nextDelay;
        stealTaskRunning = false;
    }
}

// ==================== 统一调度器 ====================

async function runUnifiedTick() {
    if (!unifiedSchedulerRunning || !loginReady || friendSyncPaused) return;

    const now = Date.now();
    const shouldFarm = now >= nextFarmRunAt;
    const shouldHelp = now >= nextHelpRunAt;
    const shouldSteal = now >= nextStealRunAt;

    if (!shouldFarm && !shouldHelp && !shouldSteal) return;

    const autoConfig = getAutomation();
    if (shouldFarm) await runFarmTick(autoConfig);
    if (shouldHelp) await runHelpTick(autoConfig);
    if (shouldSteal) await runStealTick(autoConfig);
}

function scheduleUnifiedNextTick() {
    if (!unifiedSchedulerRunning) return;
    workerScheduler.clear('unified_next_tick');

    if (!loginReady) {
        workerScheduler.setTimeoutTask('unified_next_tick', 500, async () => {
            try { await runUnifiedTick(); } finally { scheduleUnifiedNextTick(); }
        });
        return;
    }

    const now = Date.now();
    const nearest = Math.min(
        Number(nextFarmRunAt) || now + 3000,
        Number(nextHelpRunAt) || now + 30000,
        Number(nextStealRunAt) || now + 25000
    );
    const waitMs = Math.max(100, nearest - now);

    workerScheduler.setTimeoutTask('unified_next_tick', waitMs, async () => {
        try { await runUnifiedTick(); } finally { scheduleUnifiedNextTick(); }
    });
}

function startUnifiedScheduler() {
    if (unifiedSchedulerRunning) return;
    unifiedSchedulerRunning = true;
    resetUnifiedSchedule();
    scheduleUnifiedNextTick();
}

function stopUnifiedScheduler() {
    unifiedSchedulerRunning = false;
    farmTaskRunning = false;
    helpTaskRunning = false;
    stealTaskRunning = false;
    workerScheduler.clear('unified_next_tick');
}

// ==================== 配置同步 ====================

function applyRuntimeConfig(config, syncStatusAfter = false) {
    const prevAuto = getAutomation();
    const accountId = process.env.FARM_ACCOUNT_ID || '';

    applyConfigSnapshot(config || {}, {
        persist: false,
        accountId
    });

    const revision = Number((config || {}).__revision || 0);
    if (revision > 0) appliedConfigRevision = revision;

    const intervals = config && config.intervals && typeof config.intervals === 'object'
        ? config.intervals : null;
    if (intervals) applyIntervalsToRuntime(intervals);

    if (loginReady) {
        refreshFarmCheckLoop(3000);
        refreshFriendCheckLoop(12000);
        resetUnifiedSchedule();
        scheduleUnifiedNextTick();

        const hasAutomation = !!(config && config.automation && typeof config.automation === 'object');
        if (hasAutomation) {
            const newAuto = getAutomation();

            // 每日任务从关变开 → 立即执行一次
            const prevDailyEnabled = isDailyRoutineEnabled(prevAuto);
            const newDailyEnabled = isDailyRoutineEnabled(newAuto);
            if (!prevDailyEnabled && newDailyEnabled) {
                workerScheduler.setTimeoutTask('daily_routine_immediate', 2000, () => {
                    runDailyRoutines(true).catch(() => null);
                });
            }

            // 施肥策略变化 → 立即施肥
            const prevFert = String(prevAuto && prevAuto.fertilizer ? prevAuto.fertilizer : '').toLowerCase();
            const newFert = String(newAuto && newAuto.fertilizer ? newAuto.fertilizer : '').toLowerCase();
            const fertChanged = prevFert !== newFert;
            if (fertChanged && (newFert === 'both' || newFert === 'organic' || newFert === 'smart' || newFert === 'smart_only' || newFert === 'smart_normal' || newFert === 'final_normal' || newFert === 'final_organic')) {
                workerScheduler.setTimeoutTask('fertilizer_immediate_after_save', 1000, async () => {
                    if (!loginReady) return;
                    try {
                        await runFertilizerByConfig([], { skipNormal: true });
                    } catch (err) {
                        log('施肥', `保存配置后立即施肥失败: ${  err.message}`, {
                            module: 'farm', event: '施肥', result: 'error'
                        });
                    }
                });
            }

            // 好友捣乱从关变开 → 立即执行
            const prevBad = !!(prevAuto && prevAuto.friend_bad);
            const newBad = !!(newAuto && newAuto.friend_bad);
            if (!prevBad && newBad) {
                workerScheduler.setTimeoutTask('friend_bad_immediate', 3000, async () => {
                    if (!loginReady) return;
                    try {
                        await runBadOnceOnStartup(true);
                    } catch (err) {
                        log('好友', `开启自动捣乱后立即执行失败: ${  err.message}`, {
                            module: 'friend', event: '开启捣乱立即执行', result: 'error'
                        });
                    }
                });
            }
        }
    }

    if (syncStatusAfter) syncStatus();
}

// ==================== 主控消息处理 ====================

onMasterMessage(async (msg) => {
    try {
        if (msg.type === 'start') {
            await startBot(msg.config);
        } else if (msg.type === 'stop') {
            await stopBot();
        } else if (msg.type === 'api_call') {
            handleApiCall(msg);
        } else if (msg.type === 'config_sync') {
            applyRuntimeConfig(msg.config || {}, true);
        }
    } catch (err) {
        sendToMaster({ type: 'error', error: err.message });
    }
});

// ==================== 启动/停止 Bot ====================

async function startBot(config) {
    if (isRunning) return;
    isRunning = true;

    const { code, platform } = config;
    CONFIG.platform = platform || 'qq';

    await loadProto();
    log('系统', '正在连接服务器...');

    applyRuntimeConfig(getConfigSnapshot(), false);
    initStatusBar();
    setStatusPlatform(CONFIG.platform);

    // WebSocket 错误监听
    if (onWsError) {
        networkEvents.off('ws_error', onWsError);
        onWsError = null;
    }
    onWsError = (wsErr) => {
        if ((Number(wsErr?.code) || 0) !== 400) return;
        const now = Date.now();
        if (now - wsErrorHandledAt < 5000) return;
        wsErrorHandledAt = now;

        log('系统', '连接被拒绝，可能需要更新 Code');
        sendToMaster({
            type: 'ws_error',
            code: 400,
            message: wsErr?.message || ''
        });
        if (isRunning) {
            workerScheduler.setTimeoutTask('ws_error_cleanup', 500, () => {
                if (isRunning) stopBot().catch(() => exitWorker(0));
            });
        }
    };
    networkEvents.on('ws_error', onWsError);
    networkEvents.on('reconnect_failed', onReconnectFailed);
    networkEvents.on('kickout', onKickout);

    // 断线监听
    if (onDisconnectHandler) networkEvents.off('disconnect', onDisconnectHandler);
    onDisconnectHandler = () => {
        if (!loginReady) return;
        loginReady = false;
        log('系统', '连接断开，暂停自动化任务，等待重连...');
    };
    networkEvents.on('disconnect', onDisconnectHandler);

    // 登录成功回调
    const onReady = async () => {
        loginReady = true;

        // 出售收益监听
        if (onSellGain) networkEvents.off('sell', onSellGain);
        onSellGain = (sellInfo) => {
            const gold = Number(sellInfo && sellInfo.gold || sellInfo || 0);
            const count = Number(sellInfo && sellInfo.count || 0);
            if (!Number.isFinite(gold) || gold <= 0) return;
            if (count > 0) recordOperation('sell', count);
        };
        networkEvents.on('sell', onSellGain);

        // 收获后自动出售
        if (onFarmHarvested) networkEvents.off('farmHarvested', onFarmHarvested);
        onFarmHarvested = async () => {
            if (harvestSellRunning) return;
            if (!getAutomation().sell) return;
            harvestSellRunning = true;
            try {
                await sellAllFruits();
            } catch (err) {
                log('仓库', `收获后自动出售失败: ${  err.message}`, {
                    module: 'warehouse', event: '收获后出售', result: 'error'
                });
            } finally {
                harvestSellRunning = false;
            }
        };
        networkEvents.on('farmHarvested', onFarmHarvested);

        // 获取背包点券数
        try {
            const bag = await getBag();
            const items = getBagItems(bag);
            let couponCount = 0;
            for (const item of items || []) {
                if (toNum(item && item.id) === 1002) {
                    couponCount = toNum(item.count);
                    break;
                }
            }
            const state = getUserState();
            state.coupon = Math.max(0, couponCount);
        } catch { }

        // 初始化统计数据
        const userState = getUserState();
        const accountId = process.env.FARM_ACCOUNT_ID || '';
        initStatsWithPersistence(
            accountId,
            Number(userState.gold || 0),
            Number(userState.exp || 0),
            Number(userState.coupon || 0)
        );
        resetSessionGains();

        // 处理邀请码
        await processInviteCodes();

        // 打开肥料礼包
        if (getAutomation().fertilizer_gift) {
            await openFertilizerGiftPacksSilently().catch(() => 0);
        }

        // 延迟执行放虫放草
        workerScheduler.setTimeoutTask('bad_startup_once', 15000, async () => {
            try {
                await runBadOnceOnStartup();
            } catch (err) {
                log('好友', `启动时放虫放草执行失败: ${  err.message}`, {
                    module: 'friend', event: '启动放虫放草失败', error: err.message
                });
            }
        });

        // 启动各检查循环
        startFarmCheckLoop({ externalScheduler: true });
        startFriendCheckLoop({ externalScheduler: true });

        // 启动统一调度器
        if (unifiedSchedulerRunning) {
            resetUnifiedSchedule();
            scheduleUnifiedNextTick();
        } else {
            startUnifiedScheduler();
        }

        // 启动每日定时器
        startDailyRoutineTimer();

        syncStatus();
    };

    // 建立连接
    connect(code, onReady);

    // 定期同步状态
    workerScheduler.setIntervalTask('status_sync', 5000, syncStatus, { preventOverlap: true });
}

async function stopBot() {
    if (!isRunning) return exitWorker(0);
    saveStats();
    isRunning = false;
    loginReady = false;
    friendSyncPaused = false;

    stopUnifiedScheduler();

    networkEvents.off('kickout', onKickout);
    networkEvents.off('reconnect_failed', onReconnectFailed);

    if (onDisconnectHandler) {
        networkEvents.off('disconnect', onDisconnectHandler);
        onDisconnectHandler = null;
    }
    if (onWsError) {
        networkEvents.off('ws_error', onWsError);
        onWsError = null;
    }
    if (onSellGain) {
        networkEvents.off('sell', onSellGain);
        onSellGain = null;
    }
    if (onFarmHarvested) {
        networkEvents.off('farmHarvested', onFarmHarvested);
        onFarmHarvested = null;
    }

    stopFarmCheckLoop();
    stopFriendCheckLoop();
    stopDailyRoutineTimer();
    cleanupTaskSystem();
    workerScheduler.clearAll();
    stopNetwork('账号停止');

    const ws = getWs();
    if (ws) ws.close();

    exitWorker(0);
}

// ==================== 踢下线处理 ====================

function onKickout(info) {
    const reason = info && info.reason ? info.reason : '未知';
    log('系统', `检测到踢下线，准备自动停止账号。原因: ${  reason}`);
    sendToMaster({ type: 'account_kicked', reason });
    workerScheduler.setTimeoutTask('kickout_stop', 500, () => {
        stopBot().catch(() => exitWorker(0));
    });
}

function onReconnectFailed(info) {
    const reason = info && info.reason ? info.reason : '未知';
    log('系统', `连接多次重试失败，准备停止账号。原因: ${  reason}`);
    sendToMaster({ type: 'ws_reconnect_failed', reason });
    stopBot().catch(() => exitWorker(0));
}

// ==================== API 调用处理 ====================

async function handleApiCall(msg) {
    const { id, method, args } = msg;
    let result = null;
    let error = null;

    // 好友同步操作期间暂停自动化
    const isFriendSync = method === 'getFriends' && args[0] === true
        || method === 'fetchFriendsDogInfo'
        || method === 'syncFriendsFromGids';

    if (isFriendSync) {
        friendSyncPaused = true;
        log('系统', '好友同步操作开始，已暂停其他自动化进程', {
            module: 'system', event: '好友同步暂停', method
        });
    }

    try {
        switch (method) {
            case 'getLands':
                result = await getLandsDetail();
                break;
            case 'getFriends':
                result = await getFriendsList(args[0] === true);
                break;
            case 'clearFriendsCache':
                require('../services/friend').clearFriendsListCache();
                result = { ok: true };
                break;
            case 'getInteractRecords':
                result = await getInteractRecords();
                break;
            case 'getFriendLands':
                result = await getFriendLandsDetail(args[0]);
                break;
            case 'doFriendOp':
                result = await doFriendOperation(args[0], args[1]);
                break;
            case 'getFriendDogInfo':
                result = await getFriendDogInfo(args[0]);
                break;
            case 'batchGetFriendDogInfo':
                result = await batchGetFriendDogInfo(args[0]);
                break;
            case 'syncFriendsFromGids':
                result = await syncFriendsFromGids(args[0]);
                break;
            case 'fetchFriendsDogInfo':
                result = await fetchFriendsDogInfo();
                break;
            case 'delFriend':
                result = await delFriend(args[0]);
                break;
            case 'getSeeds':
                result = await getAvailableSeeds();
                break;
            case 'getBag':
                result = await require('../services/warehouse').getBagDetail();
                break;
            case 'getBagSeeds':
                result = await require('../services/warehouse').getBagSeeds();
                break;
            case 'useItem': {
                const { useItem } = require('../services/warehouse');
                const itemId = Number(args[0]) || 0;
                const count = Math.max(1, Number(args[1]) || 1);
                result = await useItem(itemId, count, []);
                break;
            }
            case 'sellItems': {
                const { sellItems } = require('../services/warehouse');
                const items = Array.isArray(args[0]) ? args[0] : [];
                const totalCount = items.reduce((sum, it) => sum + (Number(it.count) || 0), 0);
                result = await sellItems(items.map(it => ({
                    id: it.id, count: it.count, uid: it.uid || 0
                })));
                if (totalCount > 0) recordOperation('sell', totalCount);
                break;
            }
            case 'setAutomation': {
                const item = args && args[0] ? args[0] : {};
                const patch = { [item.key]: item.value };
                applyRuntimeConfig({ automation: patch }, true);
                result = getAutomation();
                break;
            }
            case 'doFarmOp':
                result = await runFarmOperation(args[0]);
                break;
            case 'buyFertilizer': {
                const fertType = args[0] || 'organic';
                const count = Number(args[1]) || 1;
                result = await autoBuyFertilizer(true, fertType, count);
                break;
            }
            case 'checkAndBuyFertilizer': {
                const opts = args[0] || {};
                result = await checkAndBuyFertilizerBoth(opts);
                break;
            }
            case 'getAnalytics': {
                const { getPlantRankings } = require('../services/analytics');
                result = getPlantRankings(args[0]);
                break;
            }
            case 'getShopInfo': {
                const { getShopInfo } = require('../services/farm');
                result = await getShopInfo(args[0]);
                break;
            }
            case 'buyGoods': {
                const { buyGoods } = require('../services/farm');
                result = await buyGoods(args[0], args[1], args[2]);
                break;
            }
            case 'getMallGoods': {
                const { getMallGoodsList } = require('../services/mall');
                result = await getMallGoodsList(0);
                break;
            }
            case 'buyMallGoods': {
                const { purchaseMallGoods } = require('../services/mall');
                result = await purchaseMallGoods(args[0], args[1]);
                break;
            }
            case 'getMysteryShop': {
                const { getActiveMysteryShop } = require('../services/mystery-shop');
                result = await getActiveMysteryShop();
                break;
            }
            case 'buyMysteryShopGoods': {
                const { buyMysteryShopGoods } = require('../services/mystery-shop');
                result = await buyMysteryShopGoods(args[0]);
                break;
            }
            case 'abandonMysteryShop': {
                const { abandonMysteryShop } = require('../services/mystery-shop');
                result = await abandonMysteryShop();
                break;
            }
            case 'getActivityShop': {
                const { getNanguaShop } = require('../services/activity');
                result = await getNanguaShop();
                break;
            }
            case 'buyActivityShopItem': {
                const { buyNanguaShopItem } = require('../services/activity');
                result = await buyNanguaShopItem(args[0], args[1]);
                break;
            }
            case 'refreshActivityShop': {
                const { refreshNanguaShop } = require('../services/activity');
                result = await refreshNanguaShop();
                break;
            }
            case 'getHeluActivity': {
                const { getHeluActivity } = require('../services/activity');
                result = await getHeluActivity();
                break;
            }
            case 'exchangeHeluShopItem': {
                const { exchangeHeluShopItem } = require('../services/activity');
                result = await exchangeHeluShopItem(args[0], args[1]);
                break;
            }
            case 'drawHeluGiftLotus': {
                const { drawHeluGiftLotus } = require('../services/activity');
                result = await drawHeluGiftLotus(args[0] || {});
                break;
            }
            case 'claimSeasonPassportRewards': {
                const { claimSeasonPassportRewards } = require('../services/activity');
                result = await claimSeasonPassportRewards();
                break;
            }
            case 'claimSolarTermsReward': {
                const { claimSolarTermsReward } = require('../services/activity');
                result = await claimSolarTermsReward(args[0]);
                break;
            }
            case 'claimQingmeiSeeds': {
                const { claimQingmeiSeeds } = require('../services/activity');
                result = await claimQingmeiSeeds();
                break;
            }
            case 'brewAndSellQingmeiWine': {
                const { brewAndSellQingmeiWine } = require('../services/activity');
                result = await brewAndSellQingmeiWine(args[0] || {});
                break;
            }
            case 'getIllustratedList': {
                const { getIllustratedListV2 } = require('../services/illustrated');
                result = await getIllustratedListV2(args[0], args[1]);
                break;
            }
            case 'claimIllustratedRewards': {
                const { claimAllRewardsV2 } = require('../services/illustrated');
                result = await claimAllRewardsV2(args[0]);
                break;
            }
            case 'getDailyGiftOverview':
                result = await getDailyGiftOverview();
                break;
            case 'getSchedulers':
                result = getSchedulerRegistrySnapshot();
                break;
            case 'fertilizeLand': {
                const landId = Number(args[0]) || 0;
                if (!landId) {
                    error = '无效的土地ID';
                } else {
                    log('施肥', `正在对土地 ${  landId  } 使用有机肥料催熟`, {
                        module: 'farm', event: '催熟', landId
                    });
                    const fertilizeCount = await fertilize([landId], ORGANIC_FERTILIZER_ID);
                    if (fertilizeCount > 0) {
                        log('施肥', `土地 ${  landId  } 催熟成功`, {
                            module: 'farm', event: '催熟', result: 'ok', landId
                        });
                        result = { success: true, count: fertilizeCount };
                    } else {
                        log('施肥', `土地 ${  landId  } 催熟失败，可能有机肥料不足`, {
                            module: 'farm', event: '催熟', result: 'error', landId
                        });
                        result = { success: false, count: 0 };
                    }
                }
                break;
            }
            case 'removePlant': {
                const landId = Number(args[0]) || 0;
                if (!landId) {
                    error = '无效的土地ID';
                } else {
                    result = await removePlant([landId]);
                }
                break;
            }
            case 'removeAllPlants': {
                const landsDetail = await getLandsDetail();
                const lands = landsDetail?.lands || [];
                const occupiedLands = lands
                    .filter(l => l && l.unlocked && l.status !== 'empty' && l.status !== 'locked')
                    .map(l => l.id);

                if (occupiedLands.length === 0) {
                    result = { removed: 0, message: '没有可铲除的作物' };
                } else {
                    await removePlant(occupiedLands);
                    log('铲除', `已铲除 ${  occupiedLands.length  } 块土地上的作物`, {
                        module: 'farm', event: '一键铲除', result: 'ok', count: occupiedLands.length
                    });
                    result = { removed: occupiedLands.length };
                }
                break;
            }
            default:
                error = 'Unknown method';
        }
    } catch (err) {
        error = err.message;
    }

    if (isFriendSync) {
        friendSyncPaused = false;
        log('系统', '好友同步操作完成，已恢复自动化进程', {
            module: 'system', event: '好友同步恢复', method
        });
    }

    sendToMaster({
        type: 'api_response',
        id,
        result,
        error
    });
}

// ==================== 每日礼包总览 ====================

async function getDailyGiftOverview() {
    const auto = getAutomation() || {};

    const taskState = getTaskDailyStateLikeApp
        ? await getTaskDailyStateLikeApp()
        : getTaskClaimDailyState ? getTaskClaimDailyState() : { doneToday: false, lastClaimAt: 0 };

    const growthState = getGrowthTaskStateLikeApp
        ? await getGrowthTaskStateLikeApp()
        : { doneToday: false, completedCount: 0, totalCount: 0, tasks: [] };

    const emailState = getEmailDailyState
        ? getEmailDailyState()
        : { doneToday: false, lastCheckAt: 0 };

    const freeGiftState = getFreeGiftDailyState
        ? getFreeGiftDailyState()
        : { doneToday: false, lastClaimAt: 0 };

    const shareState = getShareDailyState
        ? getShareDailyState()
        : { doneToday: false, lastClaimAt: 0 };

    const vipState = getVipDailyState
        ? getVipDailyState()
        : { doneToday: false, lastClaimAt: 0 };

    const monthCardState = getMonthCardDailyState
        ? getMonthCardDailyState()
        : { doneToday: false, lastClaimAt: 0 };

    return {
        date: new Date().toISOString().slice(0, 10),
        growth: {
            key: 'growth_task',
            label: '成长任务',
            doneToday: !!growthState.doneToday,
            completedCount: Number(growthState.completedCount || 0),
            totalCount: Number(growthState.totalCount || 0),
            tasks: Array.isArray(growthState.tasks) ? growthState.tasks : []
        },
        gifts: [
            {
                key: 'task_claim',
                label: '每日任务',
                enabled: !!auto.task,
                doneToday: !!taskState.doneToday,
                lastAt: Number(taskState.lastClaimAt || 0),
                completedCount: Number(taskState.completedCount || 0),
                totalCount: Number(taskState.totalCount || 0)
            },
            {
                key: 'email_rewards',
                label: '邮箱奖励',
                enabled: true,
                doneToday: !!emailState.doneToday,
                lastAt: Number(emailState.lastCheckAt || 0)
            },
            {
                key: 'mall_free_gifts',
                label: '商城免费礼包',
                enabled: true,
                doneToday: !!freeGiftState.doneToday,
                lastAt: Number(freeGiftState.lastClaimAt || 0)
            },
            {
                key: 'daily_share',
                label: '分享礼包',
                enabled: true,
                doneToday: !!shareState.doneToday,
                lastAt: Number(shareState.lastClaimAt || 0)
            },
            {
                key: 'vip_daily_gift',
                label: '会员礼包',
                enabled: true,
                doneToday: !!vipState.doneToday,
                lastAt: Number(vipState.lastClaimAt || vipState.lastCheckAt || 0),
                hasGift: Object.hasOwn(vipState, 'hasGift') ? !!vipState.hasGift : undefined,
                canClaim: Object.hasOwn(vipState, 'canClaim') ? !!vipState.canClaim : undefined,
                result: vipState.result || ''
            },
            {
                key: 'month_card_gift',
                label: '月卡礼包',
                enabled: true,
                doneToday: !!monthCardState.doneToday,
                lastAt: Number(monthCardState.lastClaimAt || monthCardState.lastCheckAt || 0),
                hasCard: Object.hasOwn(monthCardState, 'hasCard') ? !!monthCardState.hasCard : undefined,
                hasClaimable: Object.hasOwn(monthCardState, 'hasClaimable') ? !!monthCardState.hasClaimable : undefined,
                result: monthCardState.result || ''
            }
        ]
    };
}

// ==================== 状态同步 ====================

function syncStatus() {
    if (!process.send && !parentPort) return;

    const userState = getUserState();
    const ws = getWs();
    const connected = !!(loginReady && ws && ws.readyState === 1);

    let levelProgress = null;
    const level = userState.level ?? statusData.level ?? 0;
    const exp = userState.exp ?? statusData.exp ?? 0;
    if (level > 0 && exp >= 0) {
        levelProgress = getLevelExpProgress(level, exp);
    }

    const limits = require('../services/friend').getOperationLimits();
    const stats = require('../services/stats').getStats(statusData, userState, connected, limits);

    const now = Date.now();
    const farmRemainSec = Math.max(0, Math.ceil((Number(nextFarmRunAt || 0) - now) / 1000));
    const helpRemainSec = Math.max(0, Math.ceil((Number(nextHelpRunAt || 0) - now) / 1000));
    const stealRemainSec = Math.max(0, Math.ceil((Number(nextStealRunAt || 0) - now) / 1000));

    stats.nextChecks = {
        farmRemainSec,
        helpRemainSec,
        stealRemainSec,
        friendRemainSec: Math.max(helpRemainSec, stealRemainSec)
    };
    stats.automation = getAutomation();
    stats.preferredSeed = getPreferredSeed();
    stats.levelProgress = levelProgress;
    stats.configRevision = appliedConfigRevision;

    const hash = JSON.stringify(stats);
    const now2 = Date.now();

    if (hash !== lastStatusHash || now2 - lastStatusSentAt > 30000) {
        lastStatusHash = hash;
        lastStatusSentAt = now2;
        sendToMaster({ type: 'status_sync', data: stats });
    }
}
