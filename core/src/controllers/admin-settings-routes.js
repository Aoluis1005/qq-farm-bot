function requireAccountAccess(req, res, { getAccountIdFromRequest, canAccessAccount }) {
  const accountId = getAccountIdFromRequest(req);
  if (!accountId) {
    res.status(400).json({ ok: false, error: "Missing x-account-id" });
    return null;
  }
  if (!canAccessAccount(req, accountId)) {
    res.status(403).json({ ok: false, error: "无权访问此账号" });
    return null;
  }
  return accountId;
}

function getOfflineReminderConfig(store, currentUser, body) {
  const saved =
    store.getOfflineReminder && currentUser
      ? store.getOfflineReminder(currentUser.username)
      : {};
  return { ...(saved || {}), ...(body || {}) };
}

async function sendOfflineReminderTest(config) {
  const { sendPushooMessage, sendSmtpEmail } = require("../services/push");
  const channel = String(config.channel || "smtp").trim().toLowerCase();
  if (channel === "smtp") {
    const smtpHost = String(config.smtpHost || "").trim();
    const smtpPort = Number(config.smtpPort) || 465;
    const smtpUser = String(config.smtpUser || "").trim();
    const smtpPass = String(config.smtpPass || "").trim();
    const senderName = String(config.senderName || "").trim();
    const recipientEmail = String(config.recipientEmail || "").trim();
    if (!smtpHost) return { error: "SMTP服务器地址不能为空" };
    if (!smtpUser) return { error: "邮箱账号不能为空" };
    if (!smtpPass) return { error: "授权码不能为空" };
    if (!recipientEmail) return { error: "收件人邮箱不能为空" };

    return sendSmtpEmail({
      smtpHost,
      smtpPort,
      smtpUser,
      smtpPass,
      senderName,
      recipientEmail,
      subject: "下线提醒（测试）",
      content: "这是一封测试邮件，收到它代表你配置邮箱成功了！--For Dot.",
    });
  }

  const endpoint = String(config.endpoint || "").trim();
  const token = String(config.token || "").trim();
  const titleBase = String(config.title || "账号下线提醒").trim();
  const msgBase = String(config.msg || "账号下线").trim();
  if (!channel) return { error: "推送渠道不能为空" };
  if (channel === "webhook" && !endpoint) {
    return { error: "Webhook 渠道需要填写接口地址" };
  }
  if (channel !== "webhook" && !token) {
    return { error: "推送 token 不能为空" };
  }

  const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
  return sendPushooMessage({
    channel,
    endpoint,
    token,
    title: `${titleBase}（测试）`,
    content: `${msgBase}\n\n这是一条下线提醒测试消息。\n时间: ${ts}`,
  });
}

function buildSettingsPayload(store, accountId, currentUser) {
  const accountConfig = accountId && typeof store.getConfigSnapshot === "function"
    ? store.getConfigSnapshot(accountId)
    : {};
  const offlineReminderDefault = {
    smtpHost: "",
    smtpPort: 465,
    smtpUser: "",
    smtpPass: "",
    senderName: "",
    recipientEmail: "",
    emailContent: "",
  };

  return {
    intervals: accountId ? store.getIntervals(accountId) : {},
    plantingStrategy: accountId ? store.getPlantingStrategy(accountId) : null,
    preferredSeedId: accountId ? store.getPreferredSeed(accountId) : null,
    prioritize2x2Crops:
      accountId && typeof store.getPrioritize2x2Crops === "function"
        ? store.getPrioritize2x2Crops(accountId)
        : true,
    friendQuietHours: accountId ? store.getFriendQuietHours(accountId) : null,
    automation: accountId ? store.getAutomation(accountId) : {},
    autoCodeRefresh:
      accountId && typeof store.getAutoCodeRefresh === "function"
        ? store.getAutoCodeRefresh(accountId)
        : { enabled: false, intervalMinutes: 60 },
    stealDelaySeconds:
      accountId && typeof store.getStealDelaySeconds === "function"
        ? store.getStealDelaySeconds(accountId)
        : 0,
    plantOrderRandom:
      accountId && typeof store.getPlantOrderRandom === "function"
        ? store.getPlantOrderRandom(accountId)
        : false,
    plantDelaySeconds:
      accountId && typeof store.getPlantDelaySeconds === "function"
        ? store.getPlantDelaySeconds(accountId)
        : 0,
    fertilizerBuyOrganicCount:
      accountId && typeof store.getFertilizerBuyOrganicCount === "function"
        ? store.getFertilizerBuyOrganicCount(accountId)
        : 0,
    fertilizerBuyOrganicThresholdHours:
      accountId &&
      typeof store.getFertilizerBuyOrganicThresholdHours === "function"
        ? store.getFertilizerBuyOrganicThresholdHours(accountId)
        : 10,
    fertilizerBuyNormalCount:
      accountId && typeof store.getFertilizerBuyNormalCount === "function"
        ? store.getFertilizerBuyNormalCount(accountId)
        : 0,
    fertilizerBuyNormalThresholdHours:
      accountId && typeof store.getFertilizerBuyNormalThresholdHours === "function"
        ? store.getFertilizerBuyNormalThresholdHours(accountId)
        : 10,
    fertilizerBuyCheckIntervalMinutes:
      accountId &&
      typeof store.getFertilizerBuyCheckIntervalMinutes === "function"
        ? store.getFertilizerBuyCheckIntervalMinutes(accountId)
        : 30,
    mysteryAutoBuyCurrencies:
      accountId && typeof store.getMysteryAutoBuyCurrencies === "function"
        ? store.getMysteryAutoBuyCurrencies(accountId)
        : [],
    goldenBugKeepCount: Number(accountConfig.goldenBugKeepCount) || 0,
    goldenBugRoundLimit: Number(accountConfig.goldenBugRoundLimit) || 24,
    autoAcceptFriendMinLevel:
      accountId && typeof store.getAutoAcceptFriendMinLevel === "function"
        ? store.getAutoAcceptFriendMinLevel(accountId)
        : 0,
    bagSeedPriority:
      accountId && typeof store.getBagSeedPriority === "function"
        ? store.getBagSeedPriority(accountId)
        : [],
    bagSeedFallbackStrategy:
      accountId && typeof store.getBagSeedFallbackStrategy === "function"
        ? store.getBagSeedFallbackStrategy(accountId)
        : "level",
    bagPriorityLandTypes:
      accountId && typeof store.getBagPriorityLandTypes === "function"
        ? store.getBagPriorityLandTypes(accountId)
        : ["purple", "gold", "black", "red", "normal"],
    ui: store.getUI(),
    offlineReminder:
      store.getOfflineReminder && currentUser
        ? store.getOfflineReminder(currentUser.username)
        : offlineReminderDefault,
  };
}

function registerAdminSettingsRoutes({
  app,
  provider,
  store,
  logger,
  getAccountIdFromRequest,
  canAccessAccount,
  requireDangerConfirmation,
}) {
  app.get("/api/settings/default-plan", (req, res) => {
    try {
      const currentUser = req.currentUser;
      if (!currentUser) {
        return res.status(401).json({ ok: false, error: "未登录" });
      }
      const data = store.getUserDefaultAccountPlan(currentUser.username);
      res.json({ ok: true, data });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.put("/api/settings/default-plan", (req, res) => {
    try {
      const currentUser = req.currentUser;
      if (!currentUser) {
        return res.status(401).json({ ok: false, error: "未登录" });
      }
      const body = req.body && typeof req.body === "object" ? req.body : {};
      const data = store.setUserDefaultAccountPlan(
        currentUser.username,
        body.config || {},
        { enabled: body.enabled !== false },
      );
      res.json({ ok: true, data });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/settings/default-plan/import", (req, res) => {
    const accountId = requireAccountAccess(req, res, {
      getAccountIdFromRequest,
      canAccessAccount,
    });
    if (!accountId) return;

    try {
      const currentUser = req.currentUser;
      const currentPlan = store.getUserDefaultAccountPlan(currentUser.username);
      const config = store.getConfigSnapshot(accountId);
      const data = store.setUserDefaultAccountPlan(
        currentUser.username,
        config,
        { enabled: currentPlan.enabled !== false },
      );
      res.json({ ok: true, data });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/settings/default-plan/apply", async (req, res) => {
    const accountId = requireAccountAccess(req, res, {
      getAccountIdFromRequest,
      canAccessAccount,
    });
    if (!accountId) return;

    try {
      const currentUser = req.currentUser;
      const data = store.applyUserDefaultAccountPlan(
        currentUser.username,
        accountId,
      );
      if (provider && typeof provider.saveSettings === "function") {
        await provider.saveSettings(accountId, data);
      } else if (provider && typeof provider.broadcastConfig === "function") {
        provider.broadcastConfig(accountId);
      }
      res.json({ ok: true, data });
    } catch (error) {
      const status = error.message === "尚未保存默认方案" ? 400 : 500;
      res.status(status).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/settings/default-plan/reset", (req, res) => {
    try {
      const currentUser = req.currentUser;
      if (!currentUser) {
        return res.status(401).json({ ok: false, error: "未登录" });
      }
      const currentPlan = store.getUserDefaultAccountPlan(currentUser.username);
      const data = store.setUserDefaultAccountPlan(
        currentUser.username,
        store.getDefaultAccountConfig(),
        { enabled: currentPlan.enabled !== false },
      );
      res.json({ ok: true, data });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/settings/save", async (req, res) => {
    const accountId = requireAccountAccess(req, res, {
      getAccountIdFromRequest,
      canAccessAccount,
    });
    if (!accountId) return;

    try {
      const data = await provider.saveSettings(accountId, req.body || {});
      res.json({ ok: true, data: data || {} });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/settings/theme", async (req, res) => {
    try {
      const theme = String((req.body || {}).theme || "");
      const data = await provider.setUITheme(theme);
      res.json({ ok: true, data: data || {} });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/settings/auto-code-refresh", async (req, res) => {
    const accountId = requireAccountAccess(req, res, {
      getAccountIdFromRequest,
      canAccessAccount,
    });
    if (!accountId) return;

    try {
      const data = await provider.saveAutoCodeRefresh(accountId, req.body || {});
      res.json({ ok: true, data: data || {} });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/settings/auto-code-refresh/run", async (req, res) => {
    const accountId = requireAccountAccess(req, res, {
      getAccountIdFromRequest,
      canAccessAccount,
    });
    if (!accountId) return;

    try {
      const data = await provider.refreshAccountCode(accountId);
      res.json({ ok: true, data: data || {} });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/settings/offline-reminder", async (req, res) => {
    try {
      const body = req.body && typeof req.body === "object" ? req.body : {};
      const currentUser = req.currentUser;
      if (!currentUser) {
        return res.status(401).json({ ok: false, error: "未登录" });
      }
      if (
        Number(body.offlineDeleteSec || 0) > 0 &&
        !requireDangerConfirmation(req, res, "ENABLE_OFFLINE_DELETE")
      ) {
        return;
      }

      const data = store.setOfflineReminder
        ? store.setOfflineReminder(body, currentUser.username)
        : {};
      if (Number(body.offlineDeleteSec || 0) > 0) {
        logger.warn("更新下线提醒离线删除设置", {
          user: currentUser.username,
          offlineDeleteSec: Number(body.offlineDeleteSec || 0),
          channel: String(body.channel || ""),
          confirmation: "ENABLE_OFFLINE_DELETE",
        });
      }
      res.json({ ok: true, data: data || {} });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/settings/offline-reminder/test", async (req, res) => {
    try {
      const currentUser = req.currentUser;
      const body = req.body && typeof req.body === "object" ? req.body : {};
      const config = getOfflineReminderConfig(store, currentUser, body);
      const result = await sendOfflineReminderTest(config);
      if (!result) {
        return res
          .status(400)
          .json({ ok: false, error: "发送失败：无返回结果" });
      }
      if (result.error) {
        return res.status(400).json({ ok: false, error: result.error });
      }
      if (result.ok === false) {
        return res.status(400).json({
          ok: false,
          error: result.msg || "发送失败",
          data: result,
        });
      }
      res.json({ ok: true, data: result, message: result.msg || "发送成功" });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.get("/api/settings", async (req, res) => {
    try {
      const accountId = getAccountIdFromRequest(req);
      const currentUser = req.currentUser;
      if (accountId && !canAccessAccount(req, accountId)) {
        return res.status(403).json({ ok: false, error: "无权访问此账号" });
      }
      res.json({
        ok: true,
        data: buildSettingsPayload(store, accountId, currentUser),
      });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.get("/api/settings/default", (req, res) => {
    try {
      const data = store.getDefaultAccountConfig
        ? store.getDefaultAccountConfig()
        : null;
      if (!data) {
        return res.status(500).json({ ok: false, error: "无法获取默认配置" });
      }
      res.json({ ok: true, data });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });
}

module.exports = { registerAdminSettingsRoutes };
