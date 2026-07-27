/**
 * 生涯统计 管理路由
 *
 * GET /api/career
 *   响应：{ ok: true, data: { items, player } }
 */
function getAccountOrRespond(req, res, { getAccountIdFromRequest, canAccessAccount, includeMissingMessage = true }) {
  const accountId = getAccountIdFromRequest(req);
  if (!accountId) {
    const payload = { ok: false };
    if (includeMissingMessage) payload.error = 'Missing x-account-id';
    res.status(400).json(payload);
    return null;
  }
  if (!canAccessAccount(req, accountId)) {
    res.status(403).json({ ok: false, error: '无权访问此账号' });
    return null;
  }
  return accountId;
}

function registerAdminCareerRoutes({ app, provider, getAccountIdFromRequest, canAccessAccount, sendProviderError }) {
  app.get('/api/career', async (req, res) => {
    const accountId = getAccountOrRespond(req, res, {
      getAccountIdFromRequest,
      canAccessAccount,
      includeMissingMessage: false,
    });
    if (!accountId) return;

    try {
      const data = await provider.getCareerInfo(accountId);
      // career-api 在失败时返回带 error 字段的对象（不抛异常），需透传为 ok:false
      if (data && data.error) {
        res.json({ ok: false, error: data.error });
        return;
      }
      res.json({ ok: true, data });
    } catch (error) {
      sendProviderError(res, error);
    }
  });
}

module.exports = { registerAdminCareerRoutes };