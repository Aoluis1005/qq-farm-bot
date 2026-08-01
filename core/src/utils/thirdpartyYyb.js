/**
 * 第三方应用宝（YYB）接口 client
 *
 * 第三方自建的 {apiBase}/api/open/v1/farm/code 接口，与内置 yyb-go 生成的是
 * 同一个协议（code 一致、可刷新）。本模块供两处共用：
 *   1) 前端「第三方 YYB 登录」tab —— 首次拿 code 添加账号；
 *   2) worker-manager.refreshYybCodeIfNeeded —— 重连前刷新 code。
 *
 * 第三方请求契约：
 *   POST {apiBase}/api/open/v1/farm/code
 *   Authorization: Bearer <apiToken>
 *   body: { openid, forceRefresh, debug }
 *   成功响应：{ success: true, data: { code, openid } }
 *   失败响应：{ success: false, error: "..." }，无效 token 返回 401
 */
const DEFAULT_TIMEOUT_MS = 10000

/**
 * 规范化第三方 apiBase：去尾部斜杠与用户误带的路径后缀。
 */
function normalizeApiBase(value) {
    let base = String(value || '').trim().replace(/\/+$/, '');
    base = base.replace(/\/api\/open\/v1\/farm\/code$/i, '');
    base = base.replace(/\/api\/open\/v1$/i, '');
    base = base.replace(/\/api\/open$/i, '');
    return base;
}

function isValidHttpUrl(base) {
    return /^https?:\/\//i.test(base);
}

/**
 * 从第三方响应中灵活提取登录 code（兼容多种信封结构）。
 * 返回 string 或 null。
 */
function extractCode(data) {
    if (!data || typeof data !== 'object') return null;
    const tries = [
        data.data && data.data.code,
        data.data && data.data.result && data.data.result.code,
        data.data && data.data.token,
        data.code, // 顶层 code：仅接受字符串，避开 {code:0} 这类状态码
        data.token,
    ];
    for (const c of tries) {
        if (typeof c === 'string' && c.length >= 4) return c;
        if (typeof c === 'number' && c > 0) return String(c);
    }
    return null;
}

function extractOpenid(data) {
    if (!data || typeof data !== 'object') return undefined;
    return (data.data && data.data.openid) || data.openid;
}

function safePreview(data, max = 200) {
    try {
        const s = JSON.stringify(data);
        return s.length > max ? s.slice(0, max) + '…' : s;
    } catch {
        return String(data).slice(0, max);
    }
}

/**
 * 用 openid 向第三方接口换取登录 code
 * @param {{apiBase?:string, apiToken?:string, openid?:string, forceRefresh?:boolean}} params
 * @returns {Promise<{ok:boolean, code?:string, openid?:string, error?:string, status?:number}>}
 */
async function getThirdpartyYybCode({ apiBase, apiToken, openid, forceRefresh = false, debug = false } = {}) {
    const base = normalizeApiBase(apiBase);
    if (!base) return { ok: false, error: '第三方接口地址未配置' };
    if (!isValidHttpUrl(base)) return { ok: false, error: '第三方接口地址必须为 http/https' };
    if (!apiToken) return { ok: false, error: '第三方 API Token 未配置' };
    if (!openid) return { ok: false, error: '缺少 openid' };

    const url = `${base}/api/open/v1/farm/code`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    try {
        const resp = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiToken}`,
            },
            body: JSON.stringify({ openid, forceRefresh, debug }),
            signal: controller.signal,
        });

        if (resp.status === 401) {
            return { ok: false, status: 401, error: '第三方 API Token 无效（401 未授权）' };
        }
        if (!resp.ok) {
            return { ok: false, status: resp.status, error: `第三方接口返回 HTTP ${resp.status}` };
        }

        let data = null;
        try {
            data = await resp.json();
        } catch {
            return { ok: false, error: '第三方接口返回非 JSON' };
        }

        // 兼容多种第三方信封，灵活提取 code
        const code = extractCode(data);
        if (code) {
            return { ok: true, code: String(code), openid: extractOpenid(data) || openid };
        }
        // 第三方返回了，但没有可识别的 code 字段：回显原始响应便于排查
        const preview = safePreview(data);
        return { ok: false, error: `第三方接口未返回 code${preview ? `（响应: ${preview}）` : ''}` };
    } catch (e) {
        if (e && e.name === 'AbortError') {
            return { ok: false, error: `第三方接口请求超时（>${DEFAULT_TIMEOUT_MS}ms）` };
        }
        return { ok: false, error: `第三方接口请求失败: ${e && e.message ? e.message : e}` };
    } finally {
        clearTimeout(timer);
    }
}

module.exports = { getThirdpartyYybCode, normalizeApiBase };
