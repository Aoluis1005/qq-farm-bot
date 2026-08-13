/**
 * 仓库服务 - 背包管理、果实出售、化肥使用
 *
 * 功能：
 * - 获取背包/背包详情
 * - 批量/单个出售作物果实
 * - 使用物品（含 protobuf raw 回退）
 * - 自动使用化肥礼包
 * - 化肥容器时间计算
 */
const protobuf = require('protobufjs');
const {
  getFruitName,
  getPlantByFruitId,
  getPlantBySeedId,
  getItemById,
  getItemImageById,
  getSeedLevel,
  getSeedImageBySeedId,
  isSeedItem,
} = require('../config/gameConfig');
const { isAutomationOn, getBagLockedItemIds } = require('../models/store');
const { sendMsgAsync, networkEvents, getUserState } = require('../utils/network');
const { types } = require('../utils/proto');
const { toLong, toNum, log, logWarn, sleep } = require('../utils/utils');
const { updateStatusGold } = require('./status');

// ---- 常量 ----

// 批量出售大小
const SELL_BATCH_SIZE = 15;

// 化肥容器上限（小时）
const FERTILIZER_CONTAINER_LIMIT_HOURS = 990;

// 容器物品 ID
const NORMAL_CONTAINER_ID = 1011;
const ORGANIC_CONTAINER_ID = 1012;

// 化肥相关物品 ID 集合
const FERTILIZER_RELATED_IDS = new Set([
  100003, 100004, 100005, 100006, 100007, 100008, 100009, 100010, 100011, 100012,
]);

// 普通化肥每小时提供时间（按物品 ID）
// 79873→1h, 80514→4h, 80003→8h, 80132→12h
const NORMAL_FERTILIZER_ITEM_HOURS = new Map([
  [79873, 1],
  [80514, 4],
  [80003, 8],
  [80132, 12],
]);

// 有机化肥每小时提供时间（按物品 ID）
// 80011→1h, 80012→4h, 80013→8h, 80014→12h
const ORGANIC_FERTILIZER_ITEM_HOURS = new Map([
  [80011, 1],
  [80012, 4],
  [80013, 8],
  [80014, 12],
]);

// ---- 状态追踪 ----

let fertilizerGiftDoneDateKey = '';
let fertilizerGiftLastOpenAt = 0;

// ---- 日期工具 ----

function getDateKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// ---- RPC 调用 ----

async function getBag() {
  const request = types.BagRequest.encode(types.BagRequest.create({})).finish();
  const { body } = await sendMsgAsync('gamepb.itempb.ItemService', 'Bag', request);
  return types.BagReply.decode(body);
}

function toSellItem(raw) {
  const id = toNum(raw && raw.id);
  const count = toNum(raw && raw.count);
  const uid = toNum(raw && raw.uid);
  const item = { id: toLong(id), count: toLong(count) };
  if (uid > 0) item.uid = toLong(uid);
  return item;
}

async function sellItems(items) {
  // 【2026-08-13】背包上锁名单过滤：锁定的物品（含果实）不发送出售请求（兜底，手动/自动共用）
  const accountId = process.env.FARM_ACCOUNT_ID || '';
  const lockedSet = new Set(getBagLockedItemIds(accountId));
  const sellable = (Array.isArray(items) ? items : [])
    .filter(raw => !lockedSet.has(toNum(raw && raw.id)));
  if (sellable.length === 0) {
    return { sell_items: [], get_items: [] };
  }
  const request = types.SellRequest.encode(
    types.SellRequest.create({ items: sellable.map(toSellItem) })
  ).finish();
  const { body } = await sendMsgAsync('gamepb.itempb.ItemService', 'Sell', request);
  return types.SellReply.decode(body);
}

/**
 * 使用物品（含 raw protobuf 回退）
 */
async function useItem(itemId, count = 1, landIds = []) {
  const request = types.UseRequest.encode(
    types.UseRequest.create({
      item_id: toLong(itemId),
      count: toLong(count),
      land_ids: (landIds || []).map((id) => toLong(id)),
    })
  ).finish();

  try {
    const { body } = await sendMsgAsync('gamepb.itempb.ItemService', 'Use', request);
    return types.UseReply.decode(body);
  } catch (err) {
    const msg = String(err && err.message || '');
    const isBadParam = msg.includes('code=1000020') || msg.includes('请求参数错误');

    if (!isBadParam) throw err;

    // 回退：手工构建 raw protobuf
    const writer = protobuf.Writer.create();
    writer.uint32(10).fork();         // field 1, wire 2
    writer.uint32(8).int64(toLong(itemId));  // field 1, varint
    writer.uint32(16).int64(toLong(count));  // field 2, varint
    writer.ldelim();

    const raw = writer.finish();
    const { body } = await sendMsgAsync('gamepb.itempb.ItemService', 'Use', raw);
    return types.UseReply.decode(body);
  }
}

async function batchUseItems(entries) {
  const items = (entries || []).map((e) => ({
    id: toLong(e.itemId),
    count: toLong(e.count || 1),
    uid: toLong(e.uid || 0),
  }));

  const request = types.BatchUseRequest.encode(
    types.BatchUseRequest.create({ items })
  ).finish();

  const { body } = await sendMsgAsync('gamepb.itempb.ItemService', 'BatchUse', request);
  return types.BatchUseReply.decode(body);
}

// ---- 数据解析 ----

function isFruitItemId(id) {
  // 统一以 Plant.json 为准：普通果实(4xxxx) 与变异果实(104xxxx) 均已收录
  return Boolean(getPlantByFruitId(Number(id)));
}

/**
 * 从背包回复中提取物品列表
 */
function getBagItems(reply) {
  if (reply && reply.item_bag && reply.item_bag.items && reply.item_bag.items.length) {
    return reply.item_bag.items;
  }
  return reply && reply.items ? reply.items : [];
}

/**
 * 判断是否为化肥相关物品
 */
function isFertilizerRelatedItemId(itemId) {
  const id = Number(itemId) || 0;
  if (id <= 0) return false;
  if (id === 1001 || id === 1002) return false;
  if (FERTILIZER_RELATED_IDS.has(id)) return true;

  const info = getItemById(id);
  if (!info || typeof info !== 'object') return false;
  const interactionType = String(info.interaction_type || '').toLowerCase();
  return interactionType === 'fertilizer' || interactionType === 'fertilizerpro';
}

/**
 * 从背包物品中收集化肥类物品的使用负载
 */
function collectFertilizerUsePayload(items) {
  const map = new Map();
  for (const item of items || []) {
    const id = toNum(item && item.id);
    const count = Math.max(0, toNum(item && item.count));
    if (id <= 0 || count <= 0) continue;
    if (!isFertilizerRelatedItemId(id)) continue;
    map.set(id, (map.get(id) || 0) + count);
  }
  return Array.from(map.entries()).map(([id, count]) => ({ id, count }));
}

/**
 * 从背包物品计算化肥容器剩余时间（小时）
 */
function getContainerHoursFromBagItems(items) {
  let normal = 0;
  let organic = 0;

  for (const item of items || []) {
    const id = toNum(item && item.id);
    const count = Math.max(0, toNum(item && item.count));
    if (id === NORMAL_CONTAINER_ID) normal = count;
    if (id === ORGANIC_CONTAINER_ID) organic = count;
  }

  // 容器值存储为秒，转换为小时
  return {
    normal: normal / 3600,
    organic: organic / 3600,
  };
}

/**
 * 获取化肥物品类型和每小时提供时间
 */
function getFertilizerItemTypeAndHours(itemId) {
  const id = Number(itemId) || 0;

  if (NORMAL_FERTILIZER_ITEM_HOURS.has(id)) {
    return { type: 'normal', perItemHours: NORMAL_FERTILIZER_ITEM_HOURS.get(id) };
  }
  if (ORGANIC_FERTILIZER_ITEM_HOURS.has(id)) {
    return { type: 'organic', perItemHours: ORGANIC_FERTILIZER_ITEM_HOURS.get(id) };
  }

  const info = getItemById(id) || {};
  const interactionType = String(info.interaction_type || '').toLowerCase();

  if (interactionType === 'fertilizer') return { type: 'normal', perItemHours: 1 };
  if (interactionType === 'fertilizerpro') return { type: 'organic', perItemHours: 1 };

  return { type: 'other', perItemHours: 0 };
}

/**
 * 判断是否为容器已满错误
 */
function isFertilizerContainerFullError(err) {
  const msg = String(err && err.message || '');
  return (
    msg.includes('code=1003002') ||
    msg.includes('普通化肥容器已达到上限') ||
    msg.includes('普通化肥容器已满') ||
    msg.includes('有机化肥容器已达到上限') ||
    msg.includes('有机化肥容器已满')
  );
}

// ---- 自动使用化肥 ----

async function autoOpenFertilizerGiftPacks() {
  try {
    const bag = await getBag();
    const items = getBagItems(bag);
    const payloads = collectFertilizerUsePayload(items);

    if (payloads.length <= 0) return 0;

    const containerHours = getContainerHoursFromBagItems(items);
    let totalUsed = 0;
    const usedLabels = [];

    for (const payload of payloads) {
      const itemId = Number(payload.id) || 0;
      let count = Math.max(0, Number(payload.count) || 0);
      const { type, perItemHours } = getFertilizerItemTypeAndHours(itemId);

      // 自适应调整使用量（不超过容器上限）
      if (type === 'normal' || type === 'organic') {
        const current = type === 'normal' ? containerHours.normal : containerHours.organic;
        if (current >= FERTILIZER_CONTAINER_LIMIT_HOURS) continue;

        if (perItemHours > 0) {
          const maxNeeded = Math.max(0, FERTILIZER_CONTAINER_LIMIT_HOURS - current);
          const maxByHours = Math.floor(maxNeeded / perItemHours);
          count = Math.max(0, Math.min(count, maxByHours));
          if (count <= 0) continue;
        }
      }

      const info = getItemById(itemId);
      const label = info && info.name ? String(info.name) : `物品#${itemId}`;

      let used = 0;
      try {
        await batchUseItems([{ itemId, count, uid: 0 }]);
        used = count;
      } catch (_) {
        used = 0;
      }

      if (used > 0) {
        totalUsed += used;
        usedLabels.push(`${label}x${used}`);

        if (type === 'normal' && perItemHours > 0) containerHours.normal += used * perItemHours;
        if (type === 'organic' && perItemHours > 0) containerHours.organic += used * perItemHours;
      }

      await sleep(100);
    }

    if (totalUsed > 0) {
      fertilizerGiftDoneDateKey = getDateKey();
      fertilizerGiftLastOpenAt = Date.now();
      log('仓库', `自动使用化肥类道具 x${totalUsed}${usedLabels.length ? ` [${usedLabels.join('，')}]` : ''}`, {
        module: 'warehouse', event: '开启化肥礼包', result: 'ok', count: totalUsed,
      });
    }

    return totalUsed;
  } catch (err) {
    if (isFertilizerContainerFullError(err)) return 0;
    logWarn('仓库', `开启化肥礼包失败: ${err.message}`, {
      module: 'warehouse', event: '开启化肥礼包', result: 'error',
    });
    return 0;
  }
}

async function openFertilizerGiftPacksSilently() {
  return autoOpenFertilizerGiftPacks();
}

// ---- 金币计算 ----

/**
 * 从物品列表获取金币数量（ID=1001）
 */
function getGoldFromItems(items) {
  for (const item of items || []) {
    const id = toNum(item.id);
    if (id === 1001 || id === 500001) {
      const count = toNum(item.count);
      if (count > 0) return count;
    }
  }
  return 0;
}

/**
 * 从出售回复推导金币变动
 */
function deriveGoldGainFromSellReply(reply, prevGold) {
  // 尝试 get_items 字段
  const getItemsGold = getGoldFromItems(reply && reply.get_items || []);
  if (getItemsGold > 0) {
    return { gain: getItemsGold, nextKnownGold: prevGold };
  }

  // 回退：items / sell_items
  const itemsGold = getGoldFromItems(reply && (reply.items || reply.sell_items) || []);
  if (itemsGold <= 0) return { gain: 0, nextKnownGold: prevGold };

  if (prevGold > 0 && itemsGold >= prevGold) {
    return { gain: itemsGold - prevGold, nextKnownGold: itemsGold };
  }

  return { gain: itemsGold, nextKnownGold: prevGold };
}

function getCurrentTotals() {
  const state = getUserState() || {};
  return {
    gold: Number(state.gold || 0),
    exp: Number(state.exp || 0),
  };
}

async function getCurrentTotalsFromBag() {
  const bag = await getBag();
  const items = getBagItems(bag);
  let gold = null;
  let exp = null;
  for (const item of items) {
    const id = toNum(item.id);
    const count = toNum(item.count);
    if (id === 1001 || id === 500001) gold = count;
    if (id === 1002 || id === 500002) exp = count;
  }
  return { gold, exp };
}

// ---- 背包详情 ----

async function getBagDetail() {
  const bag = await getBag();
  const items = getBagItems(bag);

  // 原始物品列表
  const originalItems = [];
  for (const item of items || []) {
    const id = toNum(item.id);
    const count = toNum(item.count);
    const uid = toNum(item.uid);
    if (id <= 0 || count <= 0) continue;
    originalItems.push({ id, count, uid });
  }

  // 按 ID 去重合并
  const merged = new Map();
  for (const item of items || []) {
    const id = toNum(item.id);
    const count = toNum(item.count);
    if (id <= 0 || count <= 0) continue;

    const info = getItemById(id) || null;
    let name = info && info.name ? String(info.name) : '';
    let category = 'item';

    if (id === 1001 || id === 500001) { name = '金币'; category = 'gold'; }
    else if (id === 1002 || id === 500002) { name = '经验'; category = 'exp'; }
    else if (getPlantByFruitId(id)) {
      if (!name) name = `${getFruitName(id)  }果实`;
      category = 'fruit';
    } else if (getPlantBySeedId(id)) {
      const plant = getPlantBySeedId(id);
      if (!name) name = `${plant && plant.name ? plant.name : '未知'  }种子`;
      category = 'seed';
    }

    if (!name) name = `物品${  id}`;

    const interactionType = info && info.interaction_type ? String(info.interaction_type) : '';
    const priceId = info ? Number(info.price_id) || 0 : 0;
    const priceUnit =
      priceId === 1005 ? '金豆豆' :
      priceId === 200 ? '点券' : '金';

    if (!merged.has(id)) {
      merged.set(id, {
        id,
        count: 0,
        name,
        image: getItemImageById(id),
        category,
        itemType: info ? Number(info.type) || 0 : 0,
        priceId,
        price: info ? Number(info.price) || 0 : 0,
        priceUnit,
        level: info ? Number(info.level) || 0 : 0,
        interactionType,
        hoursText: '',
      });
    }
    merged.get(id).count += count;
  }

  // 计算容器时间显示
  const resultItems = Array.from(merged.values()).map((entry) => {
    if (entry.interactionType === 'fertilizerbucket' && entry.count > 0) {
      const hours = Math.floor(entry.count / 3600 * 10) / 10;
      entry.hoursText = `${hours.toFixed(1)  }小时`;
    }
    return entry;
  });

  // 排序：按物品类型排序，同类型按数量降序
  const typeOrder = new Map([[1, 1], [2, 2], [4, 3]]);
  resultItems.sort((a, b) => {
    const typeA = Number(a.itemType || 0);
    const typeB = Number(b.itemType || 0);
    const orderA = typeOrder.has(typeA) ? typeOrder.get(typeA) : (typeA > 0 ? 1000 + typeA : Number.MAX_SAFE_INTEGER);
    const orderB = typeOrder.has(typeB) ? typeOrder.get(typeB) : (typeB > 0 ? 1000 + typeB : Number.MAX_SAFE_INTEGER);
    if (orderA !== orderB) return orderA - orderB;
    const countB = Number(b.count || 0);
    const countA = Number(a.count || 0);
    if (countB !== countA) return countB - countA;
    return Number(a.id || 0) - Number(b.id || 0);
  });

  return {
    totalKinds: resultItems.length,
    items: resultItems,
    originalItems,
  };
}

// ---- 出售果实 ----

/**
 * 出售所有果实
 */
async function sellAllFruits() {
  const sellEnabled = isAutomationOn('sell');
  if (!sellEnabled) return 0;

  try {
    const bag = await getBag();
    const items = getBagItems(bag);
    const fruits = [];
    // 【2026-08-13】背包上锁名单过滤：锁定的果实不自动出售
    const accountId = process.env.FARM_ACCOUNT_ID || '';
    const lockedSet = new Set(getBagLockedItemIds(accountId));
    let lockedSkippedCount = 0;

    for (const item of items) {
      const id = toNum(item.id);
      const count = toNum(item.count);
      if (isFruitItemId(id) && count > 0) {
        if (lockedSet.has(id)) {
          lockedSkippedCount += count;
          continue;
        }
        fruits.push(item);
      }
    }

    if (fruits.length === 0) {
      log('仓库', lockedSkippedCount > 0
        ? `无果实可出售（已上锁跳过 ${lockedSkippedCount} 个）`
        : '无果实可出售');
      return 0;
    }

    if (lockedSkippedCount > 0) {
      log('仓库', `自动出售跳过已上锁果实 x${lockedSkippedCount}`, {
        module: 'warehouse', event: '跳过上锁果实', result: 'skip', count: lockedSkippedCount,
      });
    }

    const totalsBefore = getCurrentTotals();
    const prevGold = totalsBefore.gold;
    let totalGoldFromReply = 0;
    let derivedGold = prevGold;
    const soldLabels = [];
    let soldKindCount = 0;
    let soldTotalCount = 0;
    let skippedKindCount = 0;

    function recordSoldFruit(item) {
      const id = toNum(item.id);
      const count = toNum(item.count);
      soldLabels.push(`${getFruitName(id)  }x${  count}`);
      soldKindCount += 1;
      soldTotalCount += count;
    }

    // 批量出售
    for (let i = 0; i < fruits.length; i += SELL_BATCH_SIZE) {
      const batch = fruits.slice(i, i + SELL_BATCH_SIZE);
      try {
        const sellResult = await sellItems(batch);
        const derived = deriveGoldGainFromSellReply(sellResult, derivedGold);
        const gain = Math.max(0, toNum(derived.gain));
        derivedGold = derived.nextKnownGold;
        if (gain > 0) totalGoldFromReply += gain;
        batch.forEach(recordSoldFruit);
      } catch (err) {
        // 批量失败，逐个重试
        logWarn('仓库', `批量出售失败，改为逐个重试: ${err.message}`);
        for (const fruit of batch) {
          try {
            const result = await sellItems([fruit]);
            const derived = deriveGoldGainFromSellReply(result, derivedGold);
            const gain = Math.max(0, toNum(derived.gain));
            derivedGold = derived.nextKnownGold;
            if (gain > 0) totalGoldFromReply += gain;
            recordSoldFruit(fruit);
          } catch (innerErr) {
            const fid = toNum(fruit.id);
            const fcount = toNum(fruit.count);
            skippedKindCount += 1;
            logWarn('仓库', `跳过不可售物品: ID=${fid} x${fcount} (${innerErr.message})`, {
              module: 'warehouse', event: '跳过不可售物品', result: 'skip', itemId: fid, count: fcount,
            });
          }
        }
      }
      if (i + SELL_BATCH_SIZE < fruits.length) await sleep(300);
    }

    // 等待金币更新
    let finalGold = prevGold;
    const startWait = Date.now();
    while (Date.now() - startWait < 3000) {
      const state = getUserState();
      const stateGold = state && state.gold ? state.gold : finalGold;
      if (stateGold !== prevGold) { finalGold = stateGold; break; }
      await sleep(200);
    }

    const totalsAfter = getCurrentTotals();
    const goldByState = finalGold > prevGold ? finalGold - prevGold : 0;
    const goldDelta = totalsAfter.gold - totalsBefore.gold;
    const expDelta = totalsAfter.exp - totalsBefore.exp;

    // 金币结算：优先用状态差值，回退到出售响应
    let bagGoldGain = 0;
    if (goldByState <= 0 && totalGoldFromReply <= 0) {
      try {
        const bagAfter = await getBag();
        const bagGold = getGoldFromItems(getBagItems(bagAfter));
        if (bagGold > prevGold) bagGoldGain = bagGold - prevGold;
      } catch (_) {}
    }

    const totalGoldGain = Math.max(totalGoldFromReply, goldByState, bagGoldGain);

    // 若状态未更新但出售有响应，手动修正状态
    if (goldByState <= 0 && totalGoldGain > 0) {
      const state = getUserState();
      if (state) {
        state.gold = Number(state.gold || 0) + totalGoldGain;
        updateStatusGold(state.gold);
      }
    }

    if (soldLabels.length === 0) {
      logWarn('仓库', `本轮果实出售未成功${skippedKindCount > 0 ? `，已跳过 ${skippedKindCount} 个不可售物品` : ''}`, {
        module: 'warehouse',
        event: 'sell_done',
        result: 'skipped',
        count: 0,
        skippedCount: skippedKindCount,
        totalsBefore,
        totalsAfter,
        totalsDeltaGold: goldDelta,
        totalsDeltaExp: expDelta,
      });
      return 0;
    }

    log('仓库', `出售 ${soldLabels.join(', ')}${skippedKindCount > 0 ? `，跳过 ${skippedKindCount} 个不可售物品` : ''}${totalGoldGain > 0 ? `，获得 ${totalGoldGain} 金币` : ''}`, {
      module: 'warehouse',
      event: totalGoldGain > 0 ? 'sell_success' : 'sell_done',
      result: totalGoldGain > 0 ? 'ok' : 'unknown_gain',
      count: soldKindCount,
      soldCount: soldTotalCount,
      skippedCount: skippedKindCount,
      gold: totalGoldGain,
      totalsBefore,
      totalsAfter,
      totalsDeltaGold: goldDelta,
      totalsDeltaExp: expDelta,
    });

    if (totalGoldGain > 0) {
      networkEvents.emit('sell', { gold: totalGoldGain, count: soldTotalCount });
    }
    return totalGoldGain || 0;
  } catch (err) {
    logWarn('仓库', `出售失败: ${err.message}`);
    return 0;
  }
}

// ---- 种子列表 ----

/**
 * 获取背包中的种子列表
 */
async function getBagSeeds() {
  const bag = await getBag();
  const items = getBagItems(bag);
  const seedMap = new Map();
  const missingInPlantJson = [];

  for (const item of items || []) {
    const id = toNum(item && item.id);
    const count = toNum(item && item.count);
    if (id <= 0 || count <= 0) continue;

    const plant = getPlantBySeedId(id);
    const info = getItemById(id) || null;
    const interactionType = String(info && info.interaction_type || '').toLowerCase();

    // 统一以 Plant.json 为唯一判定依据
    if (!plant) {
      // ItemInfo 看着像种子却没进 Plant.json → 说明配置表落后了，记录出来便于补表
      if (isSeedItem(id) || interactionType === 'plant') {
        if (missingInPlantJson.length < 20) missingInPlantJson.push(id);
      }
      continue;
    }

    const rawName = String(plant.name || `种子${id}`);
    const name = rawName.endsWith('??') ? rawName.slice(0, -2) : rawName;
    const requiredLevel = Math.max(0, Number(plant.land_level_need || 0) || Number(info && info.level || getSeedLevel(id) || 0));
    const plantSize = Math.max(1, Number(plant.size || 1));

    const existing = seedMap.get(id) || {
      seedId: id,
      name,
      count: 0,
      requiredLevel,
      image: getSeedImageBySeedId(id) || getItemImageById(id),
      plantSize,
    };
    existing.count += count;
    seedMap.set(id, existing);
  }

  if (missingInPlantJson.length > 0) {
    logWarn('仓库', `以下背包种子未收录进 Plant.json，已忽略: ${missingInPlantJson.join(',')}`, {
      module: 'warehouse', event: 'bag_seed_detect', result: 'missing_in_plant_json', count: missingInPlantJson.length,
    });
  }

  return Array.from(seedMap.values());
}

// ---- ?? ----
module.exports = {
  getBag,
  getBagDetail,
  sellItems,
  useItem,
  batchUseItems,
  openFertilizerGiftPacksSilently,
  getFertilizerGiftDailyState: () => ({
    key: 'fertilizer_gift_open',
    doneToday: fertilizerGiftDoneDateKey === getDateKey(),
    lastOpenAt: fertilizerGiftLastOpenAt,
  }),
  sellAllFruits,
  getBagItems,
  getCurrentTotalsFromBag,
  getBagSeeds,
  getContainerHoursFromBagItems,
};
