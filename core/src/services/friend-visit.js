const { PlantPhase } = require('../config/config');
const { getPlantBlacklist, isAutomationOn } = require('../models/store');
const { getUserState } = require('../utils/network');
const { toNum, log, logWarn, randomDelay, sleep } = require('../utils/utils');
const { recordOperation } = require('./stats');
const { sellAllFruits } = require('./warehouse');
const {
  enterFriendFarm,
  leaveFriendFarm,
  checkCanOperateRemote,
  handleFriendEnterError,
} = require('./friend-api');
const { analyzeFriendLands } = require('./friend-land-analyzer');
const { getCurrentPhase } = require('./farm-land-analyzer');
const {
  getRemainingTimes,
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

  try {
    await batchFn(ids);
    return ids.length;
  } catch (_) {
    // Fallback: one by one
    let ok = 0;
    for (const id of ids) {
      try {
        await singleFn([id]);
        ok++;
      } catch (_) {
        // Skip individual failures
      }
      await sleep(100);
    }
    return ok;
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
    const userState = getUserState();
    const plantBlacklist = getPlantBlacklist(userState.accountId);
    const analysis = analyzeFriendLands(lands, userState.gid, '', { plantBlacklist });

    let okCount = 0;

    // ---- Steal ----
    if (opType === 'steal') {
      if (!analysis.stealable.length) {
        return { ok: true, opType, count: 0, message: '没有可偷取土地' };
      }

      const canOp = await checkCanOperateRemote(numericGid, 0x2714); // 10004
      if (!canOp.canOperate) {
        return { ok: true, opType, count: 0, message: 'Ta已经被偷的精光了QAQ' };
      }

      const stealCount = canOp.canStealNum > 0
        ? canOp.canStealNum
        : analysis.stealable.length;
      const targetLands = analysis.stealable.slice(0, stealCount);

      okCount = await runBatchWithFallback(
        targetLands,
        ids => stealHarvest(numericGid, ids),
        id => stealHarvest(numericGid, id)
      );

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

      const canOp = await checkCanOperateRemote(numericGid, 0x2717); // 10007
      if (!canOp.canOperate) {
        return { ok: true, opType, count: 0, message: '浇水失败，来晚一步，可惜' };
      }

      okCount = await runBatchWithFallback(
        analysis.needWater,
        ids => helpWater(numericGid, ids),
        id => helpWater(numericGid, id)
      );

      if (okCount > 0) recordOperation('helpWater', okCount);
      return { ok: true, opType, count: okCount, message: `浇水完成 ${okCount} 块` };
    }

    // ---- Weed ----
    if (opType === 'weed') {
      if (!analysis.needWeed.length) {
        return { ok: true, opType, count: 0, message: '没有可除草土地' };
      }

      const canOp = await checkCanOperateRemote(numericGid, 0x2715); // 10005
      if (!canOp.canOperate) {
        return { ok: true, opType, count: 0, message: '除草失败，来晚一步，可惜' };
      }

      okCount = await runBatchWithFallback(
        analysis.needWeed,
        ids => helpWeed(numericGid, ids),
        id => helpWeed(numericGid, id)
      );

      if (okCount > 0) recordOperation('helpWeed', okCount);
      return { ok: true, opType, count: okCount, message: `除草完成 ${okCount} 块` };
    }

    // ---- Bug ----
    if (opType === 'bug') {
      if (!analysis.needBug.length) {
        return { ok: true, opType, count: 0, message: '没有可除虫土地' };
      }

      const canOp = await checkCanOperateRemote(numericGid, 0x2716); // 10006
      if (!canOp.canOperate) {
        return { ok: true, opType, count: 0, message: '除虫失败，来晚一步，可惜' };
      }

      okCount = await runBatchWithFallback(
        analysis.needBug,
        ids => helpInsecticide(numericGid, ids),
        id => helpInsecticide(numericGid, id)
      );

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

      // Put insects
      if (analysis.canPutBug.length) {
        const result = await putInsectsDetailed(numericGid, analysis.canPutBug);
        bugCount = result.ok;
        failedMsgs = failedMsgs.concat(
          (result.failed || []).map(f => `放虫#${f.landId}:${f.reason}`)
        );
        if (bugCount > 0) recordOperation('bug', bugCount);
      }

      // Put weeds
      if (analysis.canPutWeed.length) {
        const result = await putWeedsDetailed(numericGid, analysis.canPutWeed);
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
          const canOp = await checkCanOperateRemote(gid, opt.id);
          if (canOp.canOperate) {
            const okCount = await runBatchWithFallback(
              opt.list,
              ids => opt.fn(gid, ids, expLimitEnabled),
              id => opt.fn(gid, id, expLimitEnabled)
            );
            if (okCount > 0) {
              actionLogs.push(`${opt.name}${okCount}`);
              tally[opt.key] += okCount;
              recordOperation(opt.record, okCount);
              await randomDelay(500, 1000);
            }
          }
        }
      }
    }
  }

  // ---- Steal ----
  if (isAutomationOn('friend_steal') && analysis.stealable.length > 0) {
    const canOp = await checkCanOperateRemote(gid, 0x2714); // 10004
    if (canOp.canOperate) {
      const stealCount = canOp.canStealNum > 0
        ? canOp.canStealNum
        : analysis.stealable.length;
      const targetLands = analysis.stealable.slice(0, stealCount);
      let stolen = 0;
      const stolenNames = [];

      try {
        await stealHarvest(gid, targetLands);
        stolen = targetLands.length;
        targetLands.forEach(landId => {
          const info = analysis.stealableInfo.find(s => s.landId === landId);
          if (info) stolenNames.push(info.name);
        });
      } catch (_) {
        // Fallback: steal one by one
        for (const landId of targetLands) {
          try {
            await stealHarvest(gid, [landId]);
            stolen++;
            const info = analysis.stealableInfo.find(s => s.landId === landId);
            if (info) stolenNames.push(info.name);
          } catch (_) {
            // Skip individual failures
          }
          await randomDelay(500, 1000);
        }
      }

      if (stolen > 0) {
        const namesStr = [...new Set(stolenNames)].join('/');
        actionLogs.push(`偷${stolen}${namesStr ? `(${namesStr})` : ''}`);
        tally.steal += stolen;
        recordOperation('steal', stolen);
        await randomDelay(500, 1500);
      }
    }
  }

  // ---- Bad (put weeds & insects) ----
  const badEnabled = isAutomationOn('friend_bad');
  let badCount = 0;
  let putBugCount = 0;
  let putWeedCount = 0;
  const badFailedMsgs = [];

  if (badEnabled) {
    const canPutBug = await checkCanOperateRemote(gid, 0x271A); // 10010?
    const canPutWeed = await checkCanOperateRemote(gid, 0x2719); // 10009?

    // Put insects
    if (analysis.canPutBug.length > 0 && canPutBug.canOperate) {
      const remainingBug = getRemainingTimes(0x271A);
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
      await randomDelay(500, 1500);
    }

    // Put weeds
    if (analysis.canPutWeed.length > 0 && canPutWeed.canOperate) {
      const remainingWeed = getRemainingTimes(0x2719);
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
      await randomDelay(500, 1500);
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

  // Steal
  if (analysis.stealable.length > 0) {
    const canOp = await checkCanOperateRemote(gid, 0x2714); // 10004
    if (canOp.canOperate) {
      const stealCount = canOp.canStealNum > 0
        ? canOp.canStealNum
        : analysis.stealable.length;
      const targetLands = analysis.stealable.slice(0, stealCount);
      let stolen = 0;
      const stolenNames = [];

      try {
        await stealHarvest(gid, targetLands);
        stolen = targetLands.length;
        targetLands.forEach(landId => {
          const info = analysis.stealableInfo.find(s => s.landId === landId);
          if (info) stolenNames.push(info.name);
        });
      } catch (_) {
        for (const landId of targetLands) {
          try {
            await stealHarvest(gid, [landId]);
            stolen++;
            const info = analysis.stealableInfo.find(s => s.landId === landId);
            if (info) stolenNames.push(info.name);
          } catch (_) {
            // Skip individual failures
          }
          await randomDelay(200, 600);
        }
      }

      if (stolen > 0) {
        const namesStr = [...new Set(stolenNames)].join('/');
        actionLogs.push(`偷${stolen}${namesStr ? `(${namesStr})` : ''}`);
        tally.steal += stolen;
        recordOperation('steal', stolen);
        await randomDelay(500, 1000);
      }
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

  if (!checkExpLimit) setCanGetHelpExp(true);

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

  for (const opt of helpOptions) {
    const canGetExp = !checkExpLimit ||
      hasGuardDog ||
      (canGetExpByCandidates(opt.expIds) && getCanGetHelpExp());

    if (opt.list.length > 0 && canGetExp) {
      const canOp = await checkCanOperateRemote(gid, opt.id);
      if (canOp.canOperate) {
        const useExpCheck = hasGuardDog ? false : checkExpLimit;
        const okCount = await runBatchWithFallback(
          opt.list,
          ids => opt.fn(gid, ids, useExpCheck),
          id => opt.fn(gid, id, useExpCheck)
        );
        if (okCount > 0) {
          actionLogs.push(`${opt.name}${okCount}`);
          tally[opt.key] += okCount;
          recordOperation(opt.record, okCount);

          if (expLimitMode && hasGuardDog) {
            log('好友', `[护主犬好友] ✅ ${name}: 除${opt.name}${okCount}`, {
              module: 'friend',
              event: '护主犬好友帮助成功',
              friendName: name,
              operation: opt.name,
              count: okCount,
            });
          }
          await randomDelay(300, 900);
        }
      }
    }
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
