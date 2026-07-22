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

function formatFriendBlacklist(gids, metaByGid) {
  return gids.map((gid) => {
    const meta = metaByGid.get(Number(gid)) || {};
    return {
      gid: Number(gid),
      name: meta.name || "",
      avatarUrl: meta.avatarUrl || "",
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

  app.get("/api/friend-blacklist", async (req, res) => {
    const accountId = getAccountOrRespond(req, res, access);
    if (!accountId) return;

    const blacklist = store.getFriendBlacklist
      ? store.getFriendBlacklist(accountId)
      : [];
    const metaByGid = await getFriendMetaByGid(provider, accountId);
    res.json({
      ok: true,
      data: formatFriendBlacklist(blacklist, metaByGid),
    });
  });

  app.post("/api/friend-blacklist/toggle", async (req, res) => {
    const accountId = getAccountOrRespond(req, res, access);
    if (!accountId) return;

    const gid = Number((req.body || {}).gid);
    if (!gid) {
      return res.status(400).json({ ok: false, error: "Missing gid" });
    }

    const blacklist = store.getFriendBlacklist
      ? store.getFriendBlacklist(accountId)
      : [];
    const nextBlacklist = blacklist.includes(gid)
      ? blacklist.filter((item) => item !== gid)
      : [...blacklist, gid];
    const saved = store.setFriendBlacklist
      ? store.setFriendBlacklist(accountId, nextBlacklist)
      : nextBlacklist;
    if (provider && typeof provider.broadcastConfig === "function") {
      provider.broadcastConfig(accountId);
    }

    const metaByGid = await getFriendMetaByGid(provider, accountId);
    res.json({
      ok: true,
      data: formatFriendBlacklist(saved, metaByGid),
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
