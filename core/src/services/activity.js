/**
 * 活动服务 - 活动商店与限时抽奖
 *
 * 功能：
 * - 获取活动分组信息
 * - 操作活动（购买/刷新随机商店）
 * - 解析随机商店与活动抽奖数据
 * - 原始 protobuf 回退解码
 */
const protobuf = require('protobufjs/minimal');
const { sendMsgAsync, getUserState, isConnected } = require('../utils/network');
const { types } = require('../utils/proto');
const { toNum } = require('../utils/utils');
const { getItemImageById, getItemById } = require('../config/gameConfig');
const { createModuleLogger } = require('./logger');
const { getBag, getBagItems } = require('./warehouse');

const activityLogger = createModuleLogger('activity');

const HELU_DRAW_REQUEST_GAP_MS = 450;
const HELU_DRAW_REFRESH_DELAY_MS = 350;
const QINGMEI_WINE_STEP_DELAY_MS = 1000;
const qingmeiClaimedDateByAccount = new Map();

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function getLocalDateKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getQingmeiClaimStateKey() {
  const state = getUserState();
  return String(state?.gid || state?.openid || 'current');
}

function markQingmeiClaimedToday() {
  qingmeiClaimedDateByAccount.set(getQingmeiClaimStateKey(), getLocalDateKey());
}

function isQingmeiClaimedToday() {
  return qingmeiClaimedDateByAccount.get(getQingmeiClaimStateKey()) === getLocalDateKey();
}

function assertActivityConnection(action) {
  if (!isConnected()) {
    throw new Error(`${action || '活动操作'}失败: 连接已断开，请等待自动重连后重试`);
  }
}

// ---- 活动常量 ----

// 南瓜活动标识
const NANGUA_ACTIVITY_UID = 'NanGua';
const HELU_ACTIVITY_UID = 'SAIJI';
const QINGMEI_ACTIVITY_UID = 'QingMeiActivity';

// 活动 ID（通过 proto 文件 reflect，脱混淆为可读命名）
const NANGUA_SHOP_ACTIVITY_ID = 2026030200;
const NANGUA_RANDOM_SHOP_ACTIVITY_ID = 2026030201;
const HELU_ACTIVITY_ID = 2026060100;
const HELU_DRAW_ACTIVITY_ID = 2026060101;
const HELU_EXCHANGE_ACTIVITY_ID = 2026060102;
const HELU_JOURNEY_ACTIVITY_ID = 2026060103;
const HELU_NOTES_ACTIVITY_ID = 2026060104;
const HELU_CURRENCY_ITEM_ID = 1018;
const QINGMEI_ACTIVITY_ID = 2026080100;
const QINGMEI_SEED_CLAIM_ACTIVITY_ID = 2026080101;
const QINGMEI_WINE_ACTIVITY_ID = 2026080102;
const QINGMEI_SEED_CLAIM_CMD = 4;
const QINGMEI_WINE_PREVIEW_CMD = 14;
const QINGMEI_WINE_BREW_CMD = 15;
const QINGMEI_WINE_SELL_CMD = 16;
const QINGMEI_SEED_ITEM_ID = 21221;
const QINGMEI_FRUIT_ITEM_ID = 41221;
const QINGMEI_SEED_REWARD_COUNT = 24;
const QINGMEI_FINE_BREW_STEPS = 3;
const HELU_PASSPORT_UID = 'SAIJI_PASSPORT';
const HELU_TITLE = '荷风十里蝉初鸣';
const HELU_SUB_ACTIVITY_KEYS = {
  giftLotus: 'giftLotus',
  shop: 'shop',
  journey: 'journey',
  notes: 'notes',
};
const HELU_SUB_ACTIVITY_DEFS = [
  { key: HELU_SUB_ACTIVITY_KEYS.giftLotus, title: '奇遇礼莲', icon: 'i-carbon-gift' },
  { key: HELU_SUB_ACTIVITY_KEYS.shop, title: '荷露商店', icon: 'i-carbon-store' },
  { key: HELU_SUB_ACTIVITY_KEYS.journey, title: '荷风游记', icon: 'i-carbon-map' },
  { key: HELU_SUB_ACTIVITY_KEYS.notes, title: '节令小札', icon: 'i-carbon-notebook' },
];

// 操作命令
const NANGUA_SHOP_BUY_CMD = 2;     // 购买
const NANGUA_SHOP_REFRESH_CMD = 3; // 刷新
const HELU_EXCHANGE_CMD = 1;
const HELU_DRAW_CMD = 9;

// ---- RPC 调用 ----

/**
 * 获取活动分组信息
 */
async function getActivityGroup(activityId = NANGUA_SHOP_ACTIVITY_ID, uid = NANGUA_ACTIVITY_UID) {
  const request = types.ActivityGetGroupRequest.encode(
    types.ActivityGetGroupRequest.create({
      id: Number(activityId) || NANGUA_SHOP_ACTIVITY_ID,
      uid: String(uid || ''),
    })
  ).finish();

  const { body } = await sendMsgAsync('gamepb.activitypb.ActivityService', 'GetGroup', request);
  const decoded = types.ActivityGetGroupReply.decode(body);

  // 附加原始字节供回退解析
  Object.defineProperty(decoded, '__rawBody', {
    value: Buffer.from(body || []),
    enumerable: false,
  });

  return decoded;
}

/**
 * 操作活动
 */
async function operateActivity(activityId, cmd, options = {}) {
  assertActivityConnection('活动操作');

  const payload = {
    id: Number(activityId) || NANGUA_SHOP_ACTIVITY_ID,
    cmd: Number(cmd) || 0,
  };

  if (options?.randomShopOperate && typeof options.randomShopOperate === 'object') {
    payload.random_shop_operate = {
      id: Number(options.randomShopOperate.id) || 0,
      count: Number(options.randomShopOperate.count) || 1,
    };
  } else if (options?.exchangeShopOperate && typeof options.exchangeShopOperate === 'object') {
    payload.exchange_shop_operate = {
      id: Number(options.exchangeShopOperate.id) || 0,
      count: Number(options.exchangeShopOperate.count) || 1,
    };
  } else if (options?.draw && typeof options.draw === 'object') {
    payload.draw = options.draw;
  }
  if (options?.helu_paid_draw && typeof options.helu_paid_draw === 'object') {
    payload.helu_paid_draw = options.helu_paid_draw;
  }
  if (options?.qingmeiClaim && typeof options.qingmeiClaim === 'object') {
    payload.qingmei_claim_params = {
      type: Math.max(0, toNum(options.qingmeiClaim.type)),
    };
  }
  if (options?.qingmeiWineStart && typeof options.qingmeiWineStart === 'object') {
    payload.qingmei_wine_start = {
      items: (options.qingmeiWineStart.items || []).map(item => ({
        id: toNum(item?.id),
        count: toNum(item?.count),
      })),
    };
  }
  if (options?.qingmeiWineBrew) {
    payload.qingmei_wine_brew = {};
  }
  if (options?.qingmeiWineSell && typeof options.qingmeiWineSell === 'object') {
    payload.qingmei_wine_sell = {
      multiple: Math.max(1, toNum(options.qingmeiWineSell.multiple) || 1),
    };
  }

  activityLogger.info('活动操作请求', {
    activityId: payload.id,
    cmd: payload.cmd,
    draw: payload.draw,
    exchangeShopOperate: payload.exchange_shop_operate,
    randomShopOperate: payload.random_shop_operate,
    heluPaidDraw: payload.helu_paid_draw,
    qingmeiClaim: payload.qingmei_claim_params,
    qingmeiWineStartCount: payload.qingmei_wine_start?.items?.length || 0,
    qingmeiWineBrew: !!payload.qingmei_wine_brew,
    qingmeiWineSell: payload.qingmei_wine_sell,
  });

  const request = types.ActivityOperateRequest.encode(
    types.ActivityOperateRequest.create(payload)
  ).finish();

  const { body } = await sendMsgAsync('gamepb.activitypb.ActivityService', 'Operate', request);
  return body;
}

async function operateActivityReply(activityId, cmd, options = {}) {
  const body = await operateActivity(activityId, cmd, options);
  return types.ActivityOperateReply.decode(body);
}

function normalizeCoreItem(item) {
  const itemId = toNum(item?.id);
  const count = toNum(item?.count);
  const info = getItemById(itemId);
  return {
    itemId,
    itemCount: count,
    count,
    itemName: info?.name || (itemId ? `物品#${itemId}` : ''),
    image: getItemImageById(itemId) || '',
  };
}

function normalizeQingmeiPreviewResult(result) {
  if (!result) return null;
  return {
    price: toNum(result?.price),
  };
}

function normalizeQingmeiBrewResult(result) {
  if (!result) return null;
  return {
    wineType: toNum(result?.wine_type ?? result?.wineType),
    cost: toNum(result?.cost),
    price: toNum(result?.price),
    canDouble: !!(result?.can_double ?? result?.canDouble),
  };
}

function normalizeQingmeiSellResult(result) {
  if (!result) return null;
  const item = normalizeCoreItem(result?.item || {});
  return {
    multiple: toNum(result?.multiple),
    gold: toNum(result?.gold) || item.itemCount,
    item,
  };
}

function normalizeQingmeiClaimResult(result) {
  const items = (Array.isArray(result?.items) ? result.items : [])
    .map(normalizeCoreItem)
    .filter(item => item.itemId > 0 && item.itemCount > 0);
  const seed = items.find(item => item.itemId === QINGMEI_SEED_ITEM_ID);
  return {
    items,
    claimedCount: seed?.itemCount || 0,
  };
}

function isAlreadyClaimedError(err) {
  const message = String(err?.message || err || '');
  return message.includes('已领取')
    || message.includes('已经领取')
    || message.includes('重复领取')
    || message.includes('already')
    || message.includes('1009001');
}

function createQingmeiWineError(stage, message, cause) {
  const err = new Error(message || cause?.message || '青梅酿操作失败');
  err.stage = stage;
  err.cause = cause;
  err.qingmeiWine = true;
  return err;
}

function isNoOngoingQingmeiBrewError(err) {
  const message = String(err?.message || err || '');
  return message.includes('1034027') || message.includes('无进行中的酿造记录');
}

async function reportQingmeiShareForDouble() {
  const checkRequest = types.CheckCanShareRequest.encode(
    types.CheckCanShareRequest.create({})
  ).finish();
  const { body: checkBody } = await sendMsgAsync('gamepb.sharepb.ShareService', 'CheckCanShare', checkRequest);
  const checkResult = types.CheckCanShareReply.decode(checkBody);

  if (!checkResult?.can_share) {
    throw new Error('当前不可分享，无法执行青梅酿售卖翻倍');
  }

  const reportRequest = types.ReportShareRequest.encode(
    types.ReportShareRequest.create({ shared: true })
  ).finish();
  const { body: reportBody } = await sendMsgAsync('gamepb.sharepb.ShareService', 'ReportShare', reportRequest);
  const reportResult = types.ReportShareReply.decode(reportBody);

  if (reportResult && Object.hasOwn(reportResult, 'success') && !reportResult.success) {
    throw new Error('青梅酿分享上报失败');
  }

  return {
    canShare: !!checkResult?.can_share,
    shared: true,
    success: reportResult?.success !== false,
  };
}

async function getSeasonInfoRaw() {
  const { body } = await sendMsgAsync('gamepb.seasonpb.SeasonService', 'GetSeasonInfo', Buffer.alloc(0));
  return Buffer.from(body || []);
}

async function claimSeasonRewardsRaw() {
  assertActivityConnection('荷风游记领取');
  const { body } = await sendMsgAsync('gamepb.seasonpb.SeasonService', 'ClaimBattlePassRewards', Buffer.alloc(0));
  return Buffer.from(body || []);
}

async function getSolarTermsRaw() {
  const { body } = await sendMsgAsync('gamepb.solartermspb.SolarTermsService', 'GetSolarTerms', Buffer.alloc(0));
  return Buffer.from(body || []);
}

async function claimSolarTermsRaw(termId) {
  assertActivityConnection('节令小札领取');
  const request = protobuf.Writer.create()
    .uint32((1 << 3) | 0)
    .uint32(Math.max(0, Number(termId) || 0))
    .finish();
  const { body } = await sendMsgAsync('gamepb.solartermspb.SolarTermsService', 'ClaimSolarTerms', request);
  return Buffer.from(body || []);
}

// ---- 商品购买 ----

/**
 * 购买南瓜商店商品
 */
async function buyNanguaShopItem(slotId, defaultCount = 1) {
  const slotIdNum = Number(slotId) || 0;
  if (slotIdNum <= 0) throw new Error('缺少有效的活动商店槽位');

  const shop = await getNanguaShop();
  const slotItems = Array.isArray(shop?.randomShop) ? shop.randomShop : [];
  const slot = slotItems.find((item) => toNum(item?.id) === slotIdNum);

  if (!slot) throw new Error(`活动商店未找到槽位: ${slotIdNum}`);
  if (!slot.purchasable) throw new Error(`活动商店槽位不可购买: ${slot.statusLabel || '不可购买'}`);

  const price = toNum(slot?.price) || Number(defaultCount) || 0;
  if (price <= 0) throw new Error('缺少有效的活动商店价格');

  const remaining = Math.max(0,
    toNum(slot?.remainingCount) ||
    toNum(slot?.stockCount) - toNum(slot?.boughtCount) ||
    0
  );

  try {
    await operateActivity(NANGUA_RANDOM_SHOP_ACTIVITY_ID, NANGUA_SHOP_BUY_CMD, {
      randomShopOperate: { id: slotIdNum, count: remaining },
    });
  } catch (err) {
    throw new Error(
      `活动商店购买失败: activityId=${NANGUA_RANDOM_SHOP_ACTIVITY_ID}, slotId=${slotIdNum}, count=${remaining}, cost=${price}: ${err.message}`
    );
  }

  return getNanguaShop();
}

/**
 * 刷新南瓜商店
 */
async function refreshNanguaShop() {
  const before = await getNanguaShop();
  await operateActivity(NANGUA_RANDOM_SHOP_ACTIVITY_ID, NANGUA_SHOP_REFRESH_CMD);
  const after = await getNanguaShop();

  if (getRandomShopStateSignature(before) === getRandomShopStateSignature(after)) {
    throw new Error('活动商店刷新请求已返回，但商店内容和刷新次数未变化，请检查剩余刷新次数或协议字段');
  }

  return after;
}

// ---- 数据解析 ----

/**
 * 生成随机商店状态签名（用于检测刷新是否生效）
 */
function getRandomShopStateSignature(group) {
  const refresh = group?.randomShopRefresh || {};
  const items = Array.isArray(group?.randomShop) ? group.randomShop : [];
  return JSON.stringify({
    nextRefreshTime: toNum(refresh.nextRefreshTime),
    manualRefreshUsedCount: toNum(refresh.manualRefreshUsedCount),
    items: items.map((it) => [
      toNum(it?.id),
      toNum(it?.itemId),
      toNum(it?.stockCount),
      toNum(it?.boughtCount),
      !!it?.special,
    ]),
  });
}

/**
 * 解析活动 payload（JSON 字符串）
 */
function getField(raw, ...names) {
  if (!raw) return undefined;
  for (const name of names) {
    if (raw[name] !== undefined) return raw[name];
    const numeric = String(name).replace(/^field_/, '');
    if (/^\d+$/.test(numeric) && raw[numeric] !== undefined) return raw[numeric];
  }
  return undefined;
}

function parsePayload(rawPayload) {
  if (!rawPayload) return null;
  if (typeof rawPayload === 'object') return rawPayload;
  if (typeof rawPayload !== 'string') return null;
  const text = rawPayload.trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function decodeItemHex(raw) {
  if (typeof raw !== 'string' || !/^[0-9a-f]+$/i.test(raw) || raw.length < 4) return null;
  try {
    return types.CoreItem ? types.CoreItem.decode(Buffer.from(raw, 'hex')) : null;
  } catch {
    return null;
  }
}

function readProtoFields(rawBytes) {
  const buf = Buffer.from(rawBytes || []);
  const reader = protobuf.Reader.create(buf);
  const entries = [];

  while (reader.pos < reader.len) {
    let tag = 0;
    try {
      tag = reader.uint32();
    } catch {
      break;
    }

    const field = tag >>> 3;
    const wire = tag & 0x7;
    try {
      if (wire === 0) {
        entries.push({ field, wire, value: toNum(reader.uint64()) });
      } else if (wire === 2) {
        entries.push({ field, wire, value: Buffer.from(reader.bytes()) });
      } else if (wire === 5) {
        entries.push({ field, wire, value: reader.uint32() });
      } else if (wire === 1) {
        entries.push({ field, wire, value: reader.fixed64() });
      } else {
        reader.skipType(wire);
      }
    } catch {
      break;
    }
  }

  return entries;
}

function getProtoNumber(entries, field, fallback = 0) {
  const hit = (entries || []).find((entry) => entry.field === field && entry.wire === 0);
  return hit ? toNum(hit.value) : fallback;
}

function getProtoBytes(entries, field) {
  const hit = (entries || []).find((entry) => entry.field === field && entry.wire === 2);
  return hit ? Buffer.from(hit.value || []) : null;
}

function getProtoBytesAll(entries, field) {
  return (entries || [])
    .filter((entry) => entry.field === field && entry.wire === 2)
    .map((entry) => Buffer.from(entry.value || []));
}

function getProtoString(entries, field, fallback = '') {
  const bytes = getProtoBytes(entries, field);
  if (!bytes || bytes.length === 0) return fallback;
  try {
    return bytes.toString('utf8');
  } catch {
    return fallback;
  }
}

function parseActivityItemMessage(rawBytes) {
  const entries = readProtoFields(rawBytes);
  const itemId = getProtoNumber(entries, 1);
  const count = Math.max(0, getProtoNumber(entries, 2) || 1);
  if (itemId <= 0) return null;

  const info = getItemById(itemId);
  return {
    itemId,
    itemCount: count,
    count,
    itemName: (info && info.name) || `物品${itemId}`,
    name: (info && info.name) || `物品${itemId}`,
    image: getItemImageById(itemId) || '',
  };
}

function getSubActivityKey(activity) {
  const id = toNum(activity?.id);
  const title = String(activity?.title || '');
  if (id === HELU_DRAW_ACTIVITY_ID) return HELU_SUB_ACTIVITY_KEYS.giftLotus;
  if (id === HELU_EXCHANGE_ACTIVITY_ID) return HELU_SUB_ACTIVITY_KEYS.shop;
  if (id === HELU_JOURNEY_ACTIVITY_ID) return HELU_SUB_ACTIVITY_KEYS.journey;
  if (id === HELU_NOTES_ACTIVITY_ID) return HELU_SUB_ACTIVITY_KEYS.notes;
  if (/奇遇礼莲/.test(title)) return HELU_SUB_ACTIVITY_KEYS.giftLotus;
  if (/荷露商店/.test(title)) return HELU_SUB_ACTIVITY_KEYS.shop;
  if (/荷风游记/.test(title)) return HELU_SUB_ACTIVITY_KEYS.journey;
  if (/节令小札/.test(title)) return HELU_SUB_ACTIVITY_KEYS.notes;
  return '';
}

function summarizeActivityPayload(payload) {
  if (!payload || typeof payload !== 'object') return [];
  return Object.entries(payload)
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .slice(0, 8)
    .map(([key, value]) => ({
      key,
      value: typeof value === 'object' ? JSON.stringify(value) : String(value),
    }));
}

function normalizeHeluSubActivities(activities) {
  const byKey = new Map();
  for (const activity of activities || []) {
    const key = getSubActivityKey(activity);
    if (!key || byKey.has(key)) continue;
    const payload = parsePayload(activity?.payload);
    byKey.set(key, {
      key,
      id: toNum(activity?.id),
      parentId: toNum(activity?.parent_id ?? activity?.parentId),
      title: String(activity?.title || ''),
      type: toNum(activity?.type),
      sort: toNum(activity?.sort),
      status: toNum(activity?.status),
      visible: activity?.visible !== false,
      enabled: activity?.enabled !== false,
      startTime: toNum(activity?.start_time ?? activity?.startTime),
      endTime: toNum(activity?.end_time ?? activity?.endTime),
      payload,
      payloadSummary: summarizeActivityPayload(payload),
      hasDraw: !!(activity?.draw_info || activity?.drawInfo),
      hasExchangeShop: !!(activity?.exchange_shop || activity?.exchangeShop),
      source: 'activity_tree',
    });
  }

  return HELU_SUB_ACTIVITY_DEFS.map((def) => {
    const found = byKey.get(def.key);
    return {
      ...def,
      id: found?.id || 0,
      parentId: found?.parentId || 0,
      type: found?.type || 0,
      sort: found?.sort || 0,
      status: found?.status || 0,
      visible: found?.visible ?? true,
      enabled: found?.enabled ?? true,
      startTime: found?.startTime || 0,
      endTime: found?.endTime || 0,
      payload: found?.payload || null,
      payloadSummary: found?.payloadSummary || [],
      hasDraw: found?.hasDraw || def.key === HELU_SUB_ACTIVITY_KEYS.giftLotus,
      hasExchangeShop: found?.hasExchangeShop || def.key === HELU_SUB_ACTIVITY_KEYS.shop,
      available: !!found || def.key === HELU_SUB_ACTIVITY_KEYS.giftLotus || def.key === HELU_SUB_ACTIVITY_KEYS.shop,
      source: found?.source || 'configured',
    };
  });
}

/**
 * 标准化活动物品
 */
function normalizeActivityItem(raw) {
  if (!raw) return null;
  const decoded = decodeItemHex(raw) || raw;
  const itemId = toNum(getField(decoded, 'id', 'field_1', 1));
  const count = Math.max(0, toNum(getField(decoded, 'count', 'field_2', 2)) || 1);
  if (itemId <= 0) return null;

  const info = getItemById(itemId);
  const image = getItemImageById(itemId) || '';

  return {
    itemId,
    count,
    name: (info && info.name) || `物品${itemId}`,
    image,
  };
}

function normalizeDrawPoolItem(raw) {
  const item = normalizeActivityItem(getField(raw, 'item', 'field_3', 3));
  if (!item) return null;
  return {
    id: toNum(getField(raw, 'id', 'field_1', 1)),
    rarity: toNum(getField(raw, 'rarity', 'field_2', 2)),
    itemId: item.itemId,
    itemCount: item.count,
    itemName: item.name,
    image: item.image || '',
    probability: String(getField(raw, 'probability', 'field_6', 6) || ''),
  };
}

function normalizeDrawReward(raw) {
  const item = normalizeActivityItem(getField(raw, 'item', 'field_2', 2));
  if (!item) return null;
  return {
    slotId: toNum(getField(raw, 'slot_id', 'slotId', 'field_1', 1)),
    rarityFlag: toNum(getField(raw, 'flag', 'field_4', 4)),
    itemId: item.itemId,
    itemCount: item.count,
    itemName: item.name,
    image: item.image || '',
  };
}

function normalizeDrawInfo(raw) {
  if (!raw) return null;

  const freeMax = toNum(getField(raw, 'max_free_count', 'maxFreeCount', 'field_2', 2)) || 4;
  const paidMax = toNum(getField(raw, 'max_paid_count', 'maxPaidCount', 'field_4', 4)) || 4;
  const freeRemainingRaw = getField(raw, 'free_remaining_count', 'freeRemainingCount', 'field_1', 1);
  const paidRemainingRaw = getField(raw, 'paid_remaining_count', 'paidRemainingCount', 'free_used_count', 'freeUsedCount', 'field_3', 3);
  const hasFreeRemaining = freeRemainingRaw !== undefined;
  const hasPaidRemaining = paidRemainingRaw !== undefined;
  const freeRemaining = Math.max(0, Math.min(freeMax,
    hasFreeRemaining ? toNum(freeRemainingRaw) : hasPaidRemaining ? 0 : freeMax
  ));
  // 抓包显示：field_3 是点券剩余次数；点券 4 次全部用完后 field_3 会直接省略。
  // 初始配置也会省略 field_3，但此时免费次数未用完，所以仍应展示点券上限。
  const paidRemaining = Math.max(0, Math.min(paidMax,
    hasPaidRemaining ? toNum(paidRemainingRaw) : freeRemaining <= 0 ? 0 : paidMax
  ));
  const freeUsed = Math.max(0, freeMax - freeRemaining);
  const paidUsed = Math.max(0, paidMax - paidRemaining);
  const paidCurrencyId = toNum(getField(raw, 'paid_currency_id', 'paidCurrencyId', 'field_5', 5)) || 1002;
  const paidPrice = toNum(getField(raw, 'paid_price', 'paidPrice', 'field_6', 6)) || 30;
  const fallbackPrice = toNum(getField(raw, 'fallback_price', 'fallbackPrice', 'field_7', 7)) || paidPrice;
  const rewardPoolRaw = getField(raw, 'rewards', 'field_8', 8);
  const rewardPool = (Array.isArray(rewardPoolRaw) ? rewardPoolRaw : [])
    .map(normalizeDrawPoolItem)
    .filter(Boolean);

  return {
    freeMax,
    freeUsed,
    freeRemaining,
    paidMax,
    paidUsed,
    paidRemaining,
    paidCurrencyId,
    paidPrice,
    fallbackPrice,
    rewardPool,
    _hasFreeRemaining: hasFreeRemaining,
    _hasPaidRemaining: hasPaidRemaining,
  };
}

function normalizeDrawResult(raw) {
  if (!raw) return null;
  const rewardsRaw = getField(raw, 'rewards', 'field_1', 1);
  const itemsRaw = getField(raw, 'items', 'field_2', 2);
  const costRaw = getField(raw, 'cost', 'field_3', 3);
  return {
    rewards: (Array.isArray(rewardsRaw) ? rewardsRaw : [])
      .map(normalizeDrawReward)
      .filter(Boolean),
    items: (Array.isArray(itemsRaw) ? itemsRaw : [])
      .map(normalizeActivityItem)
      .filter(Boolean),
    cost: normalizeActivityItem(costRaw),
  };
}

/**
 * 标准化随机商店单品
 */
function normalizeRandomShopItem(raw) {
  const item = normalizeActivityItem(raw?.item);
  const cost = normalizeActivityItem(raw?.cost);
  if (!item) return null;

  const name = String(raw?.name || item.name || '').trim() || item.name;
  const stockCount = toNum(raw?.stock_count ?? raw?.stockCount ?? raw?.limit_count ?? raw?.limitCount);
  const boughtCount = toNum(raw?.bought_count ?? raw?.boughtCount);
  const hasStock = stockCount > 0;
  const isSpecial = !!raw?.special;
  const noStock = !isSpecial;
  const soldOut = isSpecial && hasStock && boughtCount >= stockCount;
  const purchasable = isSpecial && hasStock && !soldOut;
  const remainingCount = purchasable ? Math.max(0, stockCount - boughtCount) : 0;

  return {
    id: toNum(raw?.id),
    name,
    itemId: item.itemId,
    itemCount: item.count,
    itemName: item.name,
    image: item.image || '',
    currencyId: cost?.itemId || 1001,
    price: cost?.count || 0,
    priceUnitId: cost?.itemId || 1001,
    stockCount,
    boughtCount,
    remainingCount,
    special: !!raw?.special,
    stockStatus: noStock ? 'no_stock' : soldOut ? 'sold_out' : 'available',
    noStock,
    soldOut,
    purchasable,
    statusLabel: noStock ? '无库存' : soldOut ? '售罄' : purchasable ? '可购买' : '不可购买',
    source: 'random',
  };
}

/**
 * 标准化随机商店信息
 */
function normalizeRandomShopInfo(raw) {
  if (!raw) return null;

  const items = (Array.isArray(raw?.items) ? raw.items : [])
    .map(normalizeRandomShopItem)
    .filter(Boolean);

  return {
    items,
    nextRefreshTime: toNum(raw?.next_refresh_time ?? raw?.nextRefreshTime),
    manualRefreshCost: toNum(raw?.manual_refresh_cost ?? raw?.manualRefreshCost),
    manualRefreshCurrencyId: toNum(raw?.manual_refresh_currency_id ?? raw?.manualRefreshCurrencyId),
    manualRefreshExtraValue: toNum(
      raw?.manual_refresh_extra_value ??
      raw?.manualRefreshExtraValue ??
      raw?.fallback_refresh_cost ??
      raw?.fallbackRefreshCost ??
      raw?.manual_refresh_count ??
      raw?.manualRefreshCount ??
      0
    ),
    maxManualRefreshCount: 6,
    manualRefreshUsedCount: toNum(raw?.manual_refresh_used_count ?? raw?.manualRefreshUsedCount),
  };
}

/**
 * 标准化兑换商店单品
 */
function normalizeExchangeShopItem(raw) {
  if (!raw) return null;

  const item = normalizeActivityItem(raw?.item);
  const cost = normalizeActivityItem(raw?.cost);
  if (!item) return null;

  const itemInfo = getItemById(item.itemId) || {};
  const itemType = toNum(itemInfo.type);
  const interactionType = String(itemInfo.interaction_type || itemInfo.interactionType || '');
  const name = String(raw?.name || item.name || '').trim() || item.name;
  const status = toNum(raw?.status);
  const owned = raw?.owned === true;
  const isRepeatable = itemType === 7 || interactionType === 'fertilizer' || interactionType === 'fertilizerpro';
  const exchangeLimit = isRepeatable && status > 1 ? status : 0;
  const ownedBlocksExchange = owned && !isRepeatable;
  const isDecoration = itemType === 18
    || /装扮/.test(String(itemInfo.desc || ''))
    || /装扮/.test(String(itemInfo.effectDesc || ''))
    || /(?:小屋|街道|狗屋|木牌|仓库|栅栏|围栏|头像框)$/.test(name)
    || name.startsWith('枕水听荷');

  return {
    id: toNum(raw?.id),
    sort: toNum(raw?.sort),
    status,
    owned,
    isRepeatable,
    exchangeLimit,
    ownedBlocksExchange,
    statusLabel: ownedBlocksExchange
      ? '已拥有'
      : status === 1 || exchangeLimit > 0
        ? '可兑换'
        : status === 5
          ? '特殊商品'
          : status === 120 || status === 130
            ? '可兑换'
            : `状态${status}`,
    name,
    itemId: item.itemId,
    itemCount: item.count,
    itemName: item.name,
    image: item.image || '',
    itemType,
    itemTypeLabel: isDecoration ? '装扮' : itemType === 7 ? '道具' : `类型${itemType || 0}`,
    isDecoration,
    currencyId: cost?.itemId || 0,
    currencyName: cost?.name || '',
    price: cost?.count || 0,
    desc: String(getItemById(item.itemId)?.desc || getItemById(item.itemId)?.effectDesc || ''),
    extra: String(raw?.extra || ''),
  };
}

// ---- 活动树遍历 ----

function flattenActivityNode(node, result = []) {
  if (!node) return result;
  if (node.activity) {
    if (!node.activity.random_shop && node.random_shop) node.activity.random_shop = node.random_shop;
    if (!node.activity.exchange_shop && node.exchange_shop) node.activity.exchange_shop = node.exchange_shop;
    if (!node.activity.draw_info && node.draw_info) node.activity.draw_info = node.draw_info;
    result.push(node.activity);
  }
  for (const child of Array.isArray(node.children) ? node.children : []) {
    flattenActivityNode(child, result);
  }
  return result;
}

function flattenActivityChildren(reply) {
  const list = flattenActivityNode(reply?.group, []);
  if (Array.isArray(reply?.activities)) list.push(...reply.activities);
  return list.filter(Boolean);
}

// ---- 原始 Protobuf 扫描（回退方案） ----

function skipUnknown(reader, wireType) {
  try {
    reader.skipType(wireType);
  } catch {
    reader.pos = reader.len;
  }
}

/**
 * 扫描长度分隔字段
 */
function scanLengthDelimitedFields(rawBytes, targetFieldNum, maxDepth = 3, results = []) {
  const buf = Buffer.from(rawBytes || []);
  if (buf.length === 0 || maxDepth <= 0) return results;

  const reader = protobuf.Reader.create(buf);
  while (reader.pos < reader.len) {
    let tag = 0;
    try {
      tag = reader.uint32();
    } catch {
      break;
    }
    const fieldNum = tag >>> 3;
    const wireType = tag & 0x7;

    if (wireType === 2) {
      let bytes = null;
      try {
        bytes = reader.bytes();
      } catch {
        break;
      }
      if (fieldNum === targetFieldNum) results.push(Buffer.from(bytes));
      scanLengthDelimitedFields(bytes, targetFieldNum, maxDepth - 1, results);
      continue;
    }

    skipUnknown(reader, wireType);
  }
  return results;
}

/**
 * 从原始 body 中扫描随机商店信息
 */
function scanRandomShopInfoFromRawBody(rawBody) {
  if (!rawBody || rawBody.length === 0) return null;

  const RandomShopInfo = types.ActivityRandomShopInfo;
  if (!RandomShopInfo) return null;

  let best = null;
  const seen = new Set();

  for (const chunk of scanLengthDelimitedFields(rawBody, 7)) {
    try {
      const decoded = RandomShopInfo.decode(chunk);
      const normalized = normalizeRandomShopInfo(decoded);
      if (!normalized || normalized.items.length === 0) continue;

      const deduped = [];
      for (const item of normalized.items) {
        if (!item) continue;
        const key = `${item.id}:${item.itemId}:${item.price}`;
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(item);
      }

      normalized.items = deduped;

      if (!best || normalized.items.length > best.items.length) {
        best = normalized;
      }
    } catch {
      // 跳过解码失败的块
    }
  }

  return best;
}

/**
 * 从原始 body 中扫描兑换商店信息
 */
function scanExchangeShopInfoFromRawBody(rawBody) {
  if (!rawBody || rawBody.length === 0) return null;

  const ExchangeShopInfo = types.ActivityExchangeShopInfo;
  if (!ExchangeShopInfo) return null;

  let best = null;
  const seen = new Set();

  for (const chunk of scanLengthDelimitedFields(rawBody, 102)) {
    try {
      const decoded = ExchangeShopInfo.decode(chunk);
      const items = (Array.isArray(decoded?.items) ? decoded.items : [])
        .map(normalizeExchangeShopItem)
        .filter(Boolean);
      if (items.length === 0) continue;

      const deduped = [];
      for (const item of items) {
        const key = `${item.id}:${item.itemId}:${item.currencyId}:${item.price}`;
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(item);
      }

      const normalized = {
        items: deduped.sort((a, b) => {
          if (a.sort !== b.sort) return a.sort - b.sort;
          return a.id - b.id;
        }),
      };

      if (!best || normalized.items.length > best.items.length) best = normalized;
    } catch {
      // skip
    }
  }

  return best;
}

function scanDrawInfoFromRawBody(rawBody) {
  if (!rawBody || rawBody.length === 0) return null;

  const DrawInfo = types.ActivityDrawInfo;
  if (!DrawInfo) return null;

  let best = null;
  for (const chunk of scanLengthDelimitedFields(rawBody, 105)) {
    try {
      const decoded = DrawInfo.decode(chunk);
      const normalized = normalizeDrawInfo(decoded);
      if (!normalized || normalized.rewardPool.length === 0) continue;
      if (!best || normalized.rewardPool.length > best.rewardPool.length) best = normalized;
    } catch {
      // skip
    }
  }
  return best;
}

function getHeluActivityUidCandidates() {
  return [HELU_ACTIVITY_UID, 'SAIJI_DRAW', 'SaiJi', 'HeLu', 'Helu', ''];
}

async function getActivityGroupWithUidFallback(activityId, uidCandidates) {
  let lastErr = null;
  for (const uid of uidCandidates) {
    try {
      const reply = await getActivityGroup(activityId, uid);
      const activities = flattenActivityChildren(reply);
      if (activities.length > 0) {
        Object.defineProperty(reply, '__activityUid', {
          value: uid,
          enumerable: false,
          configurable: true,
        });
        return reply;
      }
    } catch (err) {
      lastErr = err;
    }
  }
  if (lastErr) throw lastErr;
  return getActivityGroup(activityId, uidCandidates[0]);
}

async function getHeluBalance() {
  try {
    const bag = await getBag();
    const items = getBagItems(bag);
    for (const item of items || []) {
      if (toNum(item?.id) === HELU_CURRENCY_ITEM_ID) {
        return Math.max(0, toNum(item?.count));
      }
    }
  } catch {
    // ignore
  }
  return 0;
}

async function getBagItemCount(itemId) {
  try {
    const bag = await getBag();
    return (getBagItems(bag) || [])
      .filter(entry => toNum(entry?.id) === toNum(itemId))
      .reduce((sum, item) => sum + Math.max(0, toNum(item?.count)), 0);
  } catch {
    return 0;
  }
}

async function getQingmeiWineMaterialItems() {
  const bag = await getBag();
  return (getBagItems(bag) || [])
    .map(item => ({
      id: toNum(item?.id),
      uid: toNum(item?.uid),
      count: Math.max(0, toNum(item?.count)),
      mutantType: Array.isArray(item?.mutant_types) && item.mutant_types.length
        ? Math.min(...item.mutant_types.map(toNum).filter(value => value > 0))
        : 0,
    }))
    .filter(item => item.id === QINGMEI_FRUIT_ITEM_ID && item.uid > 0 && item.count > 0)
    .sort((a, b) => {
      const aOrder = a.mutantType > 0 ? a.mutantType : Number.MAX_SAFE_INTEGER;
      const bOrder = b.mutantType > 0 ? b.mutantType : Number.MAX_SAFE_INTEGER;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return a.uid - b.uid;
    })
    .map(item => ({
      id: item.uid,
      count: item.count,
    }));
}

function normalizeQingmeiActivity(reply) {
  const activities = flattenActivityChildren(reply);
  const root = reply?.group?.activity || activities.find(item => toNum(item?.id) === QINGMEI_ACTIVITY_ID) || {};
  const claim = activities.find(item => toNum(item?.id) === QINGMEI_SEED_CLAIM_ACTIVITY_ID) || {};
  const wine = activities.find(item => toNum(item?.id) === QINGMEI_WINE_ACTIVITY_ID) || {};
  const status = toNum(claim?.status);
  const claimedToday = isQingmeiClaimedToday();
  const materialInfo = getItemById(QINGMEI_FRUIT_ITEM_ID);

  return {
    uid: reply?.__activityUid || QINGMEI_ACTIVITY_UID,
    title: '青梅酿万金',
    activityId: toNum(root?.id) || QINGMEI_ACTIVITY_ID,
    claimActivityId: toNum(claim?.id) || QINGMEI_SEED_CLAIM_ACTIVITY_ID,
    claimCommand: QINGMEI_SEED_CLAIM_CMD,
    wineActivityId: toNum(wine?.id) || QINGMEI_WINE_ACTIVITY_ID,
    wineTitle: wine?.title || '青酿换万金',
    winePreviewCommand: QINGMEI_WINE_PREVIEW_CMD,
    wineBrewCommand: QINGMEI_WINE_BREW_CMD,
    wineSellCommand: QINGMEI_WINE_SELL_CMD,
    startTime: toNum(root?.start_time ?? root?.startTime ?? claim?.start_time ?? claim?.startTime),
    endTime: toNum(root?.end_time ?? root?.endTime ?? claim?.end_time ?? claim?.endTime),
    status,
    claimed: claimedToday || status === 3,
    claimable: !claimedToday && status !== 3 && claim?.enabled !== false,
    reward: {
      itemId: QINGMEI_SEED_ITEM_ID,
      itemCount: QINGMEI_SEED_REWARD_COUNT,
      itemName: getItemById(QINGMEI_SEED_ITEM_ID)?.name || '青梅种子',
      image: getItemImageById(QINGMEI_SEED_ITEM_ID) || '',
    },
    material: {
      itemId: QINGMEI_FRUIT_ITEM_ID,
      itemCount: 0,
      itemName: materialInfo?.name || '青梅',
      image: getItemImageById(QINGMEI_FRUIT_ITEM_ID) || '',
    },
    payload: parsePayload(root?.payload || wine?.payload || claim?.payload),
  };
}

async function getQingmeiActivity() {
  try {
    const reply = await getActivityGroupWithUidFallback(QINGMEI_ACTIVITY_ID, [QINGMEI_ACTIVITY_UID, '']);
    const activity = normalizeQingmeiActivity(reply);
    activity.material.itemCount = await getBagItemCount(QINGMEI_FRUIT_ITEM_ID);
    return activity;
  } catch (err) {
    const materialInfo = getItemById(QINGMEI_FRUIT_ITEM_ID);
    return {
      uid: QINGMEI_ACTIVITY_UID,
      title: '青梅酿万金',
      activityId: QINGMEI_ACTIVITY_ID,
      claimActivityId: QINGMEI_SEED_CLAIM_ACTIVITY_ID,
      claimCommand: QINGMEI_SEED_CLAIM_CMD,
      wineActivityId: QINGMEI_WINE_ACTIVITY_ID,
      wineTitle: '青酿换万金',
      winePreviewCommand: QINGMEI_WINE_PREVIEW_CMD,
      wineBrewCommand: QINGMEI_WINE_BREW_CMD,
      wineSellCommand: QINGMEI_WINE_SELL_CMD,
      claimed: false,
      claimable: false,
      reward: {
        itemId: QINGMEI_SEED_ITEM_ID,
        itemCount: QINGMEI_SEED_REWARD_COUNT,
        itemName: getItemById(QINGMEI_SEED_ITEM_ID)?.name || '青梅种子',
        image: getItemImageById(QINGMEI_SEED_ITEM_ID) || '',
      },
      material: {
        itemId: QINGMEI_FRUIT_ITEM_ID,
        itemCount: await getBagItemCount(QINGMEI_FRUIT_ITEM_ID),
        itemName: materialInfo?.name || '青梅',
        image: getItemImageById(QINGMEI_FRUIT_ITEM_ID) || '',
      },
      warning: err?.message || String(err),
    };
  }
}

async function claimQingmeiSeeds() {
  const beforeCount = await getBagItemCount(QINGMEI_SEED_ITEM_ID);
  let reply = null;
  try {
    reply = await operateActivityReply(QINGMEI_SEED_CLAIM_ACTIVITY_ID, QINGMEI_SEED_CLAIM_CMD, {
      qingmeiClaim: { type: 2 },
    });
  } catch (err) {
    if (isAlreadyClaimedError(err)) {
      markQingmeiClaimedToday();
      return {
        ok: true,
        alreadyClaimed: true,
        claimedCount: 0,
        beforeCount,
        afterCount: beforeCount,
        qingmei: await getQingmeiActivity(),
      };
    }
    throw err;
  }

  const claimResult = normalizeQingmeiClaimResult(reply?.qingmei_claim);
  await delay(HELU_DRAW_REFRESH_DELAY_MS);
  const afterCount = await getBagItemCount(QINGMEI_SEED_ITEM_ID);
  const claimedCount = claimResult.claimedCount || Math.max(0, afterCount - beforeCount);
  if (claimedCount <= 0) {
    throw new Error('领取青梅种子失败: 服务端未返回奖励，背包数量也未增加');
  }
  if (claimedCount > 0) markQingmeiClaimedToday();

  activityLogger.info('领取青梅种子完成', {
    event: 'qingmei_seed_claim',
    itemId: QINGMEI_SEED_ITEM_ID,
    beforeCount,
    afterCount,
    claimedCount,
    rewardItems: claimResult.items,
  });

  return {
    ok: true,
    claimedCount,
    beforeCount,
    afterCount,
    rewards: claimResult.items,
    qingmei: await getQingmeiActivity(),
  };
}

async function brewAndSellQingmeiWine(options = {}) {
  const share = options?.share !== false;
  const brewSteps = Math.max(1, Number(options?.brewSteps) || QINGMEI_FINE_BREW_STEPS);
  const materialItems = await getQingmeiWineMaterialItems();
  const beforeMaterialCount = materialItems.reduce((sum, item) => sum + Math.max(0, toNum(item?.count)), 0);
  if (beforeMaterialCount <= 0) {
    throw createQingmeiWineError('material', '青梅不足，无法精酿');
  }

  let previewReply = null;
  let previewWarning = '';
  try {
    previewReply = await operateActivityReply(QINGMEI_WINE_ACTIVITY_ID, QINGMEI_WINE_PREVIEW_CMD, {
      qingmeiWineStart: { items: materialItems },
    });
  } catch (err) {
    previewWarning = `打开青梅酿售卖失败，已尝试直接精酿: ${err.message}`;
  }
  const preview = normalizeQingmeiPreviewResult(previewReply?.qingmei_preview);
  await delay(QINGMEI_WINE_STEP_DELAY_MS);

  const brews = [];
  for (let index = 0; index < brewSteps; index += 1) {
    let brewReply = null;
    try {
      brewReply = await operateActivityReply(QINGMEI_WINE_ACTIVITY_ID, QINGMEI_WINE_BREW_CMD, {
        qingmeiWineBrew: true,
      });
    } catch (err) {
      if (index === 0 && isNoOngoingQingmeiBrewError(err)) {
        try {
          const retryMaterialItems = await getQingmeiWineMaterialItems();
          previewReply = await operateActivityReply(QINGMEI_WINE_ACTIVITY_ID, QINGMEI_WINE_PREVIEW_CMD, {
            qingmeiWineStart: { items: retryMaterialItems },
          });
          await delay(QINGMEI_WINE_STEP_DELAY_MS);
          brewReply = await operateActivityReply(QINGMEI_WINE_ACTIVITY_ID, QINGMEI_WINE_BREW_CMD, {
            qingmeiWineBrew: true,
          });
        } catch (retryErr) {
          throw createQingmeiWineError('brew', `青梅酿精酿失败: ${retryErr.message}`, retryErr);
        }
      } else {
        throw createQingmeiWineError('brew', `青梅酿精酿失败: ${err.message}`, err);
      }
    }
    const brew = normalizeQingmeiBrewResult(brewReply?.qingmei_brew);
    if (brew) brews.push(brew);
    await delay(QINGMEI_WINE_STEP_DELAY_MS);
  }

  const finalBrew = brews[brews.length - 1] || null;
  if (!finalBrew) {
    throw createQingmeiWineError('brew', beforeMaterialCount <= 0
      ? '青梅不足，无法精酿'
      : '精酿未返回有效结果，请稍后重试');
  }

  let shareResult = { canShare: false, shared: false, success: false };
  if (share && finalBrew?.canDouble) {
    try {
      shareResult = await reportQingmeiShareForDouble();
    } catch (err) {
      throw createQingmeiWineError('share', `青梅酿分享翻倍失败: ${err.message}`, err);
    }
    await delay(HELU_DRAW_REFRESH_DELAY_MS);
  }

  let sellReply = null;
  const sellMultiple = shareResult.shared ? 2 : 1;
  try {
    sellReply = await operateActivityReply(QINGMEI_WINE_ACTIVITY_ID, QINGMEI_WINE_SELL_CMD, {
      qingmeiWineSell: { multiple: sellMultiple },
    });
  } catch (err) {
    throw createQingmeiWineError('sell', `青梅酿售卖失败: ${err.message}`, err);
  }
  const sell = normalizeQingmeiSellResult(sellReply?.qingmei_sell);
  if (!sell || sell.gold <= 0) {
    throw createQingmeiWineError('sell', '售卖未返回金币收益，请稍后刷新活动状态');
  }
  await delay(HELU_DRAW_REFRESH_DELAY_MS);
  const afterMaterialCount = await getBagItemCount(QINGMEI_FRUIT_ITEM_ID);

  activityLogger.info('青梅酿售卖完成', {
    event: 'qingmei_wine_sell',
    beforeMaterialCount,
    afterMaterialCount,
    materialBatchCount: materialItems.length,
    brewSteps: brews.length,
    wineType: finalBrew?.wineType,
    price: finalBrew?.price,
    shared: shareResult.shared,
    sellMultiple,
    gold: sell?.gold,
  });

  return {
    ok: true,
    beforeMaterialCount,
    afterMaterialCount,
    consumedCount: Math.max(0, beforeMaterialCount - afterMaterialCount),
    materialBatchCount: materialItems.length,
    preview,
    previewWarning,
    brews,
    brew: finalBrew,
    share: shareResult,
    sell,
    activity: await getHeluActivity().catch(() => null),
  };
}

function computeHeluDrawActions(drawInfo) {
  const freeRemaining = Math.max(0, toNum(drawInfo?.freeRemaining));
  const paidRemaining = Math.max(0, toNum(drawInfo?.paidRemaining));
  const paidPrice = Math.max(0, toNum(drawInfo?.paidPrice));
  const paidCurrencyId = toNum(drawInfo?.paidCurrencyId) || 1002;

  const drawOneIsFree = freeRemaining > 0;
  const drawOnePaid = !drawOneIsFree && paidRemaining > 0;
  const drawOneCount = drawOneIsFree || drawOnePaid ? 1 : 0;

  let batchCount = 0;
  let batchCost = 0;
  let batchType = 'none';
  if (freeRemaining > 0) {
    batchCount = Math.min(4, freeRemaining);
    batchType = 'free';
  } else if (paidRemaining > 0) {
    batchCount = Math.min(4, paidRemaining);
    batchCost = batchCount * paidPrice;
    batchType = 'paid';
  }

  return {
    one: {
      count: drawOneCount,
      available: drawOneCount > 0,
      cost: drawOnePaid ? paidPrice : 0,
      currencyId: drawOnePaid ? paidCurrencyId : 0,
      type: drawOneIsFree ? 'free' : drawOnePaid ? 'paid' : 'none',
      label: drawOneIsFree ? '免费1次' : drawOnePaid ? `${paidPrice}点券1次` : '已抽完',
    },
    batch: {
      count: batchCount,
      available: batchCount > 0,
      cost: batchCost,
      currencyId: batchType === 'paid' ? paidCurrencyId : 0,
      type: batchType,
      label: batchType === 'free'
        ? `免费${batchCount}次`
        : batchType === 'paid'
          ? `${batchCost}点券${batchCount}次`
          : '已抽完',
    },
  };
}

function normalizeSeasonRewardTier(rawBytes) {
  const entries = readProtoFields(rawBytes);
  return {
    level: getProtoNumber(entries, 1),
    freeRewards: getProtoBytesAll(entries, 2).map(parseActivityItemMessage).filter(Boolean),
    premiumRewards: getProtoBytesAll(entries, 3).map(parseActivityItemMessage).filter(Boolean),
  };
}

function normalizeSeasonPassport(rawBytes, rewardItems = []) {
  const entries = readProtoFields(rawBytes);
  const currentLevel = getProtoNumber(entries, 2);
  const score = getProtoNumber(entries, 3);
  const currentProgress = getProtoNumber(entries, 4);
  const nextLevelNeed = getProtoNumber(entries, 5);
  const maxLevel = getProtoNumber(entries, 6);
  const freeClaimedLevel = getProtoNumber(entries, 9);
  const premiumClaimedLevel = getProtoNumber(entries, 11);
  const levelRewardTiers = getProtoBytesAll(entries, 8)
    .map(normalizeSeasonRewardTier)
    .filter((tier) => tier.level > 0);

  return {
    uid: HELU_PASSPORT_UID,
    title: getProtoString(entries, 16, '荷风游记'),
    activityId: getProtoNumber(entries, 1) || HELU_ACTIVITY_ID,
    currentLevel,
    score,
    currentProgress,
    nextLevelNeed,
    maxLevel,
    freeClaimedLevel,
    premiumClaimedLevel,
    claimableLevels: Math.max(0, currentLevel - freeClaimedLevel),
    rewardTierCount: levelRewardTiers.length,
    levelRewardTiers,
    rewards: rewardItems,
    configText: getProtoString(entries, 17, ''),
  };
}

function normalizeSeasonInfo(rawBody) {
  const replyEntries = readProtoFields(rawBody);
  const seasonBytes = getProtoBytes(replyEntries, 1);
  if (!seasonBytes) {
    return {
      uid: HELU_PASSPORT_UID,
      title: '荷风游记',
      currentLevel: 0,
      claimableLevels: 0,
      rewards: [],
      levelRewardTiers: [],
    };
  }

  const seasonEntries = readProtoFields(seasonBytes);
  const passportBytes = getProtoBytes(seasonEntries, 10);
  const passport = normalizeSeasonPassport(passportBytes, []);

  return {
    ...passport,
    seasonTitle: getProtoString(seasonEntries, 2, HELU_TITLE),
    seasonStatus: getProtoNumber(seasonEntries, 3),
    startTime: getProtoNumber(seasonEntries, 5),
    endTime: getProtoNumber(seasonEntries, 6),
    nowTime: getProtoNumber(seasonEntries, 7),
  };
}

function normalizeSeasonClaimResult(rawBody) {
  const entries = readProtoFields(rawBody);
  const rewards = getProtoBytesAll(entries, 1).map(parseActivityItemMessage).filter(Boolean);
  const passportBytes = getProtoBytes(entries, 3);
  return {
    rewards,
    passport: passportBytes ? normalizeSeasonPassport(passportBytes, rewards) : null,
  };
}

function solarStatusLabel(status) {
  if (status === 2) return '可领取';
  if (status === 3) return '已领取';
  if (status === 1) return '未开启';
  if (status === 5) return '已结束';
  return `状态${status}`;
}

function normalizeSolarTerm(rawBytes) {
  const entries = readProtoFields(rawBytes);
  const status = getProtoNumber(entries, 2);
  return {
    id: getProtoNumber(entries, 1),
    status,
    statusLabel: solarStatusLabel(status),
    claimable: status === 2,
    startTime: getProtoNumber(entries, 3),
    endTime: getProtoNumber(entries, 4),
    rewards: getProtoBytesAll(entries, 5).map(parseActivityItemMessage).filter(Boolean),
    title: getProtoString(entries, 6, ''),
  };
}

function normalizeSolarTermsInfo(rawBody) {
  const entries = readProtoFields(rawBody);
  const terms = getProtoBytesAll(entries, 1)
    .map(normalizeSolarTerm)
    .filter((term) => term.id > 0);
  const configEntries = readProtoFields(getProtoBytes(entries, 3));

  return {
    nowTime: getProtoNumber(entries, 2),
    terms,
    claimableCount: terms.filter((term) => term.claimable).length,
    currentTerm: terms.find((term) => term.claimable) || terms.find((term) => term.status === 3) || terms[0] || null,
    tipsText: getProtoString(configEntries, 3, ''),
  };
}

function normalizeSolarTermsClaimResult(rawBody) {
  const entries = readProtoFields(rawBody);
  const termBytes = getProtoBytes(entries, 2);
  return {
    rewards: getProtoBytesAll(entries, 1).map(parseActivityItemMessage).filter(Boolean),
    term: termBytes ? normalizeSolarTerm(termBytes) : null,
  };
}

async function getSeasonPassport() {
  return normalizeSeasonInfo(await getSeasonInfoRaw());
}

async function claimSeasonPassportRewards() {
  const before = await getSeasonPassport();
  const result = normalizeSeasonClaimResult(await claimSeasonRewardsRaw());
  const after = await getSeasonPassport();

  activityLogger.info('荷风游记领取成功', {
    event: 'season_passport_claim',
    beforeLevel: before.currentLevel,
    beforeClaimedLevel: before.freeClaimedLevel,
    afterLevel: after.currentLevel,
    afterClaimedLevel: after.freeClaimedLevel,
    rewardCount: result.rewards.length,
  });

  return {
    ok: true,
    rewards: result.rewards,
    passport: after,
    claimedLevels: Math.max(0, after.freeClaimedLevel - before.freeClaimedLevel),
  };
}

async function getSolarTermsInfo() {
  return normalizeSolarTermsInfo(await getSolarTermsRaw());
}

async function claimSolarTermsReward(termId = 0) {
  const before = await getSolarTermsInfo();
  const resolvedTermId = Number(termId) || toNum(before?.currentTerm?.id);
  if (resolvedTermId <= 0) throw new Error('未找到可领取的节令奖励');

  const target = (before.terms || []).find((term) => term.id === resolvedTermId) || null;
  if (target && !target.claimable) {
    throw new Error(`${target.title || '该节令'}当前不可领取`);
  }

  const result = normalizeSolarTermsClaimResult(await claimSolarTermsRaw(resolvedTermId));
  const after = await getSolarTermsInfo();

  activityLogger.info('节令小札领取成功', {
    event: 'solar_terms_claim',
    termId: resolvedTermId,
    termTitle: target?.title || result.term?.title || '',
    rewardCount: result.rewards.length,
  });

  return {
    ok: true,
    termId: resolvedTermId,
    rewards: result.rewards,
    term: result.term,
    solarTerms: after,
  };
}

function normalizeHeluGroup(reply, lastDrawResult = null) {
  const activities = flattenActivityChildren(reply);
  const getDrawInfo = (act) => act?.draw_info || act?.drawInfo || null;
  const getExchangeShop = (act) => act?.exchange_shop || act?.exchangeShop || null;

  const drawAct = activities.find((a) => toNum(a?.id) === HELU_DRAW_ACTIVITY_ID)
    || activities.find((a) => /奇遇礼莲/.test(String(a?.title || '')))
    || activities.find((a) => getDrawInfo(a))
    || null;

  const exchangeAct = activities.find(
    (a) => /荷露商店/.test(String(a?.title || ''))
      || (getExchangeShop(a) && Array.isArray(getExchangeShop(a).items) && getExchangeShop(a).items.length > 0)
  ) || null;

  let drawInfo = normalizeDrawInfo(getDrawInfo(drawAct)) || scanDrawInfoFromRawBody(reply?.__rawBody);
  let exchangeItems = (getExchangeShop(exchangeAct)?.items || [])
    .map(normalizeExchangeShopItem)
    .filter(Boolean);
  const rawExchange = scanExchangeShopInfoFromRawBody(reply?.__rawBody);
  if (exchangeItems.length === 0 && rawExchange) {
    exchangeItems = rawExchange.items;
  }
  if (!drawInfo) drawInfo = normalizeDrawInfo({});
  if (!drawInfo._hasPaidRemaining && drawInfo.freeRemaining <= 0) {
    drawInfo.paidUsed = drawInfo.paidMax;
    drawInfo.paidRemaining = 0;
  }
  drawInfo.actions = computeHeluDrawActions(drawInfo);
  drawInfo.dailyMax = drawInfo.freeMax + drawInfo.paidMax;
  drawInfo.dailyUsed = drawInfo.freeUsed + drawInfo.paidUsed;
  drawInfo.dailyRemaining = drawInfo.freeRemaining + drawInfo.paidRemaining;

  const root = reply?.group?.activity || {};
  const subActivities = normalizeHeluSubActivities(activities);
  return {
    uid: reply?.__activityUid || HELU_ACTIVITY_UID,
    title: String(root?.title || '荷风十里蝉初鸣'),
    activityId: toNum(root?.id) || HELU_ACTIVITY_ID,
    drawActivityId: toNum(drawAct?.id) || HELU_DRAW_ACTIVITY_ID,
    drawCommand: HELU_DRAW_CMD,
    draw: drawInfo,
    exchangeActivityId: toNum(exchangeAct?.id),
    exchangeShop: exchangeItems,
    subActivities,
    lastDrawResult,
    summary: {
      rewardPoolCount: drawInfo.rewardPool.length,
      exchangeShopCount: exchangeItems.length,
      activityCount: activities.length,
      subActivityCount: subActivities.length,
      dailyUsed: drawInfo.dailyUsed,
      dailyRemaining: drawInfo.dailyRemaining,
    },
    raw: {
      activityCount: activities.length,
      activityTitles: activities.map((a) => String(a?.title || '')).filter(Boolean),
      activityIds: activities.map((a) => toNum(a?.id)).filter((id) => id > 0),
    },
  };
}

async function getHeluActivity() {
  const state = getUserState();
  if (!state) {
    return {
      uid: HELU_ACTIVITY_UID,
      title: '荷风十里蝉初鸣',
      draw: {
        ...normalizeDrawInfo({}),
        actions: computeHeluDrawActions(normalizeDrawInfo({})),
      },
      heluBalance: 0,
      subActivities: normalizeHeluSubActivities([]),
      passport: {
        uid: HELU_PASSPORT_UID,
        title: '荷风游记',
        currentLevel: 0,
        claimableLevels: 0,
        rewards: [],
        levelRewardTiers: [],
      },
      solarTerms: {
        terms: [],
        claimableCount: 0,
        currentTerm: null,
      },
      summary: { rewardPoolCount: 0, subActivityCount: HELU_SUB_ACTIVITY_DEFS.length },
      qingmei: await getQingmeiActivity(),
      warning: 'runtime connection is not open',
    };
  }

  const activity = normalizeHeluGroup(
    await getActivityGroupWithUidFallback(HELU_ACTIVITY_ID, getHeluActivityUidCandidates())
  );
  activity.heluBalance = await getHeluBalance();
  try {
    activity.passport = await getSeasonPassport();
  } catch (err) {
    activity.passport = {
      uid: HELU_PASSPORT_UID,
      title: '荷风游记',
      currentLevel: 0,
      claimableLevels: 0,
      rewards: [],
      levelRewardTiers: [],
      warning: err?.message || String(err),
    };
  }
  try {
    activity.solarTerms = await getSolarTermsInfo();
  } catch (err) {
    activity.solarTerms = {
      terms: [],
      claimableCount: 0,
      currentTerm: null,
      warning: err?.message || String(err),
    };
  }
  activity.qingmei = await getQingmeiActivity();
  return activity;
}

function resolveHeluDrawCount(activity, options = {}) {
  const draw = activity?.draw || {};
  const mode = String(options?.mode || '').toLowerCase();
  const requestedCount = Math.max(0, toNum(options?.count));

  if (mode === 'batch' || mode === 'four' || mode === 'max') {
    return draw.actions?.batch?.count || 0;
  }
  if (mode === 'one') return draw.actions?.one?.count || 0;
  if (requestedCount > 0) {
    if (draw.freeRemaining > 0) return Math.min(requestedCount, draw.freeRemaining);
    return Math.min(requestedCount, draw.paidRemaining);
  }
  return draw.actions?.one?.count || 0;
}

async function drawHeluGiftLotus(options = {}) {
  const before = await getHeluActivity();
  const count = resolveHeluDrawCount(before, options);
  if (count <= 0) throw new Error('奇遇礼莲今日次数已用完');

  const usingFree = toNum(before?.draw?.freeRemaining) > 0;
  const expectedCost = usingFree ? 0 : count * toNum(before?.draw?.paidPrice);

  let drawResult = null;
  const drawPayload = { id: HELU_DRAW_ACTIVITY_ID, count };
  const paidPayload = { type: 0, count };
  if (!usingFree && expectedCost > 0) {
    drawPayload.cost = {
      id: toNum(before?.draw?.paidCurrencyId) || 1002,
      count: expectedCost,
    };
  }

  const drawContext = {
    requestedMode: options?.mode || '',
    requestedCount: toNum(options?.count) || 0,
    resolvedCount: count,
    mode: usingFree ? 'free' : 'paid',
    expectedCost,
    paidCurrencyId: toNum(before?.draw?.paidCurrencyId) || 1002,
    before: {
      freeUsed: toNum(before?.draw?.freeUsed),
      freeMax: toNum(before?.draw?.freeMax),
      freeRemaining: toNum(before?.draw?.freeRemaining),
      paidUsed: toNum(before?.draw?.paidUsed),
      paidMax: toNum(before?.draw?.paidMax),
      paidRemaining: toNum(before?.draw?.paidRemaining),
      paidPrice: toNum(before?.draw?.paidPrice),
    },
    payload: usingFree ? drawPayload : paidPayload,
    legacyDrawPayload: usingFree ? null : drawPayload,
  };
  activityLogger.info('奇遇礼莲抽奖开始', drawContext);

  try {
    if (usingFree && count > 1) {
      const merged = { rewards: [], items: [], cost: null };
      for (let i = 0; i < count; i += 1) {
        assertActivityConnection('奇遇礼莲抽奖');
        if (i > 0) await delay(HELU_DRAW_REQUEST_GAP_MS);

        const body = await operateActivity(HELU_DRAW_ACTIVITY_ID, HELU_DRAW_CMD, {
          draw: { id: HELU_DRAW_ACTIVITY_ID, count: 1 },
        });
        const decoded = types.ActivityOperateReply.decode(body);
        const result = normalizeDrawResult(decoded?.draw_result || decoded?.drawResult);
        if (Array.isArray(result?.rewards)) merged.rewards.push(...result.rewards);
        if (Array.isArray(result?.items)) merged.items.push(...result.items);
        if (!merged.cost && result?.cost) merged.cost = result.cost;
      }
      drawResult = merged;
    } else {
      assertActivityConnection('奇遇礼莲抽奖');
      const params = usingFree
        ? { draw: drawPayload }
        : { helu_paid_draw: paidPayload };
      const body = await operateActivity(HELU_DRAW_ACTIVITY_ID, HELU_DRAW_CMD, params);
      const decoded = types.ActivityOperateReply.decode(body);
      drawResult = normalizeDrawResult(decoded?.draw_result || decoded?.drawResult);
    }
  } catch (err) {
    activityLogger.error('奇遇礼莲抽奖失败', {
      ...drawContext,
      error: err?.message || String(err),
    });
    throw new Error(
      `奇遇礼莲抽奖失败: activityId=${HELU_DRAW_ACTIVITY_ID}, count=${count}, expectedCost=${expectedCost}: ${err.message}`
    );
  }

  await delay(HELU_DRAW_REFRESH_DELAY_MS);
  assertActivityConnection('刷新奇遇礼莲活动');
  const after = await getHeluActivity();
  activityLogger.info('奇遇礼莲抽奖成功', {
    ...drawContext,
    cost: drawResult?.cost || null,
    rewardCount: (Array.isArray(drawResult?.items) ? drawResult.items.length : 0)
      + (Array.isArray(drawResult?.rewards) ? drawResult.rewards.length : 0),
    after: {
      freeUsed: toNum(after?.draw?.freeUsed),
      freeMax: toNum(after?.draw?.freeMax),
      freeRemaining: toNum(after?.draw?.freeRemaining),
      paidUsed: toNum(after?.draw?.paidUsed),
      paidMax: toNum(after?.draw?.paidMax),
      paidRemaining: toNum(after?.draw?.paidRemaining),
    },
  });

  return {
    ok: true,
    count,
    expectedCost,
    costCurrencyId: usingFree ? 0 : toNum(before?.draw?.paidCurrencyId) || 1002,
    mode: usingFree ? 'free' : 'paid',
    result: drawResult,
    activity: {
      ...after,
      lastDrawResult: drawResult,
    },
  };
}

async function exchangeHeluShopItem(slotId, count = 1) {
  const slotIdNum = Number(slotId) || 0;
  if (slotIdNum <= 0) throw new Error('缺少有效的荷露商店槽位');

  const exchangeCount = Math.floor(Number(count) || 0);
  if (exchangeCount <= 0) throw new Error('兑换数量必须大于 0');

  const before = await getHeluActivity();
  const exchangeItems = Array.isArray(before?.exchangeShop) ? before.exchangeShop : [];
  const slot = exchangeItems.find((item) => toNum(item?.id) === slotIdNum);
  if (!slot) throw new Error(`荷露商店未找到槽位: ${slotIdNum}`);

  const price = Math.max(0, toNum(slot?.price));
  const balance = Math.max(0, toNum(before?.heluBalance));
  const isHeluCurrency = toNum(slot?.currencyId) === HELU_CURRENCY_ITEM_ID;
  const ownedBlocksExchange = slot?.ownedBlocksExchange !== false && slot?.owned && !slot?.isRepeatable;
  const exchangeLimit = Math.max(0, toNum(slot?.exchangeLimit));
  const totalPrice = price * exchangeCount;

  if (!isHeluCurrency) throw new Error(`暂不支持非荷露货币兑换: slotId=${slotIdNum}`);
  if (ownedBlocksExchange) throw new Error(`该商品已拥有，不能重复兑换: slotId=${slotIdNum}`);
  if (!slot?.isRepeatable && exchangeCount > 1) throw new Error('该商品每次只能兑换 1 个');
  if (exchangeLimit > 0 && exchangeCount > exchangeLimit) {
    throw new Error(`兑换数量超过上限: 最多可兑换 ${exchangeLimit} 个`);
  }
  if (totalPrice > balance) throw new Error(`荷露不足: 需要 ${totalPrice}, 当前 ${balance}`);

  activityLogger.info('荷露商店兑换开始', {
    slotId: slotIdNum,
    itemId: toNum(slot?.itemId),
    itemName: slot?.itemName || slot?.name || '',
    price,
    count: exchangeCount,
    totalPrice,
    balance,
    exchangeActivityId: HELU_EXCHANGE_ACTIVITY_ID,
    cmd: HELU_EXCHANGE_CMD,
  });

  try {
    await operateActivity(HELU_EXCHANGE_ACTIVITY_ID, HELU_EXCHANGE_CMD, {
      exchangeShopOperate: {
        id: slotIdNum,
        count: exchangeCount,
      },
    });
  } catch (err) {
    activityLogger.error('荷露商店兑换失败', {
      slotId: slotIdNum,
      itemId: toNum(slot?.itemId),
      price,
      count: exchangeCount,
      totalPrice,
      balance,
      error: err?.message || String(err),
    });
    throw new Error(`荷露商店兑换失败: slotId=${slotIdNum}, itemId=${toNum(slot?.itemId)}, price=${price}: ${err.message}`);
  }

  const after = await getHeluActivity();
  return {
    ok: true,
    slotId: slotIdNum,
    price,
    count: exchangeCount,
    totalPrice,
    currencyId: HELU_CURRENCY_ITEM_ID,
    item: slot,
    activity: after,
  };
}

// ---- 南瓜活动标准化 ----

function normalizeNanguaGroup(reply) {
  const activities = flattenActivityChildren(reply);

  const getRandomShop = (act) => act?.random_shop || act?.randomShop || null;
  const getExchangeShop = (act) => act?.exchange_shop || act?.exchangeShop || null;

  const randomAct = activities.find(
    (a) => getRandomShop(a) && Array.isArray(getRandomShop(a).items) && getRandomShop(a).items.length > 0
  ) || null;

  const exchangeAct = activities.find(
    (a) => getExchangeShop(a) && Array.isArray(getExchangeShop(a).items) && getExchangeShop(a).items.length > 0
  ) || null;

  // 优先使用 proto 解码
  let randomShop = normalizeRandomShopInfo(getRandomShop(randomAct));

  // 原始 body 扫描作为回退
  const rawRandomShop = scanRandomShopInfoFromRawBody(reply?.__rawBody);
  if (!randomShop || randomShop.items.length === 0) {
    randomShop = rawRandomShop;
  } else if (rawRandomShop) {
    randomShop = {
      ...randomShop,
      nextRefreshTime: randomShop.nextRefreshTime || rawRandomShop.nextRefreshTime,
      manualRefreshCost: randomShop.manualRefreshCost || rawRandomShop.manualRefreshCost,
      manualRefreshCurrencyId: randomShop.manualRefreshCurrencyId || rawRandomShop.manualRefreshCurrencyId,
      manualRefreshExtraValue: randomShop.manualRefreshExtraValue || rawRandomShop.manualRefreshExtraValue,
      maxManualRefreshCount: 6,
      manualRefreshUsedCount: randomShop.manualRefreshUsedCount || rawRandomShop.manualRefreshUsedCount,
    };
  }

  const randomItems = randomShop?.items || [];

  let exchangeItems = (getExchangeShop(exchangeAct)?.items || [])
    .map(normalizeExchangeShopItem)
    .filter(Boolean);

  const rawExchange = scanExchangeShopInfoFromRawBody(reply?.__rawBody);
  if (exchangeItems.length === 0 && rawExchange) {
    exchangeItems = rawExchange.items;
  }

  const refreshInfo = {
    nextRefreshTime: randomShop?.nextRefreshTime || 0,
    manualRefreshCost: randomShop?.manualRefreshCost || 0,
    manualRefreshCurrencyId: randomShop?.manualRefreshCurrencyId || 1001,
    manualRefreshExtraValue: randomShop?.manualRefreshExtraValue || 0,
    maxManualRefreshCount: 6,
    manualRefreshUsedCount: randomShop?.manualRefreshUsedCount || 0,
  };

  return {
    uid: NANGUA_ACTIVITY_UID,
    title: String(reply?.group?.activity?.title || '南瓜乐翻天'),
    randomActivityId: toNum(randomAct?.id),
    exchangeActivityId: toNum(exchangeAct?.id),
    randomShop: randomItems,
    randomShopRefresh: refreshInfo,
    exchangeShop: exchangeItems,
    summary: {
      randomShopCount: randomItems.length,
      exchangeShopCount: exchangeItems.length,
      activityCount: activities.length,
    },
    raw: {
      activityCount: activities.length,
      activityTitles: activities.map((a) => String(a?.title || '')).filter(Boolean),
      activityIds: activities.map((a) => toNum(a?.id)).filter((id) => id > 0),
    },
  };
}

/**
 * 获取南瓜商店
 */
async function getNanguaShop() {
  const state = getUserState();
  if (!state) {
    return {
      uid: NANGUA_ACTIVITY_UID,
      title: '南瓜乐翻天',
      randomShop: [],
      exchangeShop: [],
      summary: { randomShopCount: 0, exchangeShopCount: 0 },
      warning: 'runtime connection is not open',
    };
  }

  return normalizeNanguaGroup(await getActivityGroup(NANGUA_SHOP_ACTIVITY_ID));
}

module.exports = {
  NANGUA_ACTIVITY_UID,
  HELU_ACTIVITY_UID,
  QINGMEI_ACTIVITY_UID,
  NANGUA_SHOP_ACTIVITY_ID,
  NANGUA_RANDOM_SHOP_ACTIVITY_ID,
  HELU_ACTIVITY_ID,
  HELU_DRAW_ACTIVITY_ID,
  HELU_EXCHANGE_ACTIVITY_ID,
  QINGMEI_ACTIVITY_ID,
  QINGMEI_SEED_CLAIM_ACTIVITY_ID,
  QINGMEI_WINE_ACTIVITY_ID,
  HELU_SUB_ACTIVITY_KEYS,
  NANGUA_SHOP_BUY_CMD,
  NANGUA_SHOP_REFRESH_CMD,
  HELU_EXCHANGE_CMD,
  HELU_DRAW_CMD,
  getActivityGroup,
  getNanguaShop,
  getHeluActivity,
  getQingmeiActivity,
  claimQingmeiSeeds,
  brewAndSellQingmeiWine,
  getSeasonPassport,
  claimSeasonPassportRewards,
  getSolarTermsInfo,
  claimSolarTermsReward,
  exchangeHeluShopItem,
  drawHeluGiftLotus,
  buyNanguaShopItem,
  refreshNanguaShop,
  normalizeNanguaGroup,
  normalizeHeluGroup,
};
