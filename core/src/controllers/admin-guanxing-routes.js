const {
  getAuthorizedAccountId,
  requireConnectedAccount,
} = require("./admin-activity-route-helpers");

/**
 * 观星礼录（二十八星宿）与星砂商店路由
 */
function registerAdminGuanxingRoutes({
  app,
  provider,
  getAccountIdFromRequest,
  canAccessAccount,
  sendProviderError,
}) {
  const routeContext = {
    getAccountIdFromRequest,
    canAccessAccount,
  };

  // 观星礼录状态
  app.get("/api/activity/guanxing", async (req, res) => {
    const accountId = getAuthorizedAccountId(req, res, routeContext);
    if (!accountId) return;

    try {
      if (!requireConnectedAccount(res, provider, accountId, "获取观星礼录失败: 账号未运行")) return;

      const activity = await provider.getGuanxingActivity(accountId);
      res.json({ ok: true, activity });
    } catch (err) {
      sendProviderError(res, err);
    }
  });

  // 一键领取已解锁星宿奖励
  app.post("/api/activity/guanxing/claim", async (req, res) => {
    const accountId = getAuthorizedAccountId(req, res, routeContext);
    if (!accountId) return;

    try {
      if (!requireConnectedAccount(res, provider, accountId, "观星礼录领取失败: 账号未运行")) return;

      const result = await provider.claimGuanxingRewards(accountId);
      res.json({ ok: true, ...result });
    } catch (err) {
      sendProviderError(res, err);
    }
  });

  // 星砂商店已统一通过 /api/activity/helu 的 exchangeShop 提供（shop 页签），
  // 之前观星礼录页签里独立的星砂商店（/api/activity/guanxing/shop*）已移除避免重复。
}

module.exports = { registerAdminGuanxingRoutes };
