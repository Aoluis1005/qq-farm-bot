const { PlantPhase } = require('../config/config');
const {
  getPlantBlacklist,
  isAutomationOn,
  readFriendDogInfoCache,
  writeFriendDogInfoCache,
} = require('../models/store');
const { getUserState } = require('../utils/network');
const { toNum, log, logWarn, randomDelay, sleep } = require('../utils/utils');
const { recordOperation } = require('./stats');
const { sellAllFruits } = require('./warehouse');
const {
  enterFriendFarm,
  leaveFriendFarm,
  handleFriendEnterError,
  getDogName,
} = require('./friend-api');
const { analyzeFriendLands } = require('./friend-land-analyzer');
const { getCurrentPhase } = require('./farm-land-analyzer');
const {
  getRemainingTimes,
  getBadRemainingTimes,
  PUT_BUG_OPERATION_ID,
  PUT_WEED_OPERATION_ID,
  BAD_DAILY_LIMIT,
  canGetExpByCandidates,
  getCanGetHelpExp,
  setCanGetHelpExp,
  helpWater,
  helpWeed,
  helpInsecticide,
  stealHarvest,
  putInsectsDetailed,
  putWeedsDetailed,
} = require('./friend-operation-limits');

// ===== Batch helper =====

/**
 * Run an operation on multiple land IDs. Falls back to single-ID calls if batch fails.
 * Returns the number of successful operations.
 */
async function runBatchWithFallback(landIds, batchFn, singleFn) {
  const ids = Array.isArray(landIds) ? landIds.filter(Boolean) : [];
  if (ids.length === 0) return 0;

  // 逐块调用但不批量——服务端对批量 land_ids 的处理不可靠（可能部分成功），
  // 逐块调用能精确知道每块是否成功，统计准确。
  // 性能影响小（帮忙/偷菜的地块数通常 < 10）。
  let ok = 0;
  for (const id of ids) {
    try {
      await singleFn([id]);
      ok++;
    } catch (singleErr) {
      const msg = singleErr && singleErr.message ? singleErr.message : String(singleErr);
      // 次数用完类错误、以及「作物当前无需该操作」类错误均静默跳过
      // （服务端在并发帮助/状态滞后时会返回这些，属正常业务结果，无需告警刷屏）
      const silenced = ['1001046', 'used up', '1001014', '1001015', '1001018',
        '尚未干旱', '不需要除草', '不需要除虫'];
      if (!silenced.some(s => msg.includes(s))) {
        logWarn('好友', `操作失败: ${msg}`, {
          module: 'friend',
          event: 'operation_single_fail',
          error: msg,
        });
      }
    }
    await sleep(50);
  }
  return ok;
}

// ===== 狗信息随巡查收集 =====
// 正常偷菜/帮忙/捣乱都要 enterFriendFarm，reply 里已带 __briefDogInfo。
// 顺手把护主犬(id=90021)信息写回本地缓存，避免单独跑 fetchFriendsDogInfo 全量拉取。
function cacheDogInfoFromEnterReply(gid, enterReply) {
  try {
    const dogInfo = enterReply && enterReply.__briefDogInfo;
    if (!dogInfo || toNum(dogInfo.dogId) === 0) return;
    const dogId = toNum(dogInfo.dogId);
    const dogName = getDogName(dogId) || '无狗';

    const accountId = process.env.FARM_ACCOUNT_ID || '';
    if (!accountId) return;

    // 只缓存护主犬（与 friend-land-analyzer.fetchFriendsDogInfo 的持久化策略一致）
    if (dogId !== 90021) return;

    const existing = readFriendDogInfoCache(accountId) || {};
    if (existing[gid] && existing[gid].dogId === dogId) return;  // 已缓存，跳过写盘

    existing[gid] = { dogId, dogName };
    writeFriendDogInfoCache(accountId, existing);
  } catch {
    // 缓存失败不影响主流程
  }
}

// ===== Single friend operation =====

/**
 * Perform a single operation on a friend's farm (steal/water/weed/bug/bad).
 * Handles entering/leaving the farm and error classification.
 */
async function doFriendOperation(gid, opType) {
  const numericGid = toNum(gid);
  if (!numericGid) {
    return { ok: false, message: '无效好友ID', opType };
  }

  // Enter friend's farm
  let enterReply;
  try {
    enterReply = await enterFriendFarm(numericGid);
  } catch (err) {
    const handled = handleFriendEnterError(numericGid, `GID:${numericGid}`, err);
    if (handled.handled && handled.kind === 'blacklist') {
      return { ok: true, opType, count: 0, message: '好友已自动加入黑名单' };
    }
    if (handled.handled && handled.kind === 'invalid_removed') {
      return { ok: true, opType, count: 0, message: '好友 GID 已失效，已自动移出已知列表' };
    }
    return { ok: false, message: `进入好友农场失败: ${err.message}`, opType };
  }

  try {
    const lands = enterReply.lands || [];
    cacheDogInfoFromEnterReply(numericGid, enterReply);
    const userState = getUserState();
    const plantBlacklist = getPlantBlacklist(userState.accountId);
    const analysis = analyzeFriendLands(lands, userState.gid, '', { plantBlacklist });

    let okCount = 0;

    // ---- Steal ----
    if (opType === 'steal') {
      if (!analysis.stealable.length) {
        return { ok: true, opType, count: 0, message: '没有可偷取土地' };
      }

      // 直接发起偷取请求，服务端会自行截断可偷数量（is_all=true）。
      // 去掉 checkCanOperateRemote 预检查：被偷光时服务端返回错误码，catch 即可。
      try {
        okCount = await runBatchWithFallback(
          analysis.stealable,
          ids => stealHarvest(numericGid, ids),
          id => stealHarvest(numericGid, id)
        );
      } catch (_) {
        return { ok: true, opType, count: 0, message: 'Ta已经被偷的精光了QAQ' };
      }

      if (okCount > 0) {
        recordOperation('steal', okCount);
        try {
          await sellAllFruits();
        } catch (sellErr) {
          logWarn('仓库', `手动偷取后自动出售失败: ${sellErr.message}`, {
            module: 'warehouse',
            event: '偷菜后出售',
            result: 'error',
            mode: 'manual',
          });
        }
      }

      return { ok: true, opType, count: okCount, message: `偷取完成 ${okCount} 块` };
    }

    // ---- Water ----
    if (opType === 'water') {
      if (!analysis.needWater.length) {
        return { ok: true, opType, count: 0, message: '没有可浇水土地' };
      }

      try {
        okCount = await runBatchWithFallback(
          analysis.needWater,
          ids => helpWater(numericGid, ids),
          id => helpWater(numericGid, id)
        );
      } catch (_) {
        return { ok: true, opType, count: 0, message: '浇水失败，来晚一步，可惜' };
      }

      if (okCount > 0) recordOperation('helpWater', okCount);
      return { ok: true, opType, count: okCount, message: `浇水完成 ${okCount} 块` };
    }

    // ---- Weed ----
    if (opType === 'weed') {
      if (!analysis.needWeed.length) {
        return { ok: true, opType, count: 0, message: '没有可除草土地' };
      }

      try {
        okCount = await runBatchWithFallback(
          analysis.needWeed,
          ids => helpWeed(numericGid, ids),
          id => helpWeed(numericGid, id)
        );
      } catch (_) {
        return { ok: true, opType, count: 0, message: '除草失败，来晚一步，可惜' };
      }

      if (okCount > 0) recordOperation('helpWeed', okCount);
      return { ok: true, opType, count: okCount, message: `除草完成 ${okCount} 块` };
    }

    // ---- Bug ----
    if (opType === 'bug') {
      if (!analysis.needBug.length) {
        return { ok: true, opType, count: 0, message: '没有可除虫土地' };
      }

      try {
        okCount = await runBatchWithFallback(
          analysis.needBug,
          ids => helpInsecticide(numericGid, ids),
          id => helpInsecticide(numericGid, id)
        );
      } catch (_) {
        return { ok: true, opType, count: 0, message: '除虫失败，来晚一步，可惜' };
      }

      if (okCount > 0) recordOperation('helpBug', okCount);
      return { ok: true, opType, count: okCount, message: `除虫完成 ${okCount} 块` };
    }

    // ---- Bad (put weeds & insects) ----
    if (opType === 'bad') {
      let bugCount = 0;
      let weedCount = 0;

      if (!analysis.canPutBug.length && !analysis.canPutWeed.length) {
        return {
          ok: true,
          opType,
          count: 0,
          bugCount: 0,
          weedCount: 0,
          message: '没有可捣乱土地',
        };
      }

      let failedMsgs = [];

      // Put insects（去掉 checkCanOperateRemote 预检查，直接尝试）
      if (analysis.canPutBug.length && getBadRemainingTimes() > 0) {
        const remainingBug = Math.min(
          getRemainingTimes(PUT_BUG_OPERATION_ID, BAD_DAILY_LIMIT),
          getBadRemainingTimes()
        );
        const targets = analysis.canPutBug.slice(0, remainingBug);
        const result = targets.length > 0
          ? await putInsectsDetailed(numericGid, targets)
          : { ok: 0, failed: [] };
        bugCount = result.ok;
        failedMsgs = failedMsgs.concat(
          (result.failed || []).map(f => `放虫#${f.landId}:${f.reason}`)
        );
        if (bugCount > 0) recordOperation('bug', bugCount);
      }

      // Put weeds（去掉 checkCanOperateRemote 预检查，直接尝试）
      if (analysis.canPutWeed.length && getBadRemainingTimes() > 0) {
        const remainingWeed = Math.min(
          getRemainingTimes(PUT_WEED_OPERATION_ID, BAD_DAILY_LIMIT),
          getBadRemainingTimes()
        );
        const targets = analysis.canPutWeed.slice(0, remainingWeed);
        const result = targets.length > 0
          ? await putWeedsDetailed(numericGid, targets)
          : { ok: 0, failed: [] };
        weedCount = result.ok;
        failedMsgs = failedMsgs.concat(
          (result.failed || []).map(f => `放草#${f.landId}:${f.reason}`)
        );
        if (weedCount > 0) recordOperation('weed', weedCount);
      }

      okCount = bugCount + weedCount;

      if (okCount <= 0) {
        const errSummary = failedMsgs.slice(-3).join(' | ');
        return {
          ok: true,
          opType,
          count: 0,
          bugCount,
          weedCount,
          message: errSummary ? `捣乱失败: ${errSummary}` : '捣乱失败或今日次数已用完',
        };
      }

      return {
        ok: true,
        opType,
        count: okCount,
        bugCount,
        weedCount,
        message: `捣乱完成 虫${bugCount}/草${weedCount}`,
      };
    }

    return { ok: false, opType, count: 0, message: '未知操作类型' };
  } catch (err) {
    return { ok: false, opType, count: 0, message: err.message || '操作失败' };
  } finally {
    try {
      await leaveFriendFarm(numericGid);
    } catch (_) {
      // Ignore leave errors
    }
  }
}

// ===== Full friend visit =====

/**
 * Visit a friend and perform all enabled operations (help + steal + bad).
 * Tracks per-operation counts in the `tally` object.
 * Returns: { acted, entered }
 */
async function visitFriend(friend, tally, myGid, accountId) {
  const { gid, name } = friend;
  let enterReply;

  // Enter friend's farm
  try {
    enterReply = await enterFriendFarm(gid);
  } catch (err) {
    const handled = handleFriendEnterError(gid, name, err);
    if (handled.handled) {
      return { acted: false, entered: false };
    }
    logWarn('好友', `进入 ${name} 农场失败: ${err.message}`, {
      module: 'friend',
      event: '进入农场',
      result: 'error',
      friendName: name,
      friendGid: gid,
    });
    return { acted: false, entered: false };
  }

  const lands = enterReply.lands || [];
  if (lands.length === 0) {
    await leaveFriendFarm(gid);
    return { acted: false, entered: true };
  }

  cacheDogInfoFromEnterReply(gid, enterReply);

  const plantBlacklist = getPlantBlacklist(accountId);
  const analysis = analyzeFriendLands(lands, myGid, name, { plantBlacklist });
  const actionLogs = [];

  // ---- Help (weed / bug / water) ----
  const helpEnabled = !!isAutomationOn('friend_help');
  const expLimitEnabled = !!isAutomationOn('friend_help_exp_limit');

  if (!expLimitEnabled) setCanGetHelpExp(true);

  if (helpEnabled) {
    // Skip help if exp limit is reached and we haven't been overridden
    if (!expLimitEnabled || getCanGetHelpExp()) {
      const helpOptions = [
        {
          id: 0x2715,             // 10005 = weed
          expIds: [0x2715, 0x2713], // [10005, 10003]
          list: analysis.needWeed,
          fn: helpWeed,
          key: 'weed',
          name: '草',
          record: 'helpWeed',
        },
        {
          id: 0x2716,             // 10006 = bug
          expIds: [0x2716, 0x2712], // [10006, 10002]
          list: analysis.needBug,
          fn: helpInsecticide,
          key: 'bug',
          name: '虫',
          record: 'helpBug',
        },
        {
          id: 0x2717,             // 10007 = water
          expIds: [0x2717, 0x2711], // [10007, 10001]
          list: analysis.needWater,
          fn: helpWater,
          key: 'water',
          name: '水',
          record: 'helpWater',
        },
      ];

      for (const opt of helpOptions) {
        const canGetExp = !expLimitEnabled ||
          (canGetExpByCandidates(opt.expIds) && getCanGetHelpExp());

        if (opt.list.length > 0 && canGetExp) {
          // 去掉 checkCanOperateRemote 预检查，直接发起帮忙操作
          try {
            const okCount = await runBatchWithFallback(
              opt.list,
              ids => opt.fn(gid, ids, expLimitEnabled),
              id => opt.fn(gid, id, expLimitEnabled)
            );
            if (okCount > 0) {
              actionLogs.push(`${opt.name}${okCount}`);
              tally[opt.key] += okCount;
              recordOperation(opt.record, okCount);
              await randomDelay(50, 100);
            }
          } catch (_) {
            // 帮忙操作整体失败，跳过该类操作
          }
        }
      }
    }
  }

  // ---- Steal ----
  if (isAutomationOn('friend_steal') && analysis.stealable.length > 0) {
    // 先批量偷，失败再逐块 fallback
    let stolen = 0;
    const stolenNames = [];
    let batchSuccess = false;

    try {
      await stealHarvest(gid, analysis.stealable);
      batchSuccess = true;
      stolen = analysis.stealable.length;
      analysis.stealable.forEach(landId => {
        const info = analysis.stealableInfo.find(s => s.landId === landId);
        if (info) stolenNames.push(info.name);
      });
    } catch (_) {
      for (const landId of analysis.stealable) {
        try {
          await stealHarvest(gid, [landId]);
          stolen++;
          const info = analysis.stealableInfo.find(s => s.landId === landId);
          if (info) stolenNames.push(info.name);
        } catch (_) {
          // Skip individual failures
        }
        await randomDelay(50, 100);
      }
    }

    if (stolen > 0) {
      const namesStr = [...new Set(stolenNames)].join('/');
      actionLogs.push(`偷${stolen}${namesStr ? `(${namesStr})` : ''}`);
      tally.steal += stolen;
      recordOperation('steal', stolen);
      if (!batchSuccess) await randomDelay(50, 100);
    }
  }

  // ---- Bad (put weeds & insects) ----
  const badEnabled = isAutomationOn('friend_bad');
  let badCount = 0;
  let putBugCount = 0;
  let putWeedCount = 0;
  const badFailedMsgs = [];

  if (badEnabled) {
    // Put insects（去掉 checkCanOperateRemote 预检查）
    if (analysis.canPutBug.length > 0 && getBadRemainingTimes() > 0) {
      const remainingBug = Math.min(
        getRemainingTimes(PUT_BUG_OPERATION_ID, BAD_DAILY_LIMIT),
        getBadRemainingTimes()
      );
      const targets = analysis.canPutBug.slice(0, remainingBug);
      const result = await putInsectsDetailed(gid, targets);
      const okCount = result.ok;
      badFailedMsgs.push(...(result.failed || []).map(f => `放虫#${f.landId}:${f.reason}`));
      if (okCount > 0) {
        actionLogs.push(`放虫${okCount}`);
        tally.putBug += okCount;
        putBugCount += okCount;
        badCount += okCount;
      }
      await randomDelay(50, 100);
    }

    // Put weeds（去掉 checkCanOperateRemote 预检查）
    if (analysis.canPutWeed.length > 0 && getBadRemainingTimes() > 0) {
      const remainingWeed = Math.min(
        getRemainingTimes(PUT_WEED_OPERATION_ID, BAD_DAILY_LIMIT),
        getBadRemainingTimes()
      );
      const targets = analysis.canPutWeed.slice(0, remainingWeed);
      const result = await putWeedsDetailed(gid, targets);
      const okCount = result.ok;
      badFailedMsgs.push(...(result.failed || []).map(f => `放草#${f.landId}:${f.reason}`));
      if (okCount > 0) {
        actionLogs.push(`放草${okCount}`);
        tally.putWeed += okCount;
        putWeedCount += okCount;
        badCount += okCount;
      }
      await randomDelay(50, 100);
    }
  }

  if (actionLogs.length > 0) {
    log('好友', `${name}: ${actionLogs.join('/')}`, {
      module: 'friend',
      event: '照顾好友',
      result: 'ok',
      friendName: name,
      friendGid: gid,
      actions: actionLogs,
    });
  }

  await leaveFriendFarm(gid);
  return {
    acted: actionLogs.length > 0,
    entered: true,
    count: badCount,
    bugCount: putBugCount,
    weedCount: putWeedCount,
    message: badCount > 0
      ? `捣乱完成 虫${putBugCount}/草${putWeedCount}`
      : badFailedMsgs.slice(-3).join(' | '),
  };
}

// ===== Visit friend for steal only =====

/**
 * Visit a friend specifically to steal crops.
 */
async function visitFriendForSteal(friend, tally, myGid, accountId) {
  const { gid, name } = friend;
  let enterReply;

  try {
    enterReply = await enterFriendFarm(gid);
  } catch (err) {
    const handled = handleFriendEnterError(gid, name, err);
    if (handled.handled) {
      return { acted: false, entered: false };
    }
    logWarn('好友', `进入 ${name} 农场失败: ${err.message}`, {
      module: 'friend',
      event: '进入农场',
      result: 'error',
      friendName: name,
      friendGid: gid,
    });
    return { acted: false, entered: false };
  }

  const lands = enterReply.lands || [];
  if (lands.length === 0) {
    await leaveFriendFarm(gid);
    return { acted: false, entered: true };
  }

  cacheDogInfoFromEnterReply(gid, enterReply);

  const plantBlacklist = getPlantBlacklist(accountId);
  const analysis = analyzeFriendLands(lands, myGid, name, { plantBlacklist });
  const actionLogs = [];

  // Check if any stealable land still has remaining steal slots for us
  const hasStealSlot = lands.some(land => {
    const plant = land.plant;
    if (!plant || !plant.phases || plant.phases.length === 0) return false;
    const phase = getCurrentPhase(plant.phases, false);
    if (!phase || phase.phase !== PlantPhase.MATURE) return false;
    if (!plant.stealable) return false;

    const stealPlayers = plant.steal_player;
    if (!stealPlayers || stealPlayers.length === 0) return true;

    const mySteal = stealPlayers.find(s => toNum(s.gid) === myGid);
    const myStealCount = mySteal ? toNum(mySteal.num) : 0;
    const maxSteal = toNum(plant.steal_num, 0);
    return myStealCount < maxSteal;
  });

  if (!hasStealSlot && analysis.stealable.length === 0) {
    await leaveFriendFarm(gid);
    return { acted: false, entered: true };
  }

  // Steal（先批量偷，失败再逐块 fallback，统计准确）
  if (analysis.stealable.length > 0) {
    let stolen = 0;
    const stolenNames = [];

    // 先尝试批量偷取（stealHarvest 用 is_all=true，服务端会截断到可偷数量）
    let batchSuccess = false;
    try {
      await stealHarvest(gid, analysis.stealable);
      // 批量成功：不能假设全部偷到，用 fallback 逐块验证哪些真正成功
      // 但为了效率，直接按 stealable.length 计数（服务端 is_all=true 语义是"尽量偷"）
      // 如果服务端返回错误，走 catch fallback
      batchSuccess = true;
      stolen = analysis.stealable.length;
      analysis.stealable.forEach(landId => {
        const info = analysis.stealableInfo.find(s => s.landId === landId);
        if (info) stolenNames.push(info.name);
      });
    } catch (_) {
      // 批量失败，逐块 fallback
      for (const landId of analysis.stealable) {
        try {
          await stealHarvest(gid, [landId]);
          stolen++;
          const info = analysis.stealableInfo.find(s => s.landId === landId);
          if (info) stolenNames.push(info.name);
        } catch (_) {
          // Skip individual failures
        }
        await randomDelay(50, 100);
      }
    }

    if (stolen > 0) {
      const namesStr = [...new Set(stolenNames)].join('/');
      actionLogs.push(`偷${stolen}${namesStr ? `(${namesStr})` : ''}`);
      tally.steal += stolen;
      recordOperation('steal', stolen);
      if (!batchSuccess) await randomDelay(50, 100);
    }
  }

  if (actionLogs.length > 0) {
    log('好友', `${name}: ${actionLogs.join('/')}`, {
      module: 'friend',
      event: '偷好友菜',
      result: 'ok',
      friendName: name,
      friendGid: gid,
      actions: actionLogs,
    });
  }

  await leaveFriendFarm(gid);
  return { acted: actionLogs.length > 0, entered: true };
}

// ===== Visit friend for help only =====

/**
 * Visit a friend specifically to help (water/weed/bug).
 * Honors experience limit. Guard dog friends bypass the limit.
 */
async function visitFriendForHelp(friend, tally, myGid, accountId, ignoreExpLimit = false, expLimitMode = false) {
  const { gid, name } = friend;
  const expLimitEnabled = !!isAutomationOn('friend_help_exp_limit');
  const checkExpLimit = expLimitEnabled && !ignoreExpLimit;
  const hasGuardDog = !!friend.hasGuardDog;

  // 仅当"经验上限开关本就关闭"时，才自由保持/恢复 canGetHelpExp=true。
  // 若开关开着却因 ignoreExpLimit 导致本次 checkExpLimit=false，绝不擅自清掉已触发的
  // 仅帮护主犬禁用状态，否则会出现"无差别帮所有人"的回退。
  if (!expLimitEnabled) setCanGetHelpExp(true);

  // Skip if exp limit reached and no guard dog
  if (checkExpLimit && !getCanGetHelpExp() && !hasGuardDog) {
    return { acted: false, entered: false };
  }

  let enterReply;
  try {
    enterReply = await enterFriendFarm(gid);
  } catch (err) {
    const handled = handleFriendEnterError(gid, name, err);
    if (handled.handled) {
      return { acted: false, entered: false };
    }
    logWarn('好友', `进入 ${name} 农场失败: ${err.message}`, {
      module: 'friend',
      event: '进入农场',
      result: 'error',
      friendName: name,
      friendGid: gid,
    });
    return { acted: false, entered: false };
  }

  const lands = enterReply.lands || [];
  if (lands.length === 0) {
    await leaveFriendFarm(gid);
    return { acted: false, entered: true };
  }

  cacheDogInfoFromEnterReply(gid, enterReply);

  const analysis = analyzeFriendLands(lands, myGid, name, {});
  const actionLogs = [];

  const helpOptions = [
    {
      id: 0x2715,             // 10005 = weed
      expIds: [0x2715, 0x2713], // [10005, 10003]
      list: analysis.needWeed,
      fn: helpWeed,
      key: 'weed',
      name: '草',
      record: 'helpWeed',
    },
    {
      id: 0x2716,             // 10006 = bug
      expIds: [0x2716, 0x2712], // [10006, 10002]
      list: analysis.needBug,
      fn: helpInsecticide,
      key: 'bug',
      name: '虫',
      record: 'helpBug',
    },
    {
      id: 0x2717,             // 10007 = water
      expIds: [0x2717, 0x2711], // [10007, 10001]
      list: analysis.needWater,
      fn: helpWater,
      key: 'water',
      name: '水',
      record: 'helpWater',
    },
  ];

  const useExpCheck = hasGuardDog ? false : checkExpLimit;

  for (const opt of helpOptions) {
    const canGetExp = !checkExpLimit ||
      hasGuardDog ||
      (canGetExpByCandidates(opt.expIds) && getCanGetHelpExp());
    if (!(opt.list.length > 0 && canGetExp))
      continue;
    try {
      const okCount = await runBatchWithFallback(
        opt.list,
        ids => opt.fn(gid, ids, useExpCheck),
        id => opt.fn(gid, id, useExpCheck),
      );
      if (okCount > 0) {
        if (expLimitMode && hasGuardDog) {
          log('好友', `[护主犬好友] ✅ ${name}: 除${opt.name}${okCount}`, {
            module: 'friend',
            event: '护主犬好友帮助成功',
            friendName: name,
            operation: opt.name,
            count: okCount,
          });
        }
        actionLogs.push(`${opt.name}${okCount}`);
        tally[opt.key] += okCount;
        recordOperation(opt.record, okCount);
      }
    } catch (_) {
      // 单个帮助操作整体失败，跳过
    }
    await sleep(200);
  }

  if (actionLogs.length > 0) {
    log('好友', `${name}: ${actionLogs.join('/')}`, {
      module: 'friend',
      event: '帮助好友',
      result: 'ok',
      friendName: name,
      friendGid: gid,
      actions: actionLogs,
    });
  } else if (expLimitMode && hasGuardDog) {
    // 护主犬好友但所有操作都没成功，记录原因方便排查
    logWarn('好友', `[护主犬好友] ${name}: 进入农场但无有效操作（可能土地状态已变或次数用完）`, {
      module: 'friend',
      event: '护主犬好友帮助无效果',
      friendName: name,
      friendGid: gid,
      needWater: analysis.needWater.length,
      needWeed: analysis.needWeed.length,
      needBug: analysis.needBug.length,
    });
  }

  await leaveFriendFarm(gid);
  return { acted: actionLogs.length > 0, entered: true };
}

// ===== Exports =====
module.exports = {
  runBatchWithFallback,
  doFriendOperation,
  visitFriend,
  visitFriendForSteal,
  visitFriendForHelp,
};
