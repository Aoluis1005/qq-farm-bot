const {
  getAuthorizedAccountId,
  requireConnectedAccount,
} = require("./admin-activity-route-helpers");

function isQingmeiClaimAlreadyHandledError(err) {
  const message = String(err?.message || err || "");
  return message.includes("已领取")
    || message.includes("已经领取")
    || message.includes("重复领取")
    || message.includes("already");
}

function isQingmeiWineBusinessError(err) {
  const message = String(err?.message || err || "");
  return !!err?.qingmeiWine
    || message.includes("青梅酿")
    || message.includes("ActivityService.Operate")
    || message.includes("ShareService");
}

function registerAdminHeluActivityRoutes({
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

  app.get("/api/activity/helu", async (req, res) => {
    const accountId = getAuthorizedAccountId(req, res, routeContext);
    if (!accountId) return;

    try {
      if (!requireConnectedAccount(res, provider, accountId, "获取奇遇礼莲失败: 账号未运行"))
        return;

      const activity = await provider.getHeluActivity(accountId);
      res.json({
        ok: true,
        activity,
      });
    } catch (err) {
      sendProviderError(res, err);
    }
  });

  app.post("/api/activity/helu/draw", async (req, res) => {
    const accountId = getAuthorizedAccountId(req, res, routeContext);
    if (!accountId) return;

    try {
      if (!requireConnectedAccount(res, provider, accountId, "奇遇礼莲抽奖失败: 账号未运行"))
        return;

      const result = await provider.drawHeluGiftLotus(accountId, req.body || {});
      res.json({
        ok: true,
        ...result,
      });
    } catch (err) {
      sendProviderError(res, err);
    }
  });

  app.post("/api/activity/helu/passport/claim", async (req, res) => {
    const accountId = getAuthorizedAccountId(req, res, routeContext);
    if (!accountId) return;

    try {
      if (!requireConnectedAccount(res, provider, accountId, "荷风游记领取失败: 账号未运行"))
        return;

      const result = await provider.claimSeasonPassportRewards(accountId);
      const activity = await provider.getHeluActivity(accountId);
      res.json({
        ok: true,
        ...result,
        activity,
      });
    } catch (err) {
      sendProviderError(res, err);
    }
  });

  app.post("/api/activity/helu/solar/claim", async (req, res) => {
    const accountId = getAuthorizedAccountId(req, res, routeContext);
    if (!accountId) return;

    try {
      if (!requireConnectedAccount(res, provider, accountId, "节令小札领取失败: 账号未运行"))
        return;

      const termId = Number(req.body?.termId) || 0;
      const result = await provider.claimSolarTermsReward(accountId, termId);
      const activity = await provider.getHeluActivity(accountId);
      res.json({
        ok: true,
        ...result,
        activity,
      });
    } catch (err) {
      sendProviderError(res, err);
    }
  });

  app.post("/api/activity/helu/exchange", async (req, res) => {
    const accountId = getAuthorizedAccountId(req, res, routeContext);
    if (!accountId) return;

    try {
      if (!requireConnectedAccount(res, provider, accountId, "荷露商店兑换失败: 账号未运行"))
        return;

      const slotId = Number(req.body?.slotId) || 0;
      const count = Math.floor(Number(req.body?.count) || 0);
      if (count <= 0) {
        return res.status(400).json({ ok: false, error: "兑换数量必须大于 0" });
      }
      const result = await provider.exchangeHeluShopItem(accountId, slotId, count);
      res.json({
        ok: true,
        ...result,
      });
    } catch (err) {
      sendProviderError(res, err);
    }
  });

  app.post("/api/activity/qingmei/claim", async (req, res) => {
    const accountId = getAuthorizedAccountId(req, res, routeContext);
    if (!accountId) return;

    try {
      if (!requireConnectedAccount(res, provider, accountId, "领取青梅种子失败: 账号未运行"))
        return;

      const result = await provider.claimQingmeiSeeds(accountId);
      let activity = result.activity || null;
      if (!activity) {
        try {
          activity = await provider.getHeluActivity(accountId);
        } catch (_) {
          activity = null;
        }
      }
      res.json({
        ok: true,
        ...result,
        activity,
        qingmei: result.qingmei || activity?.qingmei || null,
      });
    } catch (err) {
      if (isQingmeiClaimAlreadyHandledError(err)) {
        let activity = null;
        try {
          activity = await provider.getHeluActivity(accountId);
        } catch (_) {
          activity = null;
        }
        res.json({
          ok: true,
          alreadyClaimed: true,
          claimedCount: 0,
          activity,
          qingmei: activity?.qingmei || {
            claimed: true,
            claimable: false,
          },
        });
        return;
      }
      sendProviderError(res, err);
    }
  });

  app.post("/api/activity/qingmei/wine/sell", async (req, res) => {
    const accountId = getAuthorizedAccountId(req, res, routeContext);
    if (!accountId) return;

    try {
      if (!requireConnectedAccount(res, provider, accountId, "青梅酿售卖失败: 账号未运行"))
        return;

      const result = await provider.brewAndSellQingmeiWine(accountId, req.body || {});
      res.json({
        ok: true,
        ...result,
      });
    } catch (err) {
      if (isQingmeiWineBusinessError(err)) {
        let activity = null;
        try {
          activity = await provider.getHeluActivity(accountId);
        } catch (_) {
          activity = null;
        }
        res.json({
          ok: false,
          stage: err?.stage || '',
          error: err?.message || '青梅酿售卖失败',
          activity,
          qingmei: activity?.qingmei || null,
        });
        return;
      }
      sendProviderError(res, err);
    }
  });
}

module.exports = { registerAdminHeluActivityRoutes };
