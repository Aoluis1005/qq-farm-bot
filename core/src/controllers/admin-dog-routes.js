/**
 * 护主犬奖励（同气礼包）管理接口
 * - GET  /api/dog/gifts     查询当前可领同气礼包数量
 * - POST /api/dog/gifts/claim  领取同气礼包
 *
 * 【2026-08-05 抓包实锤】协议 = DogService.GetDogInfo / DogService.ClaimSkillGifts（均无参）
 */
function getAccountOrRespond(req, res, { getAccountIdFromRequest, canAccessAccount }) {
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

function registerAdminDogRoutes({
  app,
  provider,
  getAccountIdFromRequest,
  canAccessAccount,
  sendProviderError,
}) {
  const access = { getAccountIdFromRequest, canAccessAccount };

  app.get("/api/dog/gifts", async (req, res) => {
    const accountId = getAccountOrRespond(req, res, access);
    if (!accountId) return;

    try {
      const data = await provider.getDogGiftStatus(accountId);
      res.json({ ok: true, data });
    } catch (error) {
      sendProviderError(res, error);
    }
  });

  app.post("/api/dog/gifts/claim", async (req, res) => {
    const accountId = getAccountOrRespond(req, res, access);
    if (!accountId) return;

    try {
      const data = await provider.claimDogGifts(accountId);
      res.json({ ok: true, data });
    } catch (error) {
      // 游戏业务错误（code=xxx）以 200 + 结构化返回，前端可解析 code
      const message = String(error?.message || error || "领取同气礼包失败");
      const codeMatch = message.match(/code=(\d+)/);
      const code = codeMatch ? Number(codeMatch[1]) : 0;
      if (code > 0) {
        return res.json({ ok: false, code, error: message });
      }
      sendProviderError(res, error);
    }
  });
}

module.exports = { registerAdminDogRoutes };
