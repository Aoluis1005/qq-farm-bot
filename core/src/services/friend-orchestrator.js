const { CONFIG } = require('../config/config');
const {
  isAutomationOn,
  getFriendBlacklist,
  getFriendBlacklistDetails,
  getAutoAcceptFriendMinLevel,
  getKnownFriendGids,
  applyConfigSnapshot,
  getConfigSnapshot,
  getFriendBadRetryDate,
  readFriendDogInfoCache,
} = require('../models/store');
const { getUserState, isConnected, networkEvents } = require('../utils/network');
const { toNum, log, logWarn, randomDelay, isTransientNetworkError } = require('../utils/utils');
const {
  setOperationLimitsCallback,
  stopFarmCheckLoop,
  startFarmCheckLoop,
} = require('./farm');
const { stopFertilizerBuyCheckTimer, startFertilizerBuyCheckTimer } = require('./farm-scheduler');
const { stopMysteryAutoBuyTimer, startMysteryAutoBuyTimer } = require('./mystery-scheduler');
const { createScheduler } = require('./scheduler');
const {
  getAllFriends,
  extractReplyFriends,
  inFriendQuietHours,
  postToMaster,
  normalizeFriendGids,
  acceptFriends,
  getApplications,
  clearAllInvalidKnownFriendGidCooldown,
} = require('./friend-api');
const {
  checkDailyReset,
  canOperate,
  canOperateBad,
  canGetExpByCandidates,
  hasKnownHelpExpLimits,
  getCanGetHelpExp,
  setCanGetHelpExp,
  getHelpAutoDisabledByLimit,
  setOnExpLimitReachedCallback,
  setOnExpLimitResetCallback,
  updateOperationLimits,
} = require('./friend-operation-limits');
const {
  visitFriend,
  visitFriendForSteal,
  visitFriendForHelp,
} = require('./friend-visit');
const { sellAllFruits } = require('./warehouse');
const {
  getFriendsList,
  fetchFriendsDogInfo,
  setFriendsListCache,
} = require('./friend-land-analyzer');

// ===== State =====
let isCheckingFriends = false;
let friendLoopRunning = false;
let externalSchedulerMode = false;

// ===== 极速务农独占模式 =====
// 设计：极速务农开启时，暂停农场巡查/买肥/神秘购买等其它会占用同一条 WS 的定时任务，
// 让连接只服务于「只帮护主犬」循环 + 心跳/ACE，避免动作冲突与心跳被淹没导致假断连。
// 定时极速务农：开启后仅在用户设定的北京时间时间段内进入独占模式；时间段之外极速务农视为关闭、走正常巡查（前提极速务农总开关已开）。
let lastEffectiveTurbo = null; // null = 尚未同步

/** 当前北京时间（UTC+8）的分钟数，用于时间段比较 */
function beijingMinutes() {
  const d = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

/** 解析 "HH:mm-HH:mm" 时间段；返回 [startMin, endMin]，非法/跨午夜返回 null */
function parseScheduleWindow(raw) {
  const m = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/.exec(String(raw || '').trim());
  if (!m) return null;
  const s = Number(m[1]) * 60 + Number(m[2]);
  const e = Number(m[3]) * 60 + Number(m[4]);
  if (s >= e) return null;
  return [s, e];
}

/**
 * 极速务农当前是否「生效」：
 * - 总开关关 → 不生效
 * - 未启用定时 → 持续生效
 * - 启用定时 → 仅当北京时间落在设定时间段 [start, end) 内生效；段外视为关闭、正常巡查
 */
function computeEffectiveTurbo() {
  if (!isAutomationOn('friend_turbo_mode')) return false;
  if (!isAutomationOn('friend_turbo_scheduled')) return true;
  const raw = getConfigSnapshot(userState.accountId || '').automation.friend_turbo_schedule_time || '';
  const win = parseScheduleWindow(raw);
  if (!win) return false;
  const now = beijingMinutes();
  return now >= win[0] && now < win[1];
}

/** 同步独占模式：进入时暂停其它巡查，退出时按各自开关恢复 */
function syncTurboExclusiveMode(accountId) {
  const effective = computeEffectiveTurbo();

  // 首次调用仅建立基线，避免与 worker-manager 的常规启动逻辑重复启停：
  // - 启动即开启极速务农 → 暂停其它巡查（必须有动作）
  // - 启动未开启 → 仅记录状态，农场等由 worker-manager 正常拉起，此处不重复 start
  if (lastEffectiveTurbo === null) {
    lastEffectiveTurbo = effective;
    if (effective) {
      stopFarmCheckLoop();
      stopFertilizerBuyCheckTimer();
      stopMysteryAutoBuyTimer();
      log('好友', '极速务农独占模式已启用（启动即生效）：已暂停农场巡查 / 化肥自动购买 / 神秘商人自动购买', {
        module: 'friend', event: 'turbo_exclusive_on',
      });
    }
    return;
  }

  if (effective === lastEffectiveTurbo) return;
  lastEffectiveTurbo = effective;

  if (effective) {
    stopFarmCheckLoop();
    stopFertilizerBuyCheckTimer();
    stopMysteryAutoBuyTimer();
    log('好友', '极速务农独占模式已启用：已暂停农场巡查 / 化肥自动购买 / 神秘商人自动购买', {
      module: 'friend', event: 'turbo_exclusive_on',
    });
  } else {
    if (isAutomationOn('farm')) startFarmCheckLoop();
    if (isAutomationOn('fertilizer_buy_organic') || isAutomationOn('fertilizer_buy_normal')) startFertilizerBuyCheckTimer();
    if (isAutomationOn('mystery_auto_buy')) startMysteryAutoBuyTimer();
    log('好友', '极速务农独占模式已退出：已恢复农场巡查 / 化肥自动购买 / 神秘商人自动购买', {
      module: 'friend', event: 'turbo_exclusive_off',
    });
  }
}
const friendScheduler = createScheduler('friend');
let badExecutedOnStartup = false;
let consecutiveBadFailureCount = 0;
// 护主犬缓存全量刷新周期（30 分钟）：周期性重拉好友狗信息，清理伪护主犬、发现新护主犬
const DOG_INFO_FULL_REFRESH_TTL_MS = 30 * 60 * 1000;
let lastFullDogInfoRefreshAt = 0;
let dogInfoBootstrapReadyAt = 0;
// 当前巡查账号 id（checkFriends 开头写入），供经验上限持久化回调使用，
// 避免依赖容器内可能为空的环境变量 FARM_ACCOUNT_ID。
let currentAccountId = '';

const BAD_FAILURE_LIMIT = 3;

// 注册经验上限持久化回调（模块加载时执行一次）
let expLimitCallbackRegistered = false;
function ensureExpLimitCallback() {
  if (expLimitCallbackRegistered) return;
  expLimitCallbackRegistered = true;
  setOnExpLimitReachedCallback(() => {
    if (currentAccountId) {
      applyConfigSnapshot({ friendHelpExpExhausted: true }, { accountId: currentAccountId });
    }
  });
  setOnExpLimitResetCallback(() => {
    // 跨日重置：清掉持久化的"经验已满"标志，否则会卡在仅帮护主犬模式回不来
    if (currentAccountId) {
      applyConfigSnapshot({ friendHelpExpExhausted: false }, { accountId: currentAccountId });
    }
  });
}

// 【2026-08-13 优化】极速务农模式下好友列表短 TTL 缓存（30s）：
// turbo 巡查 6 秒一轮，每轮 getAllFriends 分批拉取（35 人/批）在好友多时很耗时。
// turbo 目标是"进全部护主犬、忽略快照"，护主犬集合来自磁盘缓存，列表缓存对判定几乎无副作用。
const TURBO_FRIENDS_LIST_TTL_MS = 30 * 1000;
let turboFriendsListCache = null;
let turboFriendsListCacheAt = 0;

async function getCachedFriendsList(forceRefresh = false) {
  const turboMode = !!isAutomationOn('friend_turbo_mode');
  if (
    turboMode && !forceRefresh &&
    turboFriendsListCache &&
    (Date.now() - turboFriendsListCacheAt) < TURBO_FRIENDS_LIST_TTL_MS
  ) {
    return turboFriendsListCache;
  }
  const reply = await getAllFriends();
  if (turboMode) {
    turboFriendsListCache = reply;
    turboFriendsListCacheAt = Date.now();
  }
  return reply;
}

// ===== Helpers =====

function clearFriendsListCache() {
  setFriendsListCache(null);
}

async function bootstrapFriendDogInfoCacheIfNeeded() {
  if (Date.now() < dogInfoBootstrapReadyAt) return;

  const accountId = process.env.FARM_ACCOUNT_ID || '';
  if (!accountId) return;
  if (!isAutomationOn('friend') || !isConnected()) return;

  // 【2026-08-11 修复】护主犬缓存刷新判断改用"上次全量刷新时间戳"，不再看缓存内容：
  // 无护主犬好友时 fetchFriendsDogInfo(forceRefresh) 会写入空对象 {}，
  // readFriendDogInfoCache 返回 {} 后 Object.keys({}).length===0 恒为 true → cacheEmpty 永远 true
  // → 每轮巡查都触发全量刷新（issue #30 死循环，"护主犬 0 个"用户修复前永远刷屏）。
  // 改为时间戳判断：只要全量刷新执行过（无论有没有护主犬），30 分钟 TTL 内不再触发；
  // 刷新失败才重置时间戳允许下轮重试。
  const now = Date.now();
  const stale = (now - lastFullDogInfoRefreshAt) > DOG_INFO_FULL_REFRESH_TTL_MS;
  if (lastFullDogInfoRefreshAt > 0 && !stale) return;

  const isInitialRefresh = lastFullDogInfoRefreshAt <= 0;
  lastFullDogInfoRefreshAt = now;
  try {
    log('好友', isInitialRefresh
      ? '护主犬缓存尚未建立（或上次失败），自动获取一次好友狗信息'
      : '护主犬缓存已过期，执行周期性全量刷新', {
      module: 'friend',
      event: '自动获取好友狗信息',
      source: 'friend_loop_bootstrap',
      fullRefresh: !isInitialRefresh,
    });
    await fetchFriendsDogInfo(true); // forceRefresh：全量重拉并重建缓存
  } catch (err) {
    // 失败重置时间戳，下轮巡查可重试（不再一次性放弃）
    lastFullDogInfoRefreshAt = 0;
    logWarn('好友', `自动获取好友狗信息失败: ${err.message}`);
  }
}

function syncAutomationPatchToMaster(patch) {
  postToMaster({
    type: 'automation_patch',
    patch,
  });
}

function resetBadFailureCount() {
  consecutiveBadFailureCount = 0;
}

function getLocalDateKey(offsetDays = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function pauseFriendBadUntilTomorrow(reason) {
  const accountId = process.env.FARM_ACCOUNT_ID || '';
  const retryDate = getLocalDateKey(1);
  applyConfigSnapshot(
    { friendBadRetryDate: retryDate },
    { accountId }
  );
  syncAutomationPatchToMaster({ friendBadRetryDate: retryDate });
  resetBadFailureCount();
  log('好友', `捣乱连续失败 ${BAD_FAILURE_LIMIT} 次，已暂停至 ${retryDate} 再尝试。最后错误: ${reason || '未知'}`, {
    module: 'friend',
    event: '自动暂停捣乱',
    result: 'paused',
    failureCount: BAD_FAILURE_LIMIT,
    retryDate,
    reason,
  });
}

function isFriendBadPaused() {
  const accountId = process.env.FARM_ACCOUNT_ID || '';
  const retryDate = getFriendBadRetryDate(accountId);
  if (!retryDate) return false;
  if (getLocalDateKey() < retryDate) return true;

  applyConfigSnapshot({ friendBadRetryDate: '' }, { accountId });
  syncAutomationPatchToMaster({ friendBadRetryDate: '' });
  resetBadFailureCount();
  return false;
}

function recordBadFailure(reason, context = {}) {
  consecutiveBadFailureCount += 1;
  log('好友', `捣乱失败 ${consecutiveBadFailureCount}/${BAD_FAILURE_LIMIT}: ${reason || '未知错误'}`, {
    module: 'friend',
    event: '捣乱失败计数',
    result: 'error',
    failureCount: consecutiveBadFailureCount,
    failureLimit: BAD_FAILURE_LIMIT,
    reason,
    ...context,
  });

  if (consecutiveBadFailureCount >= BAD_FAILURE_LIMIT) {
    pauseFriendBadUntilTomorrow(reason);
    return true;
  }

  return false;
}

function isIgnorableBadFailureMessage(message) {
  const text = String(message || '');
  if (!text) return true;
  return [
    '??',
    'No target',
    '?????',
    '1001046',
    'used up',
    'no target',
    '没有可捣乱土地',
    '捣乱失败或今日次数已用完',
    '今日次数已用完',
    '次数已用完',
    '已经放过',
    '来晚一步',
  ].some(kw => text.includes(kw));
}

function trackBadVisitResult(result, target, context = {}) {
  const count = Number(
    result && (
      result.count
      || (Number(result.bugCount || 0) + Number(result.weedCount || 0))
    ) || 0
  );
  if (count > 0) {
    resetBadFailureCount();
    return false;
  }

  const message = String(result && result.message || '').trim();
  if (isIgnorableBadFailureMessage(message)) return false;

  return recordBadFailure(message, {
    friendName: target && target.name,
    friendGid: target && target.gid,
    ...context,
  });
}

// ===== Main friend check routine =====

/**
 * Main friend check routine: visits friends to steal, help, and/or put weeds/bugs.
 * Called by the loop or triggered externally.
 */
async function checkFriends(options = {}) {
  const userState = getUserState();
  if (!isAutomationOn('friend') || !isConnected()) return false;

  await bootstrapFriendDogInfoCacheIfNeeded();

  const accountId = userState.accountId || process.env.FARM_ACCOUNT_ID || '';
  currentAccountId = accountId;
  // 极速务农独占模式：依据开关/定时同步其它巡查的暂停与恢复（幂等，仅状态翻转时动作）
  syncTurboExclusiveMode(accountId);

  const helpEnabled = !!isAutomationOn('friend_help');
  const stealEnabled = !!isAutomationOn('friend_steal');
  const badEnabled = !!isAutomationOn('friend_bad');
  const turboMode = computeEffectiveTurbo();

  const onlyHelp = options.onlyHelp || false;
  const onlySteal = options.onlySteal || false;
  const onlyBad = options.onlyBad || false;
  const ignoreExpLimit = options.ignoreExpLimit || false;

  // 极速务农：强制只帮护主犬 + 暂停偷菜/捣乱（无视 friend_help 总开关是否开）
  const doHelp = onlyHelp ? true : (onlySteal || onlyBad ? false : (helpEnabled || turboMode));
  const doSteal = onlySteal ? true : (onlyHelp || onlyBad ? false : (stealEnabled && !turboMode));
  const doBad = onlyBad ? true : (onlyHelp || onlySteal ? false : (badEnabled && !turboMode));

  const shouldRun = doHelp || doSteal || doBad;

  if (isCheckingFriends || !userState.gid || !shouldRun) return false;
  if (inFriendQuietHours()) return false;

  isCheckingFriends = true;
  checkDailyReset();
  ensureExpLimitCallback();

  // 从持久化配置恢复经验上限状态（重启后不丢失）
  const cfgSnapshot = getConfigSnapshot(accountId);
  if (cfgSnapshot.friendHelpExpExhausted && getCanGetHelpExp()) {
    setCanGetHelpExp(false);
    log('好友', '从配置恢复：经验已达上限状态，仅帮助护主犬好友', {
      module: 'friend',
      event: '经验上限恢复',
    });
  }

  try {
    const allFriendsReply = await getCachedFriendsList();
    const rawFriends = extractReplyFriends(allFriendsReply);

    if (rawFriends.length === 0) {
      log('好友', '没有好友', {
        module: 'friend',
        event: '好友扫描',
        result: 'empty',
      });
      return false;
    }

    const blacklist = new Map(getFriendBlacklistDetails(accountId).map((w) => [w.gid, w]));
    const dogInfoCache = readFriendDogInfoCache(accountId);
    const guardDogGidSet = dogInfoCache
      ? new Set(Object.keys(dogInfoCache).map(Number))
      : new Set();
    const expLimitEnabled = !!isAutomationOn('friend_help_exp_limit');

    // 经验满状态现在完全由经验增量判定（detectExpFull）驱动，
    // 不再依赖服务端恒为 0 的 day_ex_times_lt，故删除此处的"额度恢复"分支，
    // 避免 detl=0 被误判为"仍有额度"而把 canGetHelpExp 重置回 true（导致无差别帮助）。
    // 跨日恢复由 checkDailyReset + onExpLimitResetCallback 负责。

    const helpExpReached = expLimitEnabled && !getCanGetHelpExp();

    // ---- Build target lists ----
    const stealTargets = [];
    const helpTargets = [];
    const visitedGids = new Set();

    // Steal targets: friends with stealable crops
    if (doSteal) {
      for (const friend of rawFriends) {
        const gid = toNum(friend.gid);
        if (gid === userState.gid) continue;
        if (visitedGids.has(gid)) continue;
        if (blacklist.has(gid) && blacklist.get(gid).skipSteal) continue;

        const name = friend.remark || friend.name || `GID:${gid}`;
        const plant = friend.plant;
        const stealNum = plant ? toNum(plant.steal_plant_num) : 0;
        const level = toNum(friend.level);

        if (stealNum > 0) {
          stealTargets.push({ gid, name, stealNum, level });
        }
        visitedGids.add(gid);
      }
    }

    // Help targets
    if (doHelp) {
      // 【2026-08-11 修复】极速务农/经验满时无条件走"只帮护主犬"分支：
      // 原条件 `&& guardDogGidSet.size > 0` 在护主犬缓存为空（新号、无护主犬好友、缓存丢失）时
      // 落到 else 分支无差别帮所有好友 → 极速务农退化成普通模式（issue #30 关联）。
      // 现在缓存空时 guardDogGidSet 为空，循环里 `!guardDogGidSet.has(gid) continue` 自然跳过全部，
      // 帮助列表为空 = "暂不帮任何人"，等 bootstrap 全量刷新拉取缓存后恢复，严格符合"只帮护主犬"语义。
      if (turboMode || helpExpReached) {
        // Experience limit reached — only help guard dog friends
        for (const friend of rawFriends) {
          const gid = toNum(friend.gid);
          if (gid === userState.gid) continue;
          if (!guardDogGidSet.has(gid)) continue;
          if (blacklist.has(gid) && blacklist.get(gid).skipHelp) continue;

          const name = friend.remark || friend.name || `GID:${gid}`;
          const plant = friend.plant;
          const dryNum = plant ? toNum(plant.dry_num) : 0;
          const weedNum = plant ? toNum(plant.weed_num) : 0;
          const insectNum = plant ? toNum(plant.insect_num) : 0;

          // 极速务农：忽略滞后快照筛选，进全部护主犬（依赖进农场后的实时数据，根治漏帮）
          if (turboMode || dryNum > 0 || weedNum > 0 || insectNum > 0) {
            helpTargets.push({
              gid,
              name,
              dryNum,
              weedNum,
              insectNum,
              dogId: 0x15FA5, // 90021
              hasGuardDog: true,
            });
          }
        }

        if (helpTargets.length > 0) {
          log('好友', `找到 ${helpTargets.length} 个需要帮助的护主犬好友`, {
            module: 'friend',
            event: '护主犬好友巡查',
            helpCount: helpTargets.length,
          });
        }
    } else {
      for (const friend of rawFriends) {
        const gid = toNum(friend.gid);
        if (gid === userState.gid) continue;
        if (blacklist.has(gid) && blacklist.get(gid).skipHelp) continue;

        const dogId = toNum(friend.dogId);
        const hasGuardDog = guardDogGidSet.has(gid) || dogId === 90021;

        const name = friend.remark || friend.name || `GID:${gid}`;
        const plant = friend.plant;
        const dryNum = plant ? toNum(plant.dry_num) : 0;
        const weedNum = plant ? toNum(plant.weed_num) : 0;
        const insectNum = plant ? toNum(plant.insect_num) : 0;

        if (dryNum > 0 || weedNum > 0 || insectNum > 0) {
          helpTargets.push({
            gid,
            name,
            dryNum,
            weedNum,
            insectNum,
            dogId,
            hasGuardDog,
          });
        }
      }
    }
    }

    // Sort: steal by level desc, help by need desc (guard dogs first)
    stealTargets.sort((a, b) => b.level - a.level);
    helpTargets.sort((a, b) => {
      if (a.hasGuardDog !== b.hasGuardDog) return a.hasGuardDog ? -1 : 1;
      const aTotal = a.dryNum + a.weedNum + a.insectNum;
      const bTotal = b.dryNum + b.weedNum + b.insectNum;
      return bTotal - aTotal;
    });

    // ---- Execute ----
    const tally = { steal: 0, water: 0, weed: 0, bug: 0, putBug: 0, putWeed: 0 };

    // Steal
    if (stealTargets.length > 0 && doSteal) {
      for (const target of stealTargets) {
        if (!canOperate(0x2714)) break; // 10004 = steal
        try {
          await visitFriendForSteal(target, tally, userState.gid, userState.accountId);
        } catch {
          // Skip individual failures
        }
        // 放慢访问节奏，降低单账号短时请求密度，避免触发游戏风控导致断连
        await randomDelay(100, 200);
      }
    }

    // Auto-sell after stealing
    if (tally.steal > 0) {
      try {
        await sellAllFruits();
      } catch {
        // Ignore sell errors
      }
    }

    // Help
    if (helpTargets.length > 0 && doHelp) {
      // 【2026-08-13 修复】极速务农连接健康门控 + 自适应退避（治 Enter 超时 / 假断连）：
      // A) 进每个好友前先 isConnected()；连续进入失败 ≥3 次立即终止本轮，把连接交还重连，
      //    不再往已退化的管道里继续塞 Enter（否则每个干等 9~20s，pending 堆积、心跳失联）。
      // B) 失败则好友间延迟指数退避（上限 2s），成功则回落到安全基线，避免持续高压触发限流。
      // C) 本轮已进入失败的好友加入临时黑名单，本轮内不再重试，避免同一死 gid 反复卡住。
      // 以下新逻辑仅 turboMode 生效，普通模式行为保持原样（100~200ms、失败跳过不中断）。
      let consecutiveEnterFailures = 0;
      let gapMin = turboMode ? 80 : 100;
      let gapMax = turboMode ? 150 : 200;
      const roundFailedGids = new Set();
      for (const target of helpTargets) {
        const tgid = toNum(target.gid);
        if (turboMode && roundFailedGids.has(tgid)) continue;
        // A) 连接已断开（ws 关闭）直接结束本轮，交还应用宝离线重连
        if (turboMode && !isConnected()) {
          logWarn('好友', 'turbo: 连接已断开，提前结束本轮护主犬巡查', {
            module: 'friend', event: 'turbo_early_exit', reason: 'disconnected',
          });
          break;
        }
        // 经验满判定（detectExpFull）可能在巡逻中途触发并翻转 canGetHelpExp=false。
        // 本轮已在开头按 helpExpReached 建好 helpTargets（含普通好友），需对每个普通好友实时复核，
        // 否则开关触发后本轮剩余普通好友仍会被无差别帮助（表现="只帮护主犬"未生效）。
        if (!target.hasGuardDog && expLimitEnabled && !getCanGetHelpExp()) {
          continue;
        }
        try {
          const result = await visitFriendForHelp(
            target, tally, userState.gid, userState.accountId,
            ignoreExpLimit, helpExpReached || turboMode, turboMode
          );
          // 帮助成功才输出日志；失败（无有效操作/异常）不打日志
          if (result && result.acted) {
            log('好友', `成功帮助${target.hasGuardDog ? '护主犬' : '好友'} ${target.name}`, {
              module: 'friend',
              event: '帮助成功',
              gid: tgid,
              hasGuardDog: !!target.hasGuardDog,
            });
          }
          // B) 成功：失败计数清零，延迟回落基线
          if (turboMode) {
            consecutiveEnterFailures = 0;
            gapMin = Math.max(80, Math.floor(gapMin / 2));
            gapMax = Math.max(150, Math.floor(gapMax / 2));
          }
        } catch (err) {
          // A/B) 失败：累加计数 + 本轮临时黑名单 + 指数退避，连续 3 次直接终止本轮
          if (turboMode) {
            consecutiveEnterFailures++;
            roundFailedGids.add(tgid);
            logWarn('好友', `turbo: 进入 ${target.name} 农场失败 (连续 ${consecutiveEnterFailures}/3): ${err && err.message ? err.message : err}`, {
              module: 'friend', event: 'turbo_enter_fail', gid: tgid,
            });
            gapMin = Math.min(2000, gapMin * 2);
            gapMax = Math.min(2000, gapMax * 2);
            if (consecutiveEnterFailures >= 3) {
              logWarn('好友', 'turbo: 连续 3 次进入好友失败，提前结束本轮（交还应用宝离线重连）', {
                module: 'friend', event: 'turbo_early_exit', reason: 'consecutive_failures',
              });
              break;
            }
          }
        }
        // 放慢访问节奏，降低单账号短时请求密度，避免触发游戏风控导致断连
        // 【2026-08-13 修复】极速务农（turboMode）好友间延迟从 20~50ms 回稳到 80~150ms（含自适应退避）
        await randomDelay(turboMode ? gapMin : 100, turboMode ? gapMax : 200);
      }
    }

    // Bad (put weeds/insects)
    if (doBad && !isFriendBadPaused()) {
      log('好友', '开始自动放虫放草', {
        module: 'friend',
        event: '开始自动放虫放草',
      });

      const badCandidates = [];
      const badVisited = new Set();

      for (const friend of rawFriends) {
        const gid = toNum(friend.gid);
        if (gid === userState.gid) continue;
        if (badVisited.has(gid)) continue;
        if (blacklist.has(gid)) continue;

        const name = friend.remark || friend.name || `GID:${gid}`;
        const plant = friend.plant;
        const stealNum = plant ? toNum(plant.steal_plant_num) : 0;
        const dryNum = plant ? toNum(plant.dry_num) : 0;
        const weedNum = plant ? toNum(plant.weed_num) : 0;
        const insectNum = plant ? toNum(plant.insect_num) : 0;

        // Target friends with empty farms (no crops, no issues)
        if (stealNum === 0 && dryNum === 0 && weedNum === 0 && insectNum === 0) {
          const level = toNum(friend.level);
          badCandidates.push({ gid, name, level });
        }
        badVisited.add(gid);
      }

      badCandidates.sort((a, b) => b.level - a.level);

      const topCount = Math.min(20, badCandidates.length);
      const topTargets = badCandidates.slice(0, topCount);

      if (topTargets.length > 0) {
        log('好友',
          `找到 ${badCandidates.length} 个可捣乱的好友，处理等级最高的前${topTargets.length}个`,
          {
            module: 'friend',
            event: '放虫放草好友列表',
            totalCount: badCandidates.length,
            topCount: topTargets.length,
          }
        );

        for (let i = 0; i < topTargets.length; i++) {
          const target = topTargets[i];
          if (!canOperateBad()) {
            log('好友', '放虫放草次数已用完，停止执行', {
              module: 'friend',
              event: '放虫放草次数用完',
            });
            break;
          }

          try {
            const result = await visitFriend(target, tally, userState.gid, userState.accountId);
            if (trackBadVisitResult(result, target, { source: 'friend_check' })) {
              break;
            }
          } catch (err) {
            if (recordBadFailure(err && err.message, {
              friendName: target.name,
              friendGid: target.gid,
              source: 'friend_check',
            })) {
              break;
            }
          }
          // 放慢访问节奏，降低单账号短时请求密度，避免触发游戏风控导致断连
          await randomDelay(100, 200);
        }
      }
    }

    // ---- Summary ----
    const summary = [];
    if (tally.steal > 0) summary.push(`偷${tally.steal}`);
    if (tally.weed > 0) summary.push(`除草${tally.weed}`);
    if (tally.bug > 0) summary.push(`除虫${tally.bug}`);
    if (tally.water > 0) summary.push(`浇水${tally.water}`);
    if (tally.putBug > 0) summary.push(`放虫${tally.putBug}`);
    if (tally.putWeed > 0) summary.push(`放草${tally.putWeed}`);

    const visited = stealTargets.length + helpTargets.length;
    if (summary.length > 0) {
      log('好友', `巡查完成 → ${summary.join('/')}`, {
        module: 'friend',
        event: '好友巡查循环',
        result: 'ok',
        visited,
        summary,
      });
    }

    return summary.length > 0;
  } catch (err) {
    if (!isTransientNetworkError(err)) {
      logWarn('好友', `巡查异常: ${err.message}`);
    }
    return false;
  } finally {
    isCheckingFriends = false;
  }
}

// ===== Friend check loop =====

async function friendCheckLoop() {
  if (externalSchedulerMode) return;
  if (!friendLoopRunning) return;

  await bootstrapFriendDogInfoCacheIfNeeded();

  await checkFriends();

  if (!friendLoopRunning) return;

  // 经验满(仅帮护主犬)模式下缩短巡查间隔，让护主犬好友更快被复查
  // 【2026-08-07 提速】对齐/反超同类工具：经验满 8s、普通 15s（原 15s/30s），提升抢帮响应速度
  const expLimitActive = !!isAutomationOn('friend_help_exp_limit') && !getCanGetHelpExp();
  const turboMode = computeEffectiveTurbo();
  const interval = (expLimitActive || turboMode)
    ? Math.max(10000, CONFIG.friendCheckInterval)
    : Math.max(15000, CONFIG.friendCheckInterval);
  friendScheduler.setTimeoutTask('friend_check_loop', interval, () => friendCheckLoop());
}

function startFriendCheckLoop(opts = {}) {
  if (friendLoopRunning) return;

  externalSchedulerMode = !!opts.externalScheduler;
  friendLoopRunning = true;
  lastFullDogInfoRefreshAt = 0;
  dogInfoBootstrapReadyAt = Date.now() + (2 * 60 * 1000);

  // Sync operation limits callback
  setOperationLimitsCallback(updateOperationLimits);

  // Listen for friend application events
  networkEvents.on('friendApplicationReceived', onFriendApplicationReceived);

  if (!externalSchedulerMode) {
    // Start after a 10-second delay（登录稳定即可巡查；原 2 分钟，抢帮响应太慢）
    const initialDelay = 10 * 1000;
    log('好友', '好友巡查循环将在 10 秒后启动', {
      module: 'friend',
      event: '好友巡查延迟启动',
      delayMs: initialDelay,
    });
    friendScheduler.setTimeoutTask('friend_check_loop', initialDelay, () => friendCheckLoop());
  }

  // Bootstrap: periodically check for pending applications
  friendScheduler.setTimeoutTask(
    'friend_check_bootstrap_applications',
    30 * 1000,
    () => checkAndAcceptApplications()
  );
}

function stopFriendCheckLoop() {
  friendLoopRunning = false;
  externalSchedulerMode = false;
  lastFullDogInfoRefreshAt = 0;
  dogInfoBootstrapReadyAt = 0;
  // 【2026-08-13】清理极速务农好友列表短 TTL 缓存，避免停止后残留旧名单
  turboFriendsListCache = null;
  turboFriendsListCacheAt = 0;
  clearAllInvalidKnownFriendGidCooldown();
  networkEvents.off('friendApplicationReceived', onFriendApplicationReceived);
  friendScheduler.clearAll();
}

function refreshFriendCheckLoop(delayMs = 0) {
  if (!friendLoopRunning || externalSchedulerMode) return;
  friendScheduler.setTimeoutTask(
    'friend_check_loop',
    Math.max(0, delayMs),
    () => friendCheckLoop()
  );
}

// ===== Friend application handling =====

function onFriendApplicationReceived(applications) {
  const names = applications
    .map(app => app.name || `GID:${toNum(app.gid)}`)
    .join(', ');
  log('申请', `收到 ${applications.length} 个好友申请: ${names}`);

  for (const app of applications) {
    log('申请',
      `申请详情: name=${app.name}, gid=${toNum(app.gid)}, level=${app.level}, levelType=${typeof app.level}`
    );
  }

  const minLevel = getAutoAcceptFriendMinLevel();
  let toAccept = applications;

  if (minLevel > 0) {
    toAccept = applications.filter(app => {
      const level = toNum(app.level) || 0;
      const name = app.name || `GID:${toNum(app.gid)}`;
      log('申请', `${name} 等级: ${level}, 最低要求: ${minLevel}级`);
      if (level >= minLevel) return true;
      log('申请', `${name} 等级 ${level} < ${minLevel}，跳过`);
      return false;
    });
  }

  if (toAccept.length === 0) return;

  const gids = toAccept.map(app => toNum(app.gid));
  acceptFriendsWithRetry(gids);
}

async function checkAndAcceptApplications() {
  try {
    const reply = await getApplications();
    const apps = reply.applications || [];
    if (apps.length === 0) return;

    const names = apps
      .map(app => app.name || `GID:${toNum(app.gid)}`)
      .join(', ');
    log('申请', `发现 ${apps.length} 个待处理申请: ${names}`);

    const minLevel = getAutoAcceptFriendMinLevel();
    let toAccept = apps;

    if (minLevel > 0) {
      toAccept = apps.filter(app => {
        const level = toNum(app.level) || 0;
        const name = app.name || `GID:${toNum(app.gid)}`;
        log('申请', `${name} 等级: ${level}, 最低要求: ${minLevel}级`);
        if (level >= minLevel) return true;
        log('申请', `${name} 等级 ${level} < ${minLevel}，跳过`);
        return false;
      });
    }

    if (toAccept.length === 0) return;

    const gids = toAccept.map(app => toNum(app.gid));
    await acceptFriendsWithRetry(gids);
  } catch {
    // Ignore application check errors
  }
}

async function acceptFriendsWithRetry(gids) {
  if (gids.length === 0) return;

  try {
    const reply = await acceptFriends(gids);
    const friends = reply.friends || [];

    if (friends.length > 0) {
      const names = friends
        .map(f => f.name || f.remark || `GID:${toNum(f.gid)}`)
        .join(', ');
      log('申请', `已同意 ${friends.length} 人: ${names}`);

      // Sync accepted GIDs to known friends list
      const newGids = friends
        .map(f => toNum(f.gid))
        .filter(g => g > 0);

      if (newGids.length > 0) {
        const currentGids = normalizeFriendGids(getKnownFriendGids());
        const mergedGids = normalizeFriendGids([...currentGids, ...newGids]);

        if (mergedGids.length !== currentGids.length) {
          const accountId = process.env.FARM_ACCOUNT_ID || '';
          applyConfigSnapshot(
            { knownFriendGids: mergedGids },
            { persist: false, accountId }
          );

          const synced = postToMaster({
            type: 'known_friend_gids_sync',
            gids: mergedGids,
          });

          if (!synced) {
            applyConfigSnapshot(
              { knownFriendGids: mergedGids },
              { persist: true, accountId }
            );
          }

          log('申请', `已将 ${newGids.length} 人加入好友列表`, {
            module: 'friend',
            event: '好友加入列表',
            result: 'ok',
          });
        }

        // Refresh friends list cache
        clearFriendsListCache();
        try {
          await getFriendsList(true);
          log('申请', '已刷新好友列表', {
            module: 'friend',
            event: '刷新好友列表',
            result: 'ok',
          });
        } catch (err) {
          logWarn('申请', `刷新好友列表失败: ${err.message}`);
        }
      }
    }
  } catch (err) {
    logWarn('申请', `同意失败: ${err.message}`);
  }
}

// ===== Bad on startup =====

/**
 * Run a one-time "bad" operation on startup to put weeds/insects on friends' farms.
 */
async function runBadOnceOnStartup(force = false) {
  if (!force && badExecutedOnStartup) return;

  const badEnabled = isAutomationOn('friend_bad');
  if (!badEnabled) return;
  if (isFriendBadPaused()) return;

  const userState = getUserState();
  if (!userState.gid) {
    log('好友', '用户未登录，无法执行放虫放草', {
      module: 'friend',
      event: '放虫放草未登录',
    });
    return;
  }

  const accountId = process.env.FARM_ACCOUNT_ID || '';
  const label = force ? '开启自动捣乱后立即执行' : '启动时放虫放草';

  log('好友', `========== ${label}开始 ==========`, {
    module: 'friend',
    event: `${label}开始`,
  });

  try {
    const allFriendsReply = await getCachedFriendsList();
    const rawFriends = extractReplyFriends(allFriendsReply);

    if (rawFriends.length === 0) {
      log('好友', '没有好友，放虫放草结束', {
        module: 'friend',
        event: '没有游戏好友',
      });
      return;
    }

    const blacklist = new Set(getFriendBlacklist(accountId));
    const badCandidates = [];
    const badVisited = new Set();

    for (const friend of rawFriends) {
      const gid = toNum(friend.gid);
      if (gid === userState.gid) continue;
      if (badVisited.has(gid)) continue;
      if (blacklist.has(gid)) continue;

      const name = friend.remark || friend.name || `GID:${gid}`;
      const plant = friend.plant;
      const stealNum = plant ? toNum(plant.steal_plant_num) : 0;
      const dryNum = plant ? toNum(plant.dry_num) : 0;
      const weedNum = plant ? toNum(plant.weed_num) : 0;
      const insectNum = plant ? toNum(plant.insect_num) : 0;

      if (stealNum === 0 && dryNum === 0 && weedNum === 0 && insectNum === 0) {
        const level = toNum(friend.level);
        badCandidates.push({ gid, name, level });
      }
      badVisited.add(gid);
    }

    badCandidates.sort((a, b) => b.level - a.level);

    const topCount = Math.min(20, badCandidates.length);
    const topTargets = badCandidates.slice(0, topCount);

    log('好友',
      `找到 ${badCandidates.length} 个可捣乱的好友，处理等级最高的前${topTargets.length}个`,
      {
        module: 'friend',
        event: '放虫放草好友列表',
        totalCount: badCandidates.length,
        topCount: topTargets.length,
      }
    );

    const tally = { steal: 0, water: 0, weed: 0, bug: 0, putBug: 0, putWeed: 0 };
    let processedCount = 0;

    for (let i = 0; i < topTargets.length; i++) {
      const target = topTargets[i];
      if (!canOperateBad()) {
        log('好友', `放虫放草次数已用完，停止执行。已处理 ${processedCount} 个好友`, {
          module: 'friend',
          event: '放虫放草次数用完',
          processedCount,
        });
        break;
      }

      log('好友',
        `${label} ${i + 1}/${topTargets.length}: ${target.name} (等级${target.level})`,
        {
          module: 'friend',
          event: '放虫放草处理好友',
          index: i + 1,
          total: topTargets.length,
          friendName: target.name,
          level: target.level,
        }
      );

      try {
        const result = await visitFriend(target, tally, userState.gid, accountId);
        processedCount++;
        if (trackBadVisitResult(result, target, { source: 'startup_bad' })) {
          break;
        }
      } catch (err) {
        log('好友', `放虫放草失败: ${target.name}, 错误: ${err.message}`, {
          module: 'friend',
          event: '放虫放草失败',
          friendName: target.name,
          error: err.message,
        });
        if (recordBadFailure(err && err.message, {
          friendName: target.name,
          friendGid: target.gid,
          source: 'startup_bad',
        })) {
          break;
        }
      }
      await randomDelay(50, 100);
    }

    badExecutedOnStartup = true;

    const summary = [];
    if (tally.putBug > 0) summary.push(`放虫${tally.putBug}`);
    if (tally.putWeed > 0) summary.push(`放草${tally.putWeed}`);

    log('好友',
      `========== ${label}结束 ========== 处理${processedCount}人${ 
        summary.length > 0 ? ` → ${summary.join('/')}` : ''}`,
      {
        module: 'friend',
        event: `${label}结束`,
        processedCount,
        summary,
      }
    );
  } catch (err) {
    if (!isTransientNetworkError(err)) {
      logWarn('好友', `${label}异常: ${err.message}`);
    }
  }
}

// ===== Status queries =====

function isHelpExpLimitReached() {
  return getHelpAutoDisabledByLimit();
}

function isCheckingFriendsRunning() {
  return isCheckingFriends;
}

// ===== Sync friends from external GID list =====

async function syncFriendsFromGids(gids) {
  const newGids = normalizeFriendGids(gids);
  if (newGids.length === 0) return [];

  const currentGids = normalizeFriendGids(getKnownFriendGids());
  const mergedGids = normalizeFriendGids([...currentGids, ...newGids]);

  if (mergedGids.length !== currentGids.length) {
    const accountId = process.env.FARM_ACCOUNT_ID || '';
    applyConfigSnapshot(
      { knownFriendGids: mergedGids },
      { persist: false, accountId }
    );

    const synced = postToMaster({
      type: 'known_friend_gids_sync',
      gids: mergedGids,
    });

    if (!synced) {
      applyConfigSnapshot(
        { knownFriendGids: mergedGids },
        { persist: true, accountId }
      );
    }

    log('好友',
      `批量添加 ${newGids.length} 个好友GID，当前共 ${mergedGids.length} 个`,
      {
        module: 'friend',
        event: '批量添加好友GID',
        result: 'ok',
        addedCount: newGids.length,
        totalKnownGids: mergedGids.length,
      }
    );
  }

  clearFriendsListCache();
  return await getFriendsList(true);
}

// ===== Exports =====
module.exports = {
  checkFriends,
  startFriendCheckLoop,
  stopFriendCheckLoop,
  refreshFriendCheckLoop,
  runBadOnceOnStartup,
  isHelpExpLimitReached,
  isCheckingFriendsRunning,
  clearFriendsListCache,
  syncFriendsFromGids,
};
