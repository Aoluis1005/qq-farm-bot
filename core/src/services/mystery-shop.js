const { getItemById, getItemImageById } = require('../config/gameConfig');
const { sendMsgAsync } = require('../utils/network');
const { types } = require('../utils/proto');
const { toNum } = require('../utils/utils');

const SERVICE = 'gamepb.mysteryshoppb.MysteryShopService';
const CURRENCY_NAMES = {
  1001: '金币',
  1002: '点券',
  1005: '金豆豆',
};

function normalizeNPC(reply) {
  const npc = reply?.npc;
  const itemId = toNum(npc?.item_id);
  const itemInfo = getItemById(itemId);
  const endTime = toNum(reply?.end_time);
  const purchased = !!npc?.purchased;

  return {
    active: !!reply?.active && !purchased && (!endTime || endTime * 1000 > Date.now()),
    npcId: toNum(npc?.npc_id),
    itemId,
    itemType: toNum(npc?.item_type),
    itemName: itemInfo?.name || `物品${itemId}`,
    itemImage: getItemImageById(itemId),
    itemCount: toNum(npc?.item_count),
    currencyId: toNum(npc?.currency_id),
    currencyName: CURRENCY_NAMES[toNum(npc?.currency_id)] || `货币${toNum(npc?.currency_id)}`,
    price: toNum(npc?.price),
    originalPrice: toNum(npc?.original_price),
    discount: toNum(npc?.discount),
    purchased,
    startTime: toNum(reply?.start_time),
    endTime,
  };
}

async function getActiveMysteryShop() {
  const request = types.GetActiveMysteryNPCRequest.encode(
    types.GetActiveMysteryNPCRequest.create({})
  ).finish();
  // 神秘商人超时时间加到 60 秒（比默认 20 秒长）
  try {
    const { body } = await sendMsgAsync(SERVICE, 'GetActiveNPC', request, 60000);
    return normalizeNPC(types.GetActiveMysteryNPCReply.decode(body));
  } catch (e) {
    // 首次超时重试一次
    const { body } = await sendMsgAsync(SERVICE, 'GetActiveNPC', request, 60000);
    return normalizeNPC(types.GetActiveMysteryNPCReply.decode(body));
  }
}

async function buyMysteryShopGoods(npcId) {
  const id = toNum(npcId);
  if (id <= 0) throw new Error('无效的神秘商人 ID');

  const request = types.BuyMysteryShopRequest.encode(
    types.BuyMysteryShopRequest.create({ npc_id: id })
  ).finish();
  const { body } = await sendMsgAsync(SERVICE, 'Buy', request);
  const reply = types.BuyMysteryShopReply.decode(body);
  return {
    reward: {
      itemId: toNum(reply?.reward?.item_id),
      count: toNum(reply?.reward?.count),
    },
    purchased: !!reply?.npc?.purchased,
  };
}

async function abandonMysteryShop() {
  const request = types.AbandonMysteryShopRequest.encode(
    types.AbandonMysteryShopRequest.create({})
  ).finish();
  const { body } = await sendMsgAsync(SERVICE, 'Abandon', request);
  types.AbandonMysteryShopReply.decode(body);
  return { abandoned: true };
}

module.exports = {
  getActiveMysteryShop,
  buyMysteryShopGoods,
  abandonMysteryShop,
  normalizeNPC,
};
