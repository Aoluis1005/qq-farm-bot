const {
    findAccountByRef,
    normalizeAccountRef,
    resolveAccountId: resolveAccountIdByList
} = require('../services/account-resolver');
const { getSchedulerRegistrySnapshot } = require('../services/scheduler');

/**
 * 创建数据提供器 —— 封装对 Worker 的 API 调用，供 Admin Server 使用
 */
function createDataProvider(deps) {
    const {
        workers,
        globalLogs,
        accountLogs,
        store,
        getAccounts,
        callWorkerApi,
        buildDefaultStatus,
        normalizeStatusForPanel,
        filterLogs,
        nextConfigRevision,
        broadcastConfigToWorkers,
        startWorker,
        stopWorker,
        restartWorker,
        scheduleAutoCodeRefresh,
        refreshAccountCode
    } = deps;

    /** 获取账号列表 */
    function getAllAccountList() {
        const data = getAccounts();
        return Array.isArray(data.accounts) ? data.accounts : [];
    }

    /** 解析账号引用（account-ref / accountId） */
    function resolveAccountId(ref) {
        const normalized = normalizeAccountRef(ref);
        if (!normalized) return '';
        const id = resolveAccountIdByList(getAllAccountList(), normalized);
        return id || normalized;
    }

    /** 根据引用查找账号 */
    function findAccount(ref) {
        return findAccountByRef(getAllAccountList(), ref);
    }

    // 超时配置
    const FRIEND_TIMEOUT = { _timeoutMs: 180000 };       // 3分钟
    const SYNC_TIMEOUT = { _timeoutMs: 180000 };          // 3分钟
    const DOG_INFO_TIMEOUT = { _timeoutMs: 600000 };     // 10分钟

    return {
        /** 获取账号运行状态 */
        getStatus: (ref) => {
            const id = resolveAccountId(ref);
            if (!id) return buildDefaultStatus('');

            const worker = workers[id];
            if (!worker || !worker.status) return buildDefaultStatus(id);

            return {
                ...buildDefaultStatus(id),
                ...normalizeStatusForPanel(worker.status, id, worker.name),
                wsError: worker.wsError || null
            };
        },

        /** 获取日志 */
        getLogs: (ref, opts) => {
            const options = typeof opts === 'object' && opts ? opts : { limit: opts };
            const limit = Math.max(100, Number(options.limit) || 200);

            const normalized = normalizeAccountRef(ref);
            const id = resolveAccountId(ref);

            if (!normalized || normalized === 'all') {
                return filterLogs(globalLogs, options).slice(-limit);
            }

            if (!id) return [];

            const accountIdStr = String(id || '');
            return filterLogs(
                globalLogs.filter(e => String(e.accountId || '') === accountIdStr),
                options
            ).slice(-limit);
        },

        /** 获取账号操作日志 */
        getAccountLogs: (limit) => accountLogs.slice(-limit).reverse(),

        /** 清空日志 */
        clearLogs: (ref) => {
            const normalized = normalizeAccountRef(ref);
            const id = resolveAccountId(ref);

            if (!normalized || normalized === 'all') {
                globalLogs.length = 0;
                return { cleared: 'all' };
            }

            const result = { cleared: 0 };
            if (!id) return result;

            const idStr = String(id || '');
            const before = globalLogs.length;
            for (let i = globalLogs.length - 1; i >= 0; i--) {
                if (String(globalLogs[i].accountId || '') === idStr) {
                    globalLogs.splice(i, 1);
                }
            }
            const after = globalLogs.length;
            return { cleared: before - after, accountId: id };
        },

        // ========== Farm API ==========
        getLands: (ref) => callWorkerApi(resolveAccountId(ref), 'getLands'),
        getSeeds: (ref) => callWorkerApi(resolveAccountId(ref), 'getSeeds'),
        getBag: (ref) => callWorkerApi(resolveAccountId(ref), 'getBag'),
        getBagSeeds: (ref) => callWorkerApi(resolveAccountId(ref), 'getBagSeeds'),
        doFarmOp: (ref, op) => callWorkerApi(resolveAccountId(ref), 'doFarmOp', op),
        buyFertilizer: (ref, type, count) => callWorkerApi(resolveAccountId(ref), 'buyFertilizer', type, count),
        checkAndBuyFertilizer: (ref, opts) => callWorkerApi(resolveAccountId(ref), 'checkAndBuyFertilizer', opts),
        fertilizeLand: (ref, landId) => callWorkerApi(resolveAccountId(ref), 'fertilizeLand', landId),
        removePlant: (ref, landId) => callWorkerApi(resolveAccountId(ref), 'removePlant', landId),
        removeAllPlants: (ref) => callWorkerApi(resolveAccountId(ref), 'removeAllPlants'),
        getShopInfo: (ref, shopId) => callWorkerApi(resolveAccountId(ref), 'getShopInfo', shopId),
        buyGoods: (ref, shopId, goodsId, count) => callWorkerApi(resolveAccountId(ref), 'buyGoods', shopId, goodsId, count),
        doAnalytics: (ref, days) => callWorkerApi(resolveAccountId(ref), 'getAnalytics', days),

        // ========== Friend API ==========
        getFriends: (ref, force = false) => callWorkerApi(resolveAccountId(ref), 'getFriends', force,
            force ? FRIEND_TIMEOUT : undefined),
        clearFriendsCache: (ref) => callWorkerApi(resolveAccountId(ref), 'clearFriendsCache'),
        getInteractRecords: (ref) => callWorkerApi(resolveAccountId(ref), 'getInteractRecords'),
        getFriendLands: (ref, gid) => callWorkerApi(resolveAccountId(ref), 'getFriendLands', gid),
        doFriendOp: (ref, gid, op) => callWorkerApi(resolveAccountId(ref), 'doFriendOp', gid, op),
        getFriendDogInfo: (ref, gid) => callWorkerApi(resolveAccountId(ref), 'getFriendDogInfo', gid),
        batchGetFriendDogInfo: (ref, gids) => callWorkerApi(resolveAccountId(ref), 'batchGetFriendDogInfo', gids),
        syncFriendsFromGids: (ref, gids) => callWorkerApi(resolveAccountId(ref), 'syncFriendsFromGids', gids, SYNC_TIMEOUT),
        fetchFriendsDogInfo: (ref) => callWorkerApi(resolveAccountId(ref), 'fetchFriendsDogInfo', DOG_INFO_TIMEOUT),
        delFriend: (ref, gid) => callWorkerApi(resolveAccountId(ref), 'delFriend', gid),

        // ========== 仓库 ==========
        useItem: (ref, itemId, count) => callWorkerApi(resolveAccountId(ref), 'useItem', itemId, count),
        sellItems: (ref, items) => callWorkerApi(resolveAccountId(ref), 'sellItems', items),

        // ========== 每日礼包 ==========
        getDailyGifts: (ref) => callWorkerApi(resolveAccountId(ref), 'getDailyGiftOverview'),

        // ========== Mall ==========
        getMallGoods: (ref) => callWorkerApi(resolveAccountId(ref), 'getMallGoods'),
        buyMallGoods: (ref, goodsId, count) => callWorkerApi(resolveAccountId(ref), 'buyMallGoods', goodsId, count),
        getMysteryShop: (ref) => callWorkerApi(resolveAccountId(ref), 'getMysteryShop'),
        buyMysteryShopGoods: (ref, npcId) => callWorkerApi(resolveAccountId(ref), 'buyMysteryShopGoods', npcId),
        abandonMysteryShop: (ref) => callWorkerApi(resolveAccountId(ref), 'abandonMysteryShop'),

        // ========== Activity ==========
        getActivityShop: (ref) => callWorkerApi(resolveAccountId(ref), 'getActivityShop'),
        buyActivityShopItem: (ref, itemId, count) => callWorkerApi(resolveAccountId(ref), 'buyActivityShopItem', itemId, count),
        refreshActivityShop: (ref) => callWorkerApi(resolveAccountId(ref), 'refreshActivityShop'),
        getHeluActivity: (ref) => callWorkerApi(resolveAccountId(ref), 'getHeluActivity'),
        exchangeHeluShopItem: (ref, slotId, count) => callWorkerApi(resolveAccountId(ref), 'exchangeHeluShopItem', slotId, count),
        drawHeluGiftLotus: (ref, options) => callWorkerApi(resolveAccountId(ref), 'drawHeluGiftLotus', options || {}),
        claimSeasonPassportRewards: (ref) => callWorkerApi(resolveAccountId(ref), 'claimSeasonPassportRewards'),
        claimSolarTermsReward: (ref, termId) => callWorkerApi(resolveAccountId(ref), 'claimSolarTermsReward', termId),
        claimQingmeiSeeds: (ref) => callWorkerApi(resolveAccountId(ref), 'claimQingmeiSeeds'),
        brewAndSellQingmeiWine: (ref, options) => callWorkerApi(resolveAccountId(ref), 'brewAndSellQingmeiWine', options || {}),

        // ========== Illustrated ==========
        getIllustratedList: (ref, type, level) => callWorkerApi(resolveAccountId(ref), 'getIllustratedList', type, level),
        claimIllustratedRewards: (ref, type) => callWorkerApi(resolveAccountId(ref), 'claimIllustratedRewards', type),

        // ========== 配置 ==========
        setAutomation: async (ref, key, value) => {
            const id = resolveAccountId(ref);
            if (!id) throw new Error('Missing x-account-id');
            store.setAutomation(key, value, id);
            const rev = nextConfigRevision();
            broadcastConfigToWorkers(id);
            return { automation: store.getAutomation(id), configRevision: rev };
        },

        saveSettings: async (ref, settings) => {
            const id = resolveAccountId(ref);
            if (!id) throw new Error('Missing x-account-id');
            const s = settings && typeof settings === 'object' ? settings : {};
            const patch = {
                plantingStrategy: s.plantingStrategy !== undefined ? s.plantingStrategy : s.strategy,
                preferredSeedId: s.preferredSeedId !== undefined ? s.preferredSeedId : s.seedId,
                prioritize2x2Crops: s.prioritize2x2Crops,
                intervals: s.intervals,
                friendQuietHours: s.friendQuietHours,
                autoCodeRefresh: s.autoCodeRefresh,
                stealDelaySeconds: s.stealDelaySeconds,
                plantOrderRandom: s.plantOrderRandom,
                plantDelaySeconds: s.plantDelaySeconds,
                fertilizerBuyOrganicCount: s.fertilizerBuyOrganicCount,
                fertilizerBuyOrganicThresholdHours: s.fertilizerBuyOrganicThresholdHours,
                fertilizerBuyNormalCount: s.fertilizerBuyNormalCount,
                fertilizerBuyNormalThresholdHours: s.fertilizerBuyNormalThresholdHours,
                fertilizerBuyCheckIntervalMinutes: s.fertilizerBuyCheckIntervalMinutes,
                autoAcceptFriendMinLevel: s.autoAcceptFriendMinLevel,
                bagSeedPriority: s.bagSeedPriority,
                bagSeedFallbackStrategy: s.bagSeedFallbackStrategy,
            };
            store.applyConfigSnapshot(patch, { accountId: id });
            const rev = nextConfigRevision();
            broadcastConfigToWorkers(id);
            if (s.autoCodeRefresh && typeof scheduleAutoCodeRefresh === 'function') {
                scheduleAutoCodeRefresh(id);
            }
            return {
                strategy: store.getPlantingStrategy(id),
                preferredSeed: store.getPreferredSeed(id),
                prioritize2x2Crops: store.getPrioritize2x2Crops(id),
                intervals: store.getIntervals(id),
                friendQuietHours: store.getFriendQuietHours(id),
                autoCodeRefresh: store.getAutoCodeRefresh(id),
                stealDelaySeconds: store.getStealDelaySeconds(id),
                plantOrderRandom: store.getPlantOrderRandom(id),
                plantDelaySeconds: store.getPlantDelaySeconds(id),
                fertilizerBuyOrganicCount: store.getFertilizerBuyOrganicCount(id),
                fertilizerBuyOrganicThresholdHours: store.getFertilizerBuyOrganicThresholdHours(id),
                fertilizerBuyNormalCount: store.getFertilizerBuyNormalCount(id),
                fertilizerBuyNormalThresholdHours: store.getFertilizerBuyNormalThresholdHours(id),
                fertilizerBuyCheckIntervalMinutes: store.getFertilizerBuyCheckIntervalMinutes(id),
                autoAcceptFriendMinLevel: store.getAutoAcceptFriendMinLevel(id),
                bagSeedPriority: store.getBagSeedPriority(id),
                bagSeedFallbackStrategy: store.getBagSeedFallbackStrategy(id),
                configRevision: rev
            };
        },

        saveAutoCodeRefresh: async (ref, config) => {
            const id = resolveAccountId(ref);
            if (!id) throw new Error('Missing x-account-id');
            const data = store.setAutoCodeRefresh(id, config || {});
            if (typeof scheduleAutoCodeRefresh === 'function') scheduleAutoCodeRefresh(id);
            return { autoCodeRefresh: data };
        },

        refreshAccountCode: async (ref) => {
            const id = resolveAccountId(ref);
            if (!id) throw new Error('Missing x-account-id');
            if (typeof refreshAccountCode !== 'function') throw new Error('自动刷新服务不可用');
            const ok = await refreshAccountCode(id, 'manual');
            return { ok };
        },

        setUITheme: async (theme) => {
            const result = store.setUITheme(theme);
            return { ui: result.ui || store.getUI() };
        },

        broadcastConfig: (accountId) => {
            broadcastConfigToWorkers(accountId);
        },

        setRuntimeAccountName: (ref, name) => {
            const id = resolveAccountId(ref);
            if (!id) return;
            const worker = workers[id];
            if (worker) {
                worker.name = String(name || worker.name || id);
            }
        },

        // ========== 账号管理 ==========
        getAccounts: () => {
            const data = getAccounts();
            data.accounts.forEach(acc => {
                const worker = workers[acc.id];
                acc.running = !!worker;
                if (worker && worker.status && worker.status.status && worker.status.status.name) {
                    acc.nick = worker.status.status.name;
                }
            });
            return data;
        },

        startAccount: (ref) => {
            const id = resolveAccountId(ref);
            const account = findAccount(id || ref);
            if (!account) return false;
            startWorker(account);
            return true;
        },

        stopAccount: (ref) => {
            const id = resolveAccountId(ref);
            const account = findAccount(id || ref);
            if (!account) return false;
            if (id) stopWorker(id);
            return true;
        },

        restartAccount: (ref) => {
            const id = resolveAccountId(ref);
            const account = findAccount(id || ref);
            if (!account) return false;
            restartWorker(account);
            return true;
        },

        isAccountRunning: (ref) => {
            const id = resolveAccountId(ref);
            return !!(id && workers[id]);
        },

        getRunningAccountCount: () => Object.keys(workers).length,

        // ========== 调度器状态 ==========
        getSchedulerStatus: async (ref) => {
            const id = resolveAccountId(ref);
            const runtimeSchedulers = getSchedulerRegistrySnapshot();
            let workerSchedulers = null;
            let workerError = '';

            if (!id) {
                return { accountId: '', runtime: runtimeSchedulers, worker: workerSchedulers, workerError: '' };
            }

            if (!workers[id]) {
                return { accountId: id, runtime: runtimeSchedulers, worker: workerSchedulers, workerError: '账号未运行' };
            }

            try {
                workerSchedulers = await callWorkerApi(id, 'getSchedulers');
            } catch (err) {
                workerError = err && err.message ? err.message : String(err || 'unknown');
            }

            return { accountId: id, runtime: runtimeSchedulers, worker: workerSchedulers, workerError };
        }
    };
}

module.exports = { createDataProvider };
