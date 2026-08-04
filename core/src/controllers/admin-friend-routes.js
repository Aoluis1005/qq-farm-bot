const DOG_INFO_HTTP_TIMEOUT_MS = 11 * 60 * 1000;

function getAccountOrRespond(req, res, { getAccountIdFromRequest, canAccessAccount, includeMissingMessage = true }) {
  const accountId = getAccountIdFromRequest(req);
  if (!accountId) {
    const payload = { ok: false };
    if (includeMissingMessage) payload.error = "Missing x-account-id";
    res.status(400).json(payload);
    return null;
  }
  if (!canAccessAccount(req, accountId)) {
    res.status(403).json({ ok: false, error: "无权访问此账号" });
    return null;
  }
  return accountId;
}

async function getFriendMetaByGid(provider, accountId) {
  let friends = [];
  try {
    if (provider && typeof provider.getFriends === "function") {
      friends = (await provider.getFriends(accountId)) || [];
    }
  } catch {}

  const metaByGid = new Map();
  for (const friend of friends) {
    const gid = Number(friend && friend.gid);
    if (gid > 0) {
      metaByGid.set(gid, {
        name: friend.name || friend.remark || "",
        avatarUrl: friend.avatarUrl || friend.avatar_url || "",
      });
    }
  }
  return metaByGid;
}

function formatFriendBlacklist(items, metaByGid) {
  return items.map((item) => {
    const gid = typeof item === "object" && item ? Number(item.gid) : Number(item);
    const meta = metaByGid.get(Number(gid)) || {};
    const skipSteal = typeof item === "object" && item ? item.skipSteal !== false : true;
    const skipHelp = typeof item === "object" && item ? item.skipHelp !== false : true;
    return {
      gid,
      name: meta.name || "",
      avatarUrl: meta.avatarUrl || "",
      skipSteal,
      skipHelp,
    };
  });
}

function getKnownFriendGidsData(store, accountId) {
  return {
    knownFriendGids: store.getKnownFriendGids
      ? store.getKnownFriendGids(accountId)
      : [],
  };
}

function broadcastConfig(provider, accountId) {
  if (provider && typeof provider.broadcastConfig === "function") {
    provider.broadcastConfig(accountId);
  }
}

function registerAdminFriendRoutes({
  app,
  provider,
  store,
  getAccountIdFromRequest,
  canAccessAccount,
  sendProviderError,
}) {
  const access = { getAccountIdFromRequest, canAccessAccount };

  app.get("/api/friends", async (req, res) => {
    const accountId = getAccountOrRespond(req, res, {
      ...access,
      includeMissingMessage: false,
    });
    if (!accountId) return;

    try {
      const forceSync = req.query.forceSync === "true";
      const data = await provider.getFriends(accountId, forceSync);
      res.json({ ok: true, data });
    } catch (error) {
      sendProviderError(res, error);
    }
  });

  app.post("/api/friends/clear-cache", async (req, res) => {
    const accountId = getAccountOrRespond(req, res, access);
    if (!accountId) return;

    try {
      await provider.clearFriendsCache(accountId);
      res.json({ ok: true });
    } catch (error) {
      sendProviderError(res, error);
    }
  });

  app.post("/api/friends/fetch-dog-info", async (req, res) => {
    req.setTimeout(DOG_INFO_HTTP_TIMEOUT_MS);
    res.setTimeout(DOG_INFO_HTTP_TIMEOUT_MS);

    const accountId = getAccountOrRespond(req, res, access);
    if (!accountId) return;

    try {
      const result = await provider.fetchFriendsDogInfo(accountId);
      res.json(result);
    } catch (error) {
      sendProviderError(res, error);
    }
  });

  app.get("/api/interact-records", async (req, res) => {
    const accountId = getAccountIdFromRequest(req);
    if (!accountId) {
      return res.status(400).json({ ok: false, error: "Missing x-account-id" });
    }

    try {
      const data = await provider.getInteractRecords(accountId);
      res.json({ ok: true, data });
    } catch (error) {
      sendProviderError(res, error);
    }
  });

  app.get("/api/friend/:gid/lands", async (req, res) => {
    const accountId = getAccountOrRespond(req, res, {
      ...access,
      includeMissingMessage: false,
    });
    if (!accountId) return;

    try {
      const data = await provider.getFriendLands(accountId, req.params.gid);
      res.json({ ok: true, data });
    } catch (error) {
      sendProviderError(res, error);
    }
  });

  app.post("/api/friend/:gid/op", async (req, res) => {
    const accountId = getAccountOrRespond(req, res, access);
    if (!accountId) return;

    try {
      const opType = String((req.body || {}).opType || "");
      const data = await provider.doFriendOp(accountId, req.params.gid, opType);
      res.json({ ok: true, data });
    } catch (error) {
      sendProviderError(res, error);
    }
  });

  app.get("/api/friend/:gid/dog", async (req, res) => {
    const accountId = getAccountOrRespond(req, res, access);
    if (!accountId) return;

    try {
      const data = await provider.getFriendDogInfo(accountId, req.params.gid);
      res.json({ ok: true, data });
    } catch (error) {
      sendProviderError(res, error);
    }
  });

  app.post("/api/friend/batch-delete", async (req, res) => {
    const accountId = getAccountOrRespond(req, res, access);
    if (!accountId) return;

    const gids = Array.isArray(req.body?.gids)
      ? req.body.gids.map(Number).filter(Boolean)
      : [];
    if (gids.length === 0) {
      return res.status(400).json({ ok: false, error: "请提供要删除的好友 GID 列表" });
    }

    const password = String(req.body?.password || "").trim();

    const success = [];
    const failed = [];
    for (const gid of gids) {
      try {
        await provider.delFriend(accountId, gid);
        success.push(gid);
      } catch (error) {
        failed.push({ gid, error: error?.message || String(error) });
      }
    }
    res.json({
      ok: true,
      success,
      failed,
      successCount: success.length,
      failedCount: failed.length,
      hasPassword: !!password,
    });
  });

  app.post("/api/friend/:gid/delete", async (req, res) => {
    const accountId = getAccountOrRespond(req, res, access);
    if (!accountId) return;

    try {
      const gid = Number(req.params.gid);
      if (!gid) {
        return res.status(400).json({ ok: false, error: "无效的好友 GID" });
      }

      await provider.delFriend(accountId, gid);
      res.json({ ok: true, message: "删除好友成功" });
    } catch (error) {
      sendProviderError(res, error);
    }
  });

  app.post("/api/friend/apply", async (req, res) => {
    const accountId = getAccountOrRespond(req, res, access);
    if (!accountId) return;

    try {
      // 加好友按 gid 发起（真实协议：ApplyFriend 请求体只含 gid + token，不含 openid）
      const gid = Number((req.body || {}).gid);
      if (!gid || !Number.isFinite(gid)) {
        return res.status(400).json({ ok: false, error: "请提供目标 gid" });
      }

      // skipEnter 默认走第一种流程（跳过 Enter）；仅显式传 false 才回到 Enter 前置流程。
      // 不能在未传时强制传 false，否则会覆盖 applyFriend 的默认值。
      let skipEnter; // undefined => 交给 applyFriend 默认（true）
      const rawSkip = req.body?.skipEnter;
      if (rawSkip === false || rawSkip === 'false') skipEnter = false;
      else if (rawSkip === true || rawSkip === 'true') skipEnter = true;

      const opts = {
        visitToken: req.body?.visitToken,
        enterReason: req.body?.enterReason,
        skipEnter,
      };
      const data = await provider.applyFriend(accountId, gid, opts);
      res.json({ ok: true, data });
    } catch (error) {
      // 游戏业务错误（如 code=1005024 分享链接已过期 / 1002007 未开拜访开关）以 200 + 结构化
      // 返回，前端可解析 code 做友好展示，避免触发通用 500 错误提示。
      const message = String(error?.message || error || "加好友失败");
      const codeMatch = message.match(/code=(\d+)/);
      const code = codeMatch ? Number(codeMatch[1]) : 0;
      // 提取纯净的游戏错误文案（去掉 "服务名.方法名 错误: code=xxx " 前缀）
      const cleanMatch = message.match(/code=\d+\s*(.*)$/);
      const cleanError = cleanMatch && cleanMatch[1] ? cleanMatch[1].trim() : message;
      if (code > 0) {
        return res.json({ ok: false, code, error: cleanError, rawError: message });
      }
      sendProviderError(res, error);
    }
  });

  app.get("/api/friend-blacklist", async (req, res) => {
    const accountId = getAccountOrRespond(req, res, access);
    if (!accountId) return;

    const list = store.getFriendBlacklistDetails
      ? store.getFriendBlacklistDetails(accountId)
      : [];
    const metaByGid = await getFriendMetaByGid(provider, accountId);
    res.json({
      ok: true,
      data: formatFriendBlacklist(list, metaByGid),
    });
  });

  app.post("/api/friend-blacklist/toggle", async (req, res) => {
    const accountId = getAccountOrRespond(req, res, access);
    if (!accountId) return;

    const gid = Number((req.body || {}).gid);
    if (!gid) {
      return res.status(400).json({ ok: false, error: "Missing gid" });
    }
    const body = req.body || {};
    const list = store.getFriendBlacklistDetails
      ? store.getFriendBlacklistDetails(accountId)
      : [];
    const existing = list.find((w) => w.gid === gid);
    let nextList;
    if (existing) {
      nextList = list.filter((w) => w.gid !== gid);
    } else {
      const skipSteal = typeof body.skipSteal === "boolean" ? body.skipSteal : true;
      const skipHelp = typeof body.skipHelp === "boolean" ? body.skipHelp : true;
      nextList = [...list, { gid, skipSteal, skipHelp }];
    }
    const saved = store.setFriendBlacklist
      ? store.setFriendBlacklist(accountId, nextList)
      : nextList;
    if (provider && typeof provider.broadcastConfig === "function") {
      provider.broadcastConfig(accountId);
    }

    const metaByGid = await getFriendMetaByGid(provider, accountId);
    res.json({
      ok: true,
      added: !existing,
      data: formatFriendBlacklist(saved, metaByGid),
    });
  });

  app.post("/api/friend-blacklist/update", async (req, res) => {
    const accountId = getAccountOrRespond(req, res, access);
    if (!accountId) return;

    const gid = Number((req.body || {}).gid);
    if (!gid) {
      return res.status(400).json({ ok: false, error: "Missing gid" });
    }
    const body = req.body || {};
    const opts = {};
    if (typeof body.skipSteal === "boolean") opts.skipSteal = body.skipSteal;
    if (typeof body.skipHelp === "boolean") opts.skipHelp = body.skipHelp;
    const updated = store.updateBlacklistItem
      ? store.updateBlacklistItem(accountId, gid, opts)
      : false;
    if (provider && typeof provider.broadcastConfig === "function") {
      provider.broadcastConfig(accountId);
    }
    const list = store.getFriendBlacklistDetails
      ? store.getFriendBlacklistDetails(accountId)
      : [];
    const metaByGid = await getFriendMetaByGid(provider, accountId);
    res.json({
      ok: true,
      updated,
      data: formatFriendBlacklist(list, metaByGid),
    });
  });

  app.get("/api/friend-known-gids", (req, res) => {
    const accountId = getAccountOrRespond(req, res, access);
    if (!accountId) return;

    try {
      res.json({ ok: true, data: getKnownFriendGidsData(store, accountId) });
    } catch (error) {
      sendProviderError(res, error);
    }
  });

  app.post("/api/friend-known-gids", (req, res) => {
    const accountId = getAccountOrRespond(req, res, access);
    if (!accountId) return;

    try {
      const body = req.body && typeof req.body === "object" ? req.body : {};
      if (body.knownFriendGids !== undefined && store.setKnownFriendGids) {
        store.setKnownFriendGids(accountId, body.knownFriendGids);
      }
      broadcastConfig(provider, accountId);
      res.json({ ok: true, data: getKnownFriendGidsData(store, accountId) });
    } catch (error) {
      sendProviderError(res, error);
    }
  });

  app.post("/api/friend-known-gids/remove", (req, res) => {
    const accountId = getAccountOrRespond(req, res, access);
    if (!accountId) return;

    const gid = Number((req.body || {}).gid);
    if (!Number.isFinite(gid) || gid <= 0) {
      return res.status(400).json({ ok: false, error: "GID 无效" });
    }

    try {
      const knownGids = store.getKnownFriendGids
        ? store.getKnownFriendGids(accountId)
        : [];
      const nextKnownGids = Array.isArray(knownGids)
        ? knownGids.filter((item) => Number(item) !== gid)
        : [];
      if (store.setKnownFriendGids) {
        store.setKnownFriendGids(accountId, nextKnownGids);
      }
      broadcastConfig(provider, accountId);
      res.json({ ok: true, data: getKnownFriendGidsData(store, accountId) });
    } catch (error) {
      sendProviderError(res, error);
    }
  });

  app.post("/api/friend-known-gids/batch-add", async (req, res) => {
    const accountId = getAccountOrRespond(req, res, access);
    if (!accountId) return;

    const gids = (req.body || {}).gids;
    if (!Array.isArray(gids) || gids.length === 0) {
      return res.status(400).json({ ok: false, error: "GID 列表无效" });
    }

    try {
      const knownGids = store.getKnownFriendGids
        ? store.getKnownFriendGids(accountId)
        : [];
      const nextKnownGids = new Set(knownGids.map(Number));
      let addedCount = 0;
      for (const rawGid of gids) {
        const gid = Number(rawGid);
        if (!Number.isFinite(gid) || gid <= 0) continue;
        if (!nextKnownGids.has(gid)) {
          nextKnownGids.add(gid);
          addedCount++;
        }
      }

      if (store.setKnownFriendGids) {
        store.setKnownFriendGids(accountId, Array.from(nextKnownGids));
      }
      broadcastConfig(provider, accountId);
      res.json({
        ok: true,
        data: getKnownFriendGidsData(store, accountId),
        addedCount,
        message:
          addedCount > 0
            ? '已添加好友GID，请点击"刷新列表"获取好友信息，然后点击"获取狗信息"获取狗信息。处理中请勿频繁访问好友界面。'
            : "",
      });
    } catch (error) {
      sendProviderError(res, error);
    }
  });

  app.post("/api/friend-known-gids/batch-remove", (req, res) => {
    const accountId = getAccountOrRespond(req, res, access);
    if (!accountId) return;

    const gids = (req.body || {}).gids;
    if (!Array.isArray(gids) || gids.length === 0) {
      return res.json({
        ok: true,
        data: getKnownFriendGidsData(store, accountId),
        removedCount: 0,
      });
    }

    try {
      const knownGids = store.getKnownFriendGids
        ? store.getKnownFriendGids(accountId)
        : [];
      const gidSet = new Set(
        gids.map(Number).filter((gid) => Number.isFinite(gid) && gid > 0),
      );
      const nextKnownGids = knownGids.filter(
        (gid) => !gidSet.has(Number(gid)),
      );
      const removedCount = knownGids.length - nextKnownGids.length;
      if (removedCount > 0 && store.setKnownFriendGids) {
        store.setKnownFriendGids(accountId, nextKnownGids);
      }
      res.json({
        ok: true,
        data: getKnownFriendGidsData(store, accountId),
        removedCount,
      });
    } catch (error) {
      sendProviderError(res, error);
    }
  });
}

module.exports = { registerAdminFriendRoutes };
