const {
  getFruitLayerByFruitId,
  getItemById,
  getPlantNameOrNull,
  getPlantByFruitId,
  getSeedImageBySeedId,
} = require("../config/gameConfig");
const { toNum } = require("../utils/utils");

const SEED_SHOP_TYPE = 2;

function getUserLevel(provider, accountId) {
  const status = provider.getStatus(accountId);
  return status?.status?.level || 0;
}

async function getSeedShopGoodsMap({
  provider,
  accountId,
  adminLogger,
  tolerateFailure = false,
}) {
  try {
    const shopInfo = await provider.getShopInfo(accountId, SEED_SHOP_TYPE);
    const goodsList = shopInfo?.goods_list || [];
    const seedGoodsMap = new Map();

    for (const goods of goodsList) {
      const itemId = toNum(goods.item_id) || 0;
      const goodsId = toNum(goods.id) || 0;
      const price = toNum(goods.price) || 0;

      if (itemId > 0 && goodsId > 0) {
        seedGoodsMap.set(itemId, {
          goodsId,
          price,
        });
      }
    }

    adminLogger.info("种子商店映射", {
      sampleItems: goodsList.slice(0, 3).map(goods => ({
        goodsId: toNum(goods.id),
        itemId: toNum(goods.item_id),
        price: toNum(goods.price),
        unlocked: goods.unlocked,
      })),
      mapSize: seedGoodsMap.size,
    });

    return seedGoodsMap;
  } catch (err) {
    if (!tolerateFailure) throw err;

    adminLogger.warn("获取种子商店失败，跳过可购买判断", {
      error: err.message,
    });
    return new Map();
  }
}

/**
 * ItemInfo 缺失时，用 Plant.json 中对应植物名兜底
 * 普通作物：fruitId = seedId + 20000，plantId = seedId + 1000000
 * 变异作物：fruitId = 1040000 + n，plantId = 1120000 + n
 */
function resolveFruitDisplayName(fruitId) {
  const id = toNum(fruitId) || 0;
  if (id <= 0) return null;
  // 先直接按果实ID查 Plant.json（普通/变异果实均已收录）
  const plant = getPlantByFruitId(id);
  if (plant?.name) return plant.name;
  if (id > 1000000) {
    // 变异体：1040xxx → 1120xxx
    return getPlantNameOrNull(id - 1040000 + 1120000);
  }
  return getPlantNameOrNull(id - 20000 + 1000000);
}

function getPlantSeedInfo(fruitId) {
  const plant = getPlantByFruitId(fruitId);
  const seedId = plant ? plant.seed_id || 0 : 0;
  const seedLevel = seedId > 0 ? getItemById(seedId)?.level || 0 : 0;

  return {
    seedId,
    seedLevel,
  };
}

function buildIllustratedItem(rawItem, { seedGoodsMap, userLevel, adminLogger }) {
  const fruitId = toNum(rawItem.seed_id) || 0;
  const fruitConfig = getItemById(fruitId);
  const { seedId, seedLevel } = getPlantSeedInfo(fruitId);
  const unlocked = !!rawItem.unlocked;
  const seedGoods = seedGoodsMap.get(seedId);
  const goodsId = seedGoods?.goodsId || 0;
  const price = seedGoods?.price || 0;
  const canBuy =
    !unlocked &&
    seedId > 0 &&
    seedLevel > 0 &&
    userLevel >= seedLevel &&
    !!seedGoods;

  if (!unlocked && seedId > 0) {
    adminLogger.info("图鉴可购买检查", {
      fruitId,
      seedId,
      seedLevel,
      userLevel,
      hasGoods: !!seedGoods,
      goodsId,
      price,
    });
  }

  return {
    seedId: fruitId,
    unlocked,
    plantedCount: toNum(rawItem.planted_count) || 0,
    harvestCount: toNum(rawItem.harvest_count) || 0,
    name: fruitConfig?.name || resolveFruitDisplayName(fruitId) || `果实${  fruitId}`,
    image: getSeedImageBySeedId(fruitId),
    level: Number(fruitConfig?.level) || 0,
    layer: getFruitLayerByFruitId(fruitId),
    canBuy,
    goodsId,
    price,
    seedLevel,
  };
}

function summarizeIllustratedItems(items) {
  return {
    total: items.length,
    unlocked: items.filter(item => item.unlocked).length,
    locked: items.filter(item => !item.unlocked).length,
    canBuy: items.filter(item => item.canBuy).length,
  };
}

function collectBuyableIllustratedItems(rawItems, { seedGoodsMap, userLevel }) {
  const buyableItems = [];

  for (const rawItem of rawItems || []) {
    const fruitId = toNum(rawItem.seed_id) || 0;
    if (rawItem.unlocked) continue;

    const { seedId, seedLevel } = getPlantSeedInfo(fruitId);
    if (seedId <= 0 || seedLevel <= 0 || userLevel < seedLevel) continue;

    const seedGoods = seedGoodsMap.get(seedId);
    if (!seedGoods) continue;

    buyableItems.push({
      fruitId,
      seedId,
      goodsId: seedGoods.goodsId,
      price: seedGoods.price,
      name: getItemById(fruitId)?.name || `果实${  fruitId}`,
    });
  }

  return buyableItems;
}

module.exports = {
  collectBuyableIllustratedItems,
  getSeedShopGoodsMap,
  getUserLevel,
  buildIllustratedItem,
  summarizeIllustratedItems,
};
