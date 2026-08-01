function createLogQuery(query) {
  return {
    limit: Number.parseInt(query.limit) || 100,
    tag: query.tag || "",
    module: query.module || "",
    event: query.event || "",
    keyword: query.keyword || "",
    isWarn: query.isWarn,
    timeFrom: query.timeFrom || "",
    timeTo: query.timeTo || "",
  };
}

function isAdminUser(user) {
  return user && (user.role === "admin" || user.role === "super_admin");
}

function hasWxRefreshIdentity(account) {
  return !!String((account && account.wxid) || "").trim();
}

function registerAdminAccountRoutes({
  app,
  provider,
  getIo,
  addOrUpdateAccount,
  deleteAccount,
  findAccountByRef,
  getAccountsForUser,
  getAccountIdFromRequest,
  resolveAccountReference,
  canAccessAccount,
  getAccessibleAccountIdsFromRequest,
  userStore,
  sendProviderError,
}) {
  app.get("/api/accounts", (req, res) => {
    try {
      const currentUser = req.currentUser;
      let data;
      if (currentUser) {
        const accounts = provider.getAccounts();
        data =
          currentUser.role === "admin" || currentUser.role === "super_admin"
            ? accounts
            : {
                ...accounts,
                accounts: accounts.accounts.filter(
                  (account) => account.username === currentUser.username,
                ),
              };
      } else {
        data = { accounts: [], nextId: 1 };
      }
      // 脱敏：第三方应用宝配置的 apiToken 不外泄到前端
      if (data && Array.isArray(data.accounts)) {
        data = {
          ...data,
          accounts: data.accounts.map((a) => {
            if (a && a.thirdparty && a.thirdparty.apiToken) {
              return { ...a, thirdparty: { ...a.thirdparty, apiToken: "***" } };
            }
            return a;
          }),
        };
      }
      res.json({ ok: true, data });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/accounts/refresh-wx-codes", async (req, res) => {
    try {
      const currentUser = req.currentUser;
      if (!currentUser) {
        return res.status(401).json({ ok: false, error: "未登录" });
      }
      if (!provider || typeof provider.refreshAccountCode !== "function") {
        return res.status(500).json({ ok: false, error: "自动刷新服务不可用" });
      }

      const allAccounts = getAccountsForUser();
      const accessibleAccounts = isAdminUser(currentUser)
        ? allAccounts
        : allAccounts.filter(
            (account) => account && account.username === currentUser.username,
          );
      const targetAccounts = accessibleAccounts.filter(hasWxRefreshIdentity);

      if (targetAccounts.length === 0) {
        return res.json({
          ok: false,
          error: "没有可刷新的微信账号",
          data: { total: 0, success: 0, failed: 0, skipped: accessibleAccounts.length },
        });
      }

      const results = [];
      for (const account of targetAccounts) {
        try {
          const result = await provider.refreshAccountCode(account.id);
          const success = result && result.ok !== false;
          results.push({
            accountId: account.id,
            name: account.name || account.nick || account.id,
            ok: success,
            error: success ? "" : "刷新失败",
          });
        } catch (error) {
          results.push({
            accountId: account.id,
            name: account.name || account.nick || account.id,
            ok: false,
            error: error.message || "刷新失败",
          });
        }
      }

      const success = results.filter((item) => item.ok).length;
      const failed = results.length - success;
      res.json({
        ok: failed === 0,
        data: {
          total: results.length,
          success,
          failed,
          skipped: accessibleAccounts.length - targetAccounts.length,
          results,
        },
      });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/account/remark", (req, res) => {
    try {
      const body = req.body && typeof req.body === "object" ? req.body : {};
      const accountRef =
        body.id || body.accountId || body.uin || req.headers["x-account-id"];
      const account = findAccountByRef(getAccountsForUser(), accountRef);
      if (!account || !account.id) {
        return res.status(404).json({ ok: false, error: "Account not found" });
      }

      const remark = String(
        body.remark !== undefined ? body.remark : body.name || "",
      ).trim();
      if (!remark) {
        return res.status(400).json({ ok: false, error: "Missing remark" });
      }

      const accountId = String(account.id);
      const data = addOrUpdateAccount({ id: accountId, name: remark });
      if (provider && typeof provider.setRuntimeAccountName === "function") {
        provider.setRuntimeAccountName(accountId, remark);
      }
      if (provider && provider.addAccountLog) {
        provider.addAccountLog("update", `更新账号备注: ${  remark}`, accountId, remark);
      }
      res.json({ ok: true, data });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/accounts", (req, res) => {
    try {
      const body = req.body && typeof req.body === "object" ? req.body : {};
      const currentUser = req.currentUser;
      const isUpdate = !!body.id;
      const isAdmin =
        currentUser &&
        (currentUser.role === "admin" || currentUser.role === "super_admin");

      if (isUpdate && currentUser && !isAdmin) {
        if (!canAccessAccount(req, resolveAccountReference(body.id))) {
          return res.status(403).json({ ok: false, error: "无权访问此账号" });
        }
      }

      if (!isUpdate && currentUser && !isAdmin) {
        const accountCount = getAccountsForUser(currentUser.username).length;
        const accountLimit =
          currentUser.accountLimit || userStore.DEFAULT_ACCOUNT_LIMIT || 2;
        if (accountCount >= accountLimit) {
          return res.status(403).json({
            ok: false,
            error: `账号数量已达上限（${  accountLimit  }个），请购买额度卡密增加额度`,
          });
        }
      }

      const resolvedId = isUpdate ? resolveAccountReference(body.id) : "";
      const nextAccount = isUpdate
        ? { ...body, id: resolvedId || String(body.id) }
        : body;

      let wasRunning = false;
      if (isUpdate && provider.isAccountRunning) {
        wasRunning = provider.isAccountRunning(nextAccount.id);
      }

      let onlyRenaming = false;
      if (isUpdate) {
        const accounts = provider.getAccounts();
        const existing = accounts.accounts.find(
          (account) => account.id === nextAccount.id,
        );
        if (existing) {
          const keys = Object.keys(nextAccount);
          onlyRenaming =
            keys.length === 2 && keys.includes("id") && keys.includes("name");
        }
      }

      if (!isUpdate && currentUser) nextAccount.username = currentUser.username;
      const data = addOrUpdateAccount(nextAccount);
      if (provider.addAccountLog) {
        const accountId = isUpdate
          ? String(nextAccount.id)
          : String((data.accounts.at(-1) || {}).id || "");
        const name = nextAccount.name || "";
        provider.addAccountLog(
          isUpdate ? "update" : "add",
          (isUpdate ? "更新账号: " : "添加账号: ") + (name || accountId),
          accountId,
          name,
        );
      }

      if (!isUpdate) {
        const created = data.accounts.at(-1);
        if (created) provider.startAccount(created.id);
      } else if (wasRunning && !onlyRenaming) {
        provider.restartAccount(nextAccount.id);
      }

      res.json({ ok: true, data });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.delete("/api/accounts/:id", (req, res) => {
    try {
      const accountId =
        resolveAccountReference(req.params.id) || String(req.params.id || "");
      if (!canAccessAccount(req, accountId)) {
        return res.status(403).json({ ok: false, error: "无权访问此账号" });
      }

      const accounts = provider.getAccounts();
      const account = findAccountByRef(accounts.accounts || [], req.params.id);
      provider.stopAccount(accountId);
      const data = deleteAccount(accountId);
      if (provider.addAccountLog) {
        provider.addAccountLog(
          "delete",
          `删除账号: ${  (account && account.name) || req.params.id}`,
          accountId,
          account ? account.name : "",
        );
      }
      res.json({ ok: true, data });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.get("/api/account-logs", (req, res) => {
    try {
      const limit = Number.parseInt(req.query.limit) || 100;
      const currentUser = req.currentUser;
      const requestedAccountId = getAccountIdFromRequest(req);
      let logs = provider.getAccountLogs ? provider.getAccountLogs(limit) : [];
      if (!Array.isArray(logs)) logs = [];
      if (requestedAccountId) {
        if (!canAccessAccount(req, requestedAccountId)) {
          return res.status(403).json({ ok: false, error: "无权访问此账号" });
        }
        logs = logs.filter((log) => {
          const accountId = String(log.accountId || log.id || "");
          return accountId === requestedAccountId;
        });
      }
      if (currentUser) {
        const accessibleIds = getAccessibleAccountIdsFromRequest(req);
        logs = logs.filter((log) => {
          const accountId = log.accountId || log.id;
          return accessibleIds.includes(accountId);
        });
      }
      res.json(logs);
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.get("/api/logs", (req, res) => {
    const requestedAccountId = (req.query.accountId || "").toString().trim();
    const accountId = requestedAccountId
      ? requestedAccountId === "all"
        ? ""
        : resolveAccountReference(requestedAccountId)
      : getAccountIdFromRequest(req);
    const currentUser = req.currentUser;
    if (!currentUser) {
      return res.status(401).json({ ok: false, error: "未登录" });
    }
    if (accountId && !canAccessAccount(req, accountId)) {
      return res.status(403).json({ ok: false, error: "无权访问此账号" });
    }

    if (!accountId) {
      const accessibleIds = getAccessibleAccountIdsFromRequest(req);
      const mergedLogs = [];
      const query = createLogQuery(req.query);
      for (const accessibleId of accessibleIds) {
        const logs = provider.getLogs(accessibleId, query);
        if (Array.isArray(logs)) mergedLogs.push(...logs);
      }
      mergedLogs.sort((a, b) => (b.time || 0) - (a.time || 0));
      return res.json({ ok: true, data: mergedLogs.slice(0, query.limit) });
    }

    const query = createLogQuery(req.query);
    const logs = provider.getLogs(accountId, query);
    res.json({ ok: true, data: logs });
  });

  app.delete("/api/logs", (req, res) => {
    const accountId = getAccountIdFromRequest(req);
    if (!accountId) {
      return res
        .status(400)
        .json({ ok: false, error: "Missing x-account-id" });
    }
    if (!canAccessAccount(req, accountId)) {
      return res.status(403).json({ ok: false, error: "无权访问此账号" });
    }

    try {
      const data = provider.clearLogs(accountId);
      const io = getIo();
      if (io && provider && typeof provider.getLogs === "function") {
        const accountLogs = provider.getLogs(accountId, { limit: 100 });
        io.to(`account:${  accountId}`).emit("logs:snapshot", {
          accountId,
          logs: Array.isArray(accountLogs) ? accountLogs : [],
        });
        const allLogs = provider.getLogs("", { limit: 100 });
        io.to("account:all").emit("logs:snapshot", {
          accountId: "all",
          logs: Array.isArray(allLogs) ? allLogs : [],
        });
      }
      res.json({ ok: true, data });
    } catch (error) {
      sendProviderError(res, error);
    }
  });
}

module.exports = { registerAdminAccountRoutes };
