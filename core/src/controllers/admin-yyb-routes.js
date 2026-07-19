/**
 * 应用宝（YYB Go）代理路由
 *
 * 代理前端调应用宝接口，避免浏览器跨域 + 保护 apiKey 不暴露。
 * 接口规范：
 *   GET  {apiBase}/accounts          — 列出应用宝账号
 *   POST {apiBase}/wxapp/getCode     — 用 openid 换小程序 code（登录凭证）
 *
 * 鉴权：应用宝接口要求 Header Authorization: Bearer {apiKey}
 */

const DEFAULT_APP_ID = "wx5306c5978fdb76e4";

/**
 * 规范化 apiBase：去掉尾部斜杠，以及用户可能误带的 /wxapp/getCode 等路径后缀。
 * 用户在前端可能填 "http://x.x.x.x:8000/wxapp/getCode"（完整接口地址），
 * 这里统一还原为基准地址 "http://x.x.x.x:8000"，再拼接具体 path。
 */
function normalizeApiBase(value) {
  let base = String(value || "").trim().replace(/\/+$/, "");
  // 去掉用户可能误带的已知路径后缀
  base = base.replace(/\/wxapp\/getCode$/i, "");
  base = base.replace(/\/wxapp$/i, "");
  base = base.replace(/\/accounts$/i, "");
  return base;
}

/**
 * 解析应用宝连接凭据：优先用请求体里的 apiBase/apiKey（前端手动填写），
 * 未传时回退到容器内环境变量 YYB_API_URL / YYB_API_KEY（单镜像部署时由
 * docker-compose 注入，指向同容器内的 yyb-go 服务，无需前端再填外部地址）。
 */
function resolveYybCreds(body = {}) {
  return {
    apiBase: (body.apiBase || "").trim() || process.env.YYB_API_URL || "",
    apiKey: (body.apiKey || "").trim() || process.env.YYB_API_KEY || "",
  };
}

/**
 * 统一调用应用宝接口的 helper
 * @returns {Promise<{ok:boolean, data?:any, error?:string, yybCode?:number}>}
 */
async function callYybApi(apiBase, path, apiKey, init = {}) {
  const base = normalizeApiBase(apiBase);
  if (!base) return { ok: false, error: "应用宝接口地址未配置" };
  if (!apiKey) return { ok: false, error: "应用宝 API Token 未配置" };

  const url = `${base}${path}`;
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    ...(init.headers || {}),
  };
  if (init.body && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  try {
    const resp = await fetch(url, { ...init, headers });
    let data = null;
    try {
      data = await resp.json();
    } catch {
      return { ok: false, error: `应用宝接口返回非 JSON（HTTP ${resp.status}）` };
    }

    // 应用宝统一响应：{ code:0, msg, data }
    if (data && typeof data === "object" && "code" in data) {
      if (data.code !== 0) {
        return { ok: false, error: data.msg || `应用宝接口错误 code=${data.code}`, yybCode: data.code };
      }
      return { ok: true, data: data.data };
    }
    // 非 envelope 响应，直接返回
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: `应用宝接口请求失败: ${e.message}` };
  }
}

function registerAdminYybRoutes({ app, requireAdminToken, sendProviderError }) {
  // 拉应用宝账号列表
  app.post("/api/yyb/accounts", requireAdminToken, async (req, res) => {
    const { apiBase, apiKey } = resolveYybCreds(req.body);
    const result = await callYybApi(apiBase, "/accounts", apiKey, { method: "GET" });
    if (!result.ok) {
      return res.status(400).json({ ok: false, error: result.error, yybCode: result.yybCode });
    }
    const accounts = Array.isArray(result.data) ? result.data : [];
    res.json({ ok: true, data: accounts });
  });

  // 用 openid 换 code
  app.post("/api/yyb/getcode", requireAdminToken, async (req, res) => {
    const { apiBase, apiKey, openid, appId } = resolveYybCreds(req.body);
    if (!openid) {
      return res.status(400).json({ ok: false, error: "缺少 openid" });
    }
    const finalAppId = appId || DEFAULT_APP_ID;
    const result = await callYybApi(apiBase, "/wxapp/getCode", apiKey, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ref: openid, app_id: finalAppId }),
    });
    if (!result.ok) {
      return res.status(400).json({ ok: false, error: result.error, yybCode: result.yybCode });
    }
    // data 结构：{ openid, result: { code, errMsg } }
    const data = result.data || {};
    const code = data.result && data.result.code;
    if (!code) {
      return res.status(500).json({ ok: false, error: "应用宝接口未返回 code" });
    }
    res.json({ ok: true, data: { code, openid: data.openid || openid } });
  });

  // ==================== 应用宝扫码登录 ====================
  // 应用宝 QR 接口：创建会话 → 长轮询状态 → 确认授权 → 账号入库

  // 创建扫码会话（返回 base64 二维码）
  app.post("/api/yyb/qr/create", requireAdminToken, async (req, res) => {
    const { apiBase, apiKey } = resolveYybCreds(req.body);
    const result = await callYybApi(apiBase, "/qr?as_base64=true", apiKey, { method: "POST" });
    if (!result.ok) {
      return res.status(400).json({ ok: false, error: result.error, yybCode: result.yybCode });
    }
    // data: { session_id, status, image_base64, image_url }
    res.json({ ok: true, data: result.data });
  });

  // 长轮询扫码状态（前端需设较长 timeout，如 30s；后端给 65s 保护避免无限 hold）
  app.post("/api/yyb/qr/poll", requireAdminToken, async (req, res) => {
    const { apiBase, apiKey, sessionId } = resolveYybCreds(req.body);
    if (!sessionId) {
      return res.status(400).json({ ok: false, error: "缺少 sessionId" });
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 65000);
    try {
      const result = await callYybApi(apiBase, `/qr/${encodeURIComponent(sessionId)}/poll`, apiKey, {
        method: "GET",
        signal: controller.signal,
      });
      if (!result.ok) {
        return res.status(400).json({ ok: false, error: result.error, yybCode: result.yybCode });
      }
      // data: { status: pending|scanned|authorized|confirmed|expired|cancelled, errcode? }
      res.json({ ok: true, data: result.data });
    } finally {
      clearTimeout(timeout);
    }
  });

  // 确认授权（status=authorized 后调用，把账号保存到应用宝服务端）
  app.post("/api/yyb/qr/confirm", requireAdminToken, async (req, res) => {
    const { apiBase, apiKey, sessionId } = resolveYybCreds(req.body);
    if (!sessionId) {
      return res.status(400).json({ ok: false, error: "缺少 sessionId" });
    }
    const result = await callYybApi(apiBase, `/qr/${encodeURIComponent(sessionId)}/confirm`, apiKey, { method: "POST" });
    if (!result.ok) {
      return res.status(400).json({ ok: false, error: result.error, yybCode: result.yybCode });
    }
    // confirm 成功后 data 里通常包含新账号信息（openid 等）
    res.json({ ok: true, data: result.data });
  });
}

module.exports = { registerAdminYybRoutes };
