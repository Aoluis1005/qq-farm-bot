const { toNum, log, sleep } = require('../utils/utils');
const { getUserState } = require('../utils/network');
const { types } = require('../utils/proto');
const { sendMsgAsync } = require('../utils/network');
const { toLong } = require('../utils/utils');

// ===== Operation limits state =====
const operationLimits = new Map();
let lastResetDate = '';
let canGetHelpExp = true;
let helpAutoDisabledByLimit = false;
let localBadOperationCount = 0;
let onExpLimitReachedCallback = null;

const PUT_BUG_OPERATION_ID = 10005;
const PUT_WEED_OPERATION_ID = 10006;
const GOLDEN_BUG_OPERATION_ID = 10015;
const BAD_DAILY_LIMIT = 100;

// ===== Operation type names =====
const OP_NAMES = {
  '10001': '帮好友浇水',
  '10002': '帮好友除草',
  '10003': '帮好友除虫',
  '10004': '偷取好友作物',
  '10005': '给好友放虫',
  '10006': '给好友放草',
  '10007': '帮好友复活',
  '10008': '好友帮忙浇水',
  '10015': '给好友放黄金虫',
};

// ===== Daily reset =====

/**
 * Check if a new day has started (China timezone UTC+8) and reset limits.
 */
function checkDailyReset() {
  const { getServerTimeSec } = require('../utils/utils');
  const serverSec = getServerTimeSec();
  const serverMs = serverSec > 0
    ? serverSec * 1000
    : Date.now();

  // UTC+8 timezone offset: 8 hours in milliseconds
  const UTC_PLUS_8_OFFSET_MS = 8 * 3600 * 1000;
  const chinaDate = new Date(serverMs + UTC_PLUS_8_OFFSET_MS);
  const year = chinaDate.getUTCFullYear();
  const month = String(chinaDate.getUTCMonth() + 1).padStart(2, '0');
  const day = String(chinaDate.getUTCDate()).padStart(2, '0');
  const today = `${year}-${month}-${day}`;

  if (lastResetDate !== today) {
    if (lastResetDate !== '') {
      log('系统', '跨日重置，清空操作限制缓存');
    }
    operationLimits.clear();
    localBadOperationCount = 0;
    canGetHelpExp = true;

    if (helpAutoDisabledByLimit) {
      helpAutoDisabledByLimit = false;
      log('好友', '新的一天已开始，自动恢复帮忙操作功能', {
        module: 'friend',
        event: '好友巡查循环',
        result: 'ok',
      });
    }

    lastResetDate = today;
  }
}

/**
 * Disable help when daily experience limit is reached.
 * After this, only guard-dog (护主犬) friends will still be helped.
 */
function autoDisableHelpByExpLimit() {
  if (!canGetHelpExp) return;
  canGetHelpExp = false;
  helpAutoDisabledByLimit = true;
  log('好友', '今日帮助经验已达上限，自动停止普通帮忙，开启仅帮助护主犬好友模式', {
    module: 'friend',
    event: '好友巡查循环',
    result: 'ok',
  });
  if (typeof onExpLimitReachedCallback === 'function') {
    onExpLimitReachedCallback();
  }
}

function setOnExpLimitReachedCallback(fn) {
  onExpLimitReachedCallback = typeof fn === 'function' ? fn : null;
}

// ===== Operation limits =====

/**
 * Update operation limits from server response (after each RPC call).
 */
function updateOperationLimits(limits) {
  if (!limits || limits.length === 0) return;
  checkDailyReset();
  for (const limit of limits) {
    const id = toNum(limit.id);
    if (id > 0) {
      operationLimits.set(id, {
        dayTimes: toNum(limit.day_times),
        dayTimesLimit: toNum(limit.day_times_lt),
        dayExpTimes: toNum(limit.day_exp_times),
        dayExpTimesLimit: toNum(limit.day_ex_times_lt),
      });
    }
  }
}

/**
 * Check if we can still gain experience from a specific operation.
 */
function canGetExp(operationId) {
  const limit = operationLimits.get(operationId);
  if (!limit) return true;
  // No experience limit set -> can get exp
  if (limit.dayExpTimesLimit <= 0) return true;
  return limit.dayExpTimes < limit.dayExpTimesLimit;
}

/**
 * Check if we can gain experience from any of the given operation candidates.
 */
function canGetExpByCandidates(expIds = []) {
  const ids = Array.isArray(expIds) ? expIds : [expIds];
  for (const id of ids) {
    if (canGetExp(toNum(id))) return true;
  }
  return false;
}

/**
 * 判断服务端是否已回传过这若干经验 id 中任意一个的额度数据。
 * canGetExp 在"没有记录"时返回 true（认为还能得经验），这会和"真有额度"混淆。
 * 此函数专门区分"无记录（数据缺失）"与"有记录且未满"，供"仅帮护主犬"重置逻辑使用，
 * 避免 operationLimits 为空时误把经验上限重置回 true，导致无差别帮助所有人。
 */
function hasKnownHelpExpLimits(expIds = []) {
  const ids = Array.isArray(expIds) ? expIds : [expIds];
  for (const id of ids) {
    if (operationLimits.has(toNum(id))) return true;
  }
  return false;
}

/**
 * Check if an operation can still be performed (by operation count limit).
 */
function canOperate(operationId, fallbackLimit = 0) {
  const limit = operationLimits.get(operationId);
  const fallback = Math.max(0, Number(fallbackLimit) || 0);
  if (!limit) return true; // No limit known -> assume allowed
  const dayTimesLimit = limit.dayTimesLimit > 0 ? limit.dayTimesLimit : fallback;
  if (dayTimesLimit <= 0) return true; // No limit set
  return limit.dayTimes < dayTimesLimit;
}

/**
 * Get remaining times for an operation. Returns 999 if unlimited.
 */
function getRemainingTimes(operationId, fallbackLimit = 0) {
  const limit = operationLimits.get(operationId);
  const fallback = Math.max(0, Number(fallbackLimit) || 0);
  if (!limit) return fallback > 0 ? fallback : 999;
  const dayTimesLimit = limit.dayTimesLimit > 0 ? limit.dayTimesLimit : fallback;
  if (dayTimesLimit <= 0) return 999;
  return Math.max(0, dayTimesLimit - limit.dayTimes);
}

function getOperationDayTimes(operationId) {
  const limit = operationLimits.get(operationId);
  return limit ? Math.max(0, toNum(limit.dayTimes)) : 0;
}

function getBadOperationUsedCount() {
  const serverUsed =
    getOperationDayTimes(PUT_BUG_OPERATION_ID) +
    getOperationDayTimes(PUT_WEED_OPERATION_ID);
  return Math.max(serverUsed, localBadOperationCount);
}

function getBadRemainingTimes() {
  return Math.max(0, BAD_DAILY_LIMIT - getBadOperationUsedCount());
}

function canOperateBad() {
  return getBadRemainingTimes() > 0;
}

function recordBadOperationSuccess(count) {
  localBadOperationCount += Math.max(0, Number(count) || 0);
}

/**
 * Get all operation limits as a key-value map with names.
 */
function getOperationLimits() {
  const result = {};
  const allIds = [10001, 10002, 10003, 10004, 10005, 10006, 10007, 10008, 10015];
  for (const id of allIds) {
    const limit = operationLimits.get(id);
    if (limit) {
      result[id] = {
        name: OP_NAMES[id] || `#${id}`,
        ...limit,
        remaining: getRemainingTimes(id),
      };
    }
  }
  return result;
}

// ===== Help exp limit state =====

function getCanGetHelpExp() {
  return canGetHelpExp;
}

function setCanGetHelpExp(value) {
  canGetHelpExp = !!value;
}

function getHelpAutoDisabledByLimit() {
  return helpAutoDisabledByLimit;
}

// ===== Friend operation RPC calls =====

/**
 * Help water a friend's lands.
 * If `checkExpLimit` is true, sleeps 200ms after the call and checks if exp increased
 * to determine if the help exp limit is reached.
 */
async function helpWater(gid, landIds, checkExpLimit = false) {
  const expBefore = toNum((getUserState() || {}).exp);
  const payload = types.WaterLandRequest.encode(
    types.WaterLandRequest.create({
      land_ids: landIds,
      host_gid: toLong(gid),
    })
  ).finish();
  const { body } = await sendMsgAsync(
    'gamepb.plantpb.PlantService',
    'WaterLand',
    payload
  );
  const reply = types.WaterLandReply.decode(body);
  updateOperationLimits(reply.operation_limits);

  if (checkExpLimit) {
    // 修复：不再用 expAfter <= expBefore 猜测经验是否满（网络延迟/操作无收益都会误判），
    // 改为直接检查服务端 operation_limits 里所有帮忙操作的经验次数是否都达上限。
    // helpWater=10007, helpWeed=10005, helpBug=10006 及其配对 id
    const allHelpExpIds = [0x2715, 0x2713, 0x2716, 0x2712, 0x2717, 0x2711];
    const anyExpLeft = allHelpExpIds.some(id => canGetExp(id));
    if (!anyExpLeft) {
      autoDisableHelpByExpLimit();
    }
  }

  return reply;
}

/**
 * Help weed a friend's lands.
 */
async function helpWeed(gid, landIds, checkExpLimit = false) {
  const expBefore = toNum((getUserState() || {}).exp);
  const payload = types.WeedOutRequest.encode(
    types.WeedOutRequest.create({
      land_ids: landIds,
      host_gid: toLong(gid),
    })
  ).finish();
  const { body } = await sendMsgAsync(
    'gamepb.plantpb.PlantService',
    'WeedOut',
    payload
  );
  const reply = types.WeedOutReply.decode(body);
  updateOperationLimits(reply.operation_limits);

  if (checkExpLimit) {
    // 修复：不再用 expAfter <= expBefore 猜测经验是否满（网络延迟/操作无收益都会误判），
    // 改为直接检查服务端 operation_limits 里所有帮忙操作的经验次数是否都达上限。
    // helpWater=10007, helpWeed=10005, helpBug=10006 及其配对 id
    const allHelpExpIds = [0x2715, 0x2713, 0x2716, 0x2712, 0x2717, 0x2711];
    const anyExpLeft = allHelpExpIds.some(id => canGetExp(id));
    if (!anyExpLeft) {
      autoDisableHelpByExpLimit();
    }
  }

  return reply;
}

/**
 * Help insecticide a friend's lands.
 */
async function helpInsecticide(gid, landIds, checkExpLimit = false) {
  const expBefore = toNum((getUserState() || {}).exp);
  const payload = types.InsecticideRequest.encode(
    types.InsecticideRequest.create({
      land_ids: landIds,
      host_gid: toLong(gid),
    })
  ).finish();
  const { body } = await sendMsgAsync(
    'gamepb.plantpb.PlantService',
    'Insecticide',
    payload
  );
  const reply = types.InsecticideReply.decode(body);
  updateOperationLimits(reply.operation_limits);

  if (checkExpLimit) {
    // 修复：不再用 expAfter <= expBefore 猜测经验是否满（网络延迟/操作无收益都会误判），
    // 改为直接检查服务端 operation_limits 里所有帮忙操作的经验次数是否都达上限。
    // helpWater=10007, helpWeed=10005, helpBug=10006 及其配对 id
    const allHelpExpIds = [0x2715, 0x2713, 0x2716, 0x2712, 0x2717, 0x2711];
    const anyExpLeft = allHelpExpIds.some(id => canGetExp(id));
    if (!anyExpLeft) {
      autoDisableHelpByExpLimit();
    }
  }

  return reply;
}

/**
 * Steal harvest from a friend's lands (bulk or single).
 */
async function stealHarvest(gid, landIds) {
  const payload = types.HarvestRequest.encode(
    types.HarvestRequest.create({
      land_ids: landIds,
      host_gid: toLong(gid),
      is_all: true,
    })
  ).finish();
  const { body } = await sendMsgAsync(
    'gamepb.plantpb.PlantService',
    'Harvest',
    payload
  );
  const reply = types.HarvestReply.decode(body);
  updateOperationLimits(reply.operation_limits);
  return reply;
}

/**
 * Generic helper to put items (weeds/insects) on friend's lands one by one.
 * Returns the number of successful operations.
 */
async function putPlantItems(gid, landIds, RequestType, ReplyType, rpcMethod) {
  const ids = Array.isArray(landIds) ? landIds.filter(Boolean) : [];
  if (ids.length === 0) return 0;

  // 优化：先一次性批量，失败再逐块（去掉 randomDelay）
  try {
    const payload = RequestType.encode(
      RequestType.create({
        land_ids: ids.map(id => toLong(id)),
        host_gid: toLong(gid),
      })
    ).finish();
    const { body } = await sendMsgAsync(
      'gamepb.plantpb.PlantService',
      rpcMethod,
      payload
    );
    const reply = ReplyType.decode(body);
    updateOperationLimits(reply.operation_limits);
    return ids.length;
  } catch (batchErr) {
    // Fallback：逐块
    let ok = 0;
    const batchMsg = (batchErr && batchErr.message) ? batchErr.message : '';
    if (batchMsg.includes('1001046') || batchMsg.includes('used up')) return 0;

    for (const landId of ids) {
      try {
        const singlePayload = RequestType.encode(
          RequestType.create({
            land_ids: [toLong(landId)],
            host_gid: toLong(gid),
          })
        ).finish();
        const { body } = await sendMsgAsync(
          'gamepb.plantpb.PlantService',
          rpcMethod,
          singlePayload
        );
        const reply = ReplyType.decode(body);
        updateOperationLimits(reply.operation_limits);
        ok++;
      } catch (err) {
        const msg = (err && err.message) ? err.message : '未知错误';
        if (!msg.includes('1001046')) {
          log('好友', `放虫/放草失败: landId=${landId}, 错误: ${msg}`, {
            module: 'friend',
            event: '放虫放草失败',
            landId,
            error: msg,
          });
        }
      }
    }
    return ok;
  }
}

/**
 * Detailed version of putPlantItems that returns failure details.
 * Returns: { ok: number, failed: [{landId, reason}] }
 */
async function putPlantItemsDetailed(gid, landIds, RequestType, ReplyType, rpcMethod) {
  const ids = Array.isArray(landIds) ? landIds.filter(Boolean) : [];
  if (ids.length === 0) return { ok: 0, failed: [] };

  // 优化：先一次性把所有 landIds 传给服务端（协议 land_ids 是数组，支持批量）。
  // 成功则 1 次 RPC 完成 N 块地；失败再 fallback 到逐块。
  try {
    const payload = RequestType.encode(
      RequestType.create({
        land_ids: ids.map(id => toLong(id)),
        host_gid: toLong(gid),
      })
    ).finish();
    const { body } = await sendMsgAsync(
      'gamepb.plantpb.PlantService',
      rpcMethod,
      payload
    );
    const reply = ReplyType.decode(body);
    updateOperationLimits(reply.operation_limits);
    // 批量成功：假设全部生效（服务端对越界/已达上限的 land 会返回部分成功，
    // 但当前协议未返回逐块明细，保守按全部成功计数）
    return { ok: ids.length, failed: [] };
  } catch (batchErr) {
    // 批量失败，fallback 到逐块（去掉 randomDelay）
    let ok = 0;
    const failed = [];
    const batchMsg = (batchErr && batchErr.message) ? batchErr.message : '未知错误';

    // 如果是"次数用完"类错误，整批跳过即可，不必逐块重试
    if (batchMsg.includes('1001046') || batchMsg.includes('used up')) {
      for (const landId of ids) {
        failed.push({ landId, reason: batchMsg });
      }
      return { ok: 0, failed };
    }

    for (const landId of ids) {
      try {
        const singlePayload = RequestType.encode(
          RequestType.create({
            land_ids: [toLong(landId)],
            host_gid: toLong(gid),
          })
        ).finish();
        const { body } = await sendMsgAsync(
          'gamepb.plantpb.PlantService',
          rpcMethod,
          singlePayload
        );
        const reply = ReplyType.decode(body);
        updateOperationLimits(reply.operation_limits);
        ok++;
      } catch (err) {
        const msg = (err && err.message) ? err.message : '未知错误';
        failed.push({ landId, reason: msg });
        if (!msg.includes('1001046')) {
          log('好友', `放虫/放草失败: landId=${landId}, 错误: ${msg}`, {
            module: 'friend',
            event: '放虫放草失败',
            landId,
            error: msg,
            detailed: true,
          });
        }
      }
    }

    return { ok, failed };
  }
}

// ===== Specific put operations =====

async function putInsects(gid, landIds) {
  const ok = await putPlantItems(gid, landIds, types.PutInsectsRequest, types.PutInsectsReply, 'PutInsects');
  recordBadOperationSuccess(ok);
  return ok;
}

async function putWeeds(gid, landIds) {
  const ok = await putPlantItems(gid, landIds, types.PutWeedsRequest, types.PutWeedsReply, 'PutWeeds');
  recordBadOperationSuccess(ok);
  return ok;
}

async function putInsectsDetailed(gid, landIds) {
  const result = await putPlantItemsDetailed(gid, landIds, types.PutInsectsRequest, types.PutInsectsReply, 'PutInsects');
  recordBadOperationSuccess(result.ok);
  return result;
}

async function putWeedsDetailed(gid, landIds) {
  const result = await putPlantItemsDetailed(gid, landIds, types.PutWeedsRequest, types.PutWeedsReply, 'PutWeeds');
  recordBadOperationSuccess(result.ok);
  return result;
}

// ===== Exports =====
module.exports = {
  OP_NAMES,
  PUT_BUG_OPERATION_ID,
  PUT_WEED_OPERATION_ID,
  GOLDEN_BUG_OPERATION_ID,
  BAD_DAILY_LIMIT,
  checkDailyReset,
  autoDisableHelpByExpLimit,
  updateOperationLimits,
  canGetExp,
  canGetExpByCandidates,
  hasKnownHelpExpLimits,
  canOperate,
  canOperateBad,
  getRemainingTimes,
  getBadRemainingTimes,
  getOperationLimits,
  getCanGetHelpExp,
  setCanGetHelpExp,
  getHelpAutoDisabledByLimit,
  setOnExpLimitReachedCallback,
  helpWater,
  helpWeed,
  helpInsecticide,
  stealHarvest,
  putPlantItems,
  putPlantItemsDetailed,
  putInsects,
  putWeeds,
  putInsectsDetailed,
  putWeedsDetailed,
};
