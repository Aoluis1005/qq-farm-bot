const { getItemById, getPlantBySeedId, getPlantByFruitId } = require("../config/gameConfig");
const { toNum } = require("../utils/utils");
const {
  getBagLockedItemIds,
  setBagLockedItemIds,
  toggleBagLockedItemId,
} = require("../models/store");

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requireAccessibleAccount(
  req,
  res,
  getAccountIdFromRequest,
  canAccessAccount,
  missingAccountError = "Missing x-account-id",
) {
  const accountId = getAccountIdFromRequest(req);
  if (!accountId) {
    const payload = { ok: false };
    if (missingAccountError)
      payload.error = missingAccountError;
    res.status(400).json(payload);
    return null;
  }

  if (!canAccessAccount(req, accountId)) {
    res.status(403).json({ ok: false, error: "无权访问此账号" });
    return null;
  }

  return accountId;
}

function getItemName(itemId) {
  const info = getItemById(itemId);
  if (info?.name) return info.name;
  // ItemInfo 缺失时统一回退到 Plant.json（种子 / 果实 / 变异果实均已收录）
  const seedPlant = getPlantBySeedId(itemId);
  if (seedPlant?.name) return `${seedPlant.name}种子`;
  const fruitPlant = getPlantByFruitId(itemId);
  if (fruitPlant?.name) return fruitPlant.name;
  return `物品${itemId}`;
}

function getBagItemCountMap(bag) {
  const counts = new Map();
  for (const item of bag?.originalItems || []) {
    counts.set(toNum(item.id), toNum(item.count));
  }
  return counts;
}

function getNewItemsAfterUse(bagBefore, bagAfter, usedItemId) {
  const beforeCounts = getBagItemCountMap(bagBefore);
  const newItems = [];

  for (const item of bagAfter?.originalItems || []) {
    const itemId = toNum(item.id);
    if (itemId === usedItemId)
      continue;

    const countDelta = toNum(item.count) - (beforeCounts.get(itemId) || 0);
    if (countDelta > 0) {
      newItems.push({
        id: itemId,
        count: countDelta,
        name: getItemName(itemId),
      });
    }
  }

  return newItems;
}

function buildUseItemMessage(usedItemName, usedCount, newItems) {
  if (newItems.length === 0)
    return `使用 ${usedItemName} x${usedCount}`;

  const rewards = newItems.map((item) => `${item.name} x${item.count}`).join(", ");
  return `使用 ${usedItemName} x${usedCount}，获得: ${rewards}`;
}

function registerAdminBagRoutes({
  app,
  provider,
  emitRealtimeLog,
  getAccountIdFromRequest,
  canAccessAccount,
  sendProviderError,
}) {
  app.get("/api/bag", async (req, res) => {
    const accountId = requireAccessibleAccount(req, res, getAccountIdFromRequest, canAccessAccount, null);
    if (!accountId)
      return;

    try {
      const bag = await provider.getBag(accountId);
      res.json({ ok: true, data: bag });
    }
    catch (error) {
      sendProviderError(res, error);
    }
  });

  app.post("/api/bag/use", async (req, res) => {
    const accountId = requireAccessibleAccount(req, res, getAccountIdFromRequest, canAccessAccount);
    if (!accountId)
      return;

    try {
      const { itemId, count } = req.body;
      if (!itemId)
        return res.status(400).json({ ok: false, error: "缺少 itemId" });

      const usedItemId = toNum(itemId);
      const usedCount = Math.max(1, toNum(count) || 1);
      const usedItemName = getItemName(usedItemId);
      const bagBefore = await provider.getBag(accountId);

      await provider.useItem(accountId, usedItemId, usedCount);
      await wait(500);

      const bagAfter = await provider.getBag(accountId);
      const newItems = getNewItemsAfterUse(bagBefore, bagAfter, usedItemId);

      emitRealtimeLog({
        accountId,
        time: new Date().toISOString().replace("T", " ").slice(0, 19),
        tag: "背包",
        msg: buildUseItemMessage(usedItemName, usedCount, newItems),
        module: "warehouse",
        event: "use_item",
      });

      res.json({
        ok: true,
        data: {
          items: newItems,
          usedItemName,
          usedCount,
        },
      });
    }
    catch (error) {
      sendProviderError(res, error);
    }
  });

  app.post("/api/bag/sell", async (req, res) => {
    const accountId = requireAccessibleAccount(req, res, getAccountIdFromRequest, canAccessAccount);
    if (!accountId)
      return;

    try {
      const { items } = req.body;
      if (!Array.isArray(items) || items.length === 0)
        return res.status(400).json({ ok: false, error: "缺少出售物品列表" });

      const result = await provider.sellItems(accountId, items);
      res.json({ ok: true, data: result });
    }
    catch (error) {
      sendProviderError(res, error);
    }
  });

  app.get("/api/bag/seeds", async (req, res) => {
    const accountId = requireAccessibleAccount(req, res, getAccountIdFromRequest, canAccessAccount);
    if (!accountId)
      return;

    try {
      const seeds = await provider.getBagSeeds(accountId);
      res.json({ ok: true, data: seeds });
    }
    catch (error) {
      sendProviderError(res, error);
    }
  });

  // ==================== 背包物品上锁（跳过自动出售） ====================

  // 获取当前账号的上锁物品 ID 列表
  app.get("/api/bag/locked", (req, res) => {
    const accountId = requireAccessibleAccount(req, res, getAccountIdFromRequest, canAccessAccount, null);
    if (!accountId) return;
    try {
      res.json({ ok: true, data: { itemIds: getBagLockedItemIds(accountId) } });
    } catch (error) {
      sendProviderError(res, error);
    }
  });

  // 上锁/解锁某个物品（body: { itemId, locked? }，locked 缺省为切换）
  app.post("/api/bag/lock", (req, res) => {
    const accountId = requireAccessibleAccount(req, res, getAccountIdFromRequest, canAccessAccount);
    if (!accountId) return;

    try {
      const { itemId, locked } = req.body;
      if (!itemId) return res.status(400).json({ ok: false, error: "缺少 itemId" });
      const ids = toggleBagLockedItemId(accountId, itemId, locked);
      res.json({ ok: true, data: { itemIds: ids } });
    } catch (error) {
      sendProviderError(res, error);
    }
  });

  // 批量设置上锁列表（body: { itemIds: number[] }，整体替换）
  app.post("/api/bag/lock/batch", (req, res) => {
    const accountId = requireAccessibleAccount(req, res, getAccountIdFromRequest, canAccessAccount);
    if (!accountId) return;

    try {
      const { itemIds } = req.body;
      if (!Array.isArray(itemIds)) return res.status(400).json({ ok: false, error: "缺少 itemIds" });
      const ids = setBagLockedItemIds(accountId, itemIds);
      res.json({ ok: true, data: { itemIds: ids } });
    } catch (error) {
      sendProviderError(res, error);
    }
  });

  app.get("/api/daily-gifts", async (req, res) => {
    const accountId = requireAccessibleAccount(req, res, getAccountIdFromRequest, canAccessAccount, null);
    if (!accountId)
      return;

    try {
      const gifts = await provider.getDailyGifts(accountId);
      res.json({ ok: true, data: gifts });
    }
    catch (error) {
      sendProviderError(res, error);
    }
  });
}

module.exports = { registerAdminBagRoutes };
