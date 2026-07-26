function registerAdminFriendRoutes({ app, provider }) {
  // POST /api/friend/apply
  // body: { openid: string, reason?: int32, hostType?: int32, shareKey?: string }
  app.post("/api/friend/apply", async (req, res) => {
    const openid = String(req.body?.openid || "").trim();
    if (!openid) {
      return res.json({ ok: false, error: "缺少目标 openid" });
    }
    const opts = {
      reason: req.body?.reason,
      hostType: req.body?.hostType,
      shareKey: req.body?.shareKey,
    };
    try {
      const reply = await provider.applyFriend(null, openid, opts);
      return res.json({ ok: true, data: reply || {} });
    } catch (err) {
      return res.json({ ok: false, error: err?.message || String(err) });
    }
  });
}

module.exports = { registerAdminFriendRoutes };