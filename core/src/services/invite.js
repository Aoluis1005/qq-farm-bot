/**
 * 邀请服务 - 处理邀请码（微信平台专用）
 *
 * 功能：
 * - 解析共享链接中的 UID/OpenID/ShareKey
 * - 通过 ReportArkClick 发送好友申请
 * - 自动处理 share.txt 中的邀请码
 *
 * 【2026-08-05 抓包解密实锤】发送好友申请的请求 = UserService.ReportArkClick，
 * 真实客户端 body（解密自 flow 937）：
 *   field1 sharer_id      = 卡主 gid
 *   field2 sharer_open_id = 卡主 openid
 *   field3 "1008"         = 分享配置 ID（固定字符串）
 *   field4 7              = 场景参数（固定 varint）
 *   field5 share_key      = 卡主分享卡的 32hex share_key（★关键字段，旧实现缺失）
 * 旧的 invite.js 用 proto encode 只发了 sharer_id/open_id/share_cfg_id/scene_id，
 * 缺 field5 share_key 且字段值与真实客户端不一致 → 服务端不触发好友申请。
 */
const { CONFIG } = require('../config/config');
const { getShareFilePath } = require('../config/runtime-paths');
const { sendMsgAsync } = require('../utils/network');
const { log, logWarn, sleep } = require('../utils/utils');
const { readTextFile, writeTextFileAtomic } = require('./json-db');

// 每次申请间隔：2秒
const INVITE_REQUEST_DELAY = 2000;

function varintBytes(n) {
  const out = [];
  let v = Number(n) >>> 0;
  while (true) {
    let b = v & 0x7f;
    v >>>= 7;
    if (v) out.push(b | 0x80);
    else { out.push(b); break; }
  }
  return Buffer.from(out);
}

/**
 * 从 URL 参数中解析分享信息
 */
function parseShareLink(raw) {
  const result = { uid: null, openid: null, shareKey: null, shareSource: null, docId: null };
  const params = raw.startsWith('?') ? raw.slice(1) : raw;
  const searchParams = new URLSearchParams(params);
  result.uid = searchParams.get('uid');
  result.openid = searchParams.get('openid');
  result.shareKey = searchParams.get('share_key');
  result.shareSource = searchParams.get('share_source');
  result.docId = searchParams.get('doc_id');
  return result;
}

/**
 * 读取 share.txt，去重后返回邀请码列表
 */
function readShareFile() {
  const filePath = getShareFilePath();
  try {
    const content = readTextFile(filePath, '');
    const lines = content
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && l.includes('openid='));

    const results = [];
    const seenUids = new Set();
    for (const line of lines) {
      const parsed = parseShareLink(line);
      if (parsed.openid && parsed.uid && !seenUids.has(parsed.uid)) {
        seenUids.add(parsed.uid);
        results.push(parsed);
      }
    }
    return results;
  } catch (err) {
    logWarn('邀请', `读取 share.txt 失败: ${err.message}`);
    return [];
  }
}

/**
 * 向指定用户发送好友申请（通过 ReportArkClick，照抓包字节手工构造）
 * 参数：卡主 uid / 卡主 openid / 卡主 share_key（32hex）
 */
async function sendReportArkClick(uid, openId, shareKey) {
  const openBuf = Buffer.from(String(openId || ''), 'utf8');
  const cfgBuf = Buffer.from('1008'); // field3 固定 "1008"
  const keyBuf = Buffer.from(String(shareKey || ''), 'utf8');
  const payload = Buffer.concat([
    Buffer.concat([Buffer.from([0x08]), varintBytes(uid)]),            // f1 sharer_id
    Buffer.concat([Buffer.from([0x12, openBuf.length]), openBuf]),     // f2 sharer_open_id
    Buffer.concat([Buffer.from([0x1a, cfgBuf.length]), cfgBuf]),       // f3 "1008"
    Buffer.from([0x20, 7]),                                            // f4 7
    Buffer.concat([Buffer.from([0x2a, keyBuf.length]), keyBuf]),       // f5 share_key
  ]);
  const { body } = await sendMsgAsync('gamepb.userpb.UserService', 'ReportArkClick', payload);
  return { ok: true, bodyLen: body ? body.length : 0 };
}

/**
 * 处理所有邀请码
 * - 读取 share.txt → 逐个发送好友申请 → 清空 share.txt
 */
async function processInviteCodes() {
  // 【2026-08-05】ReportArkClick = 发送好友申请（UserService 通用协议），
  // 与平台无关，yyb/qq 账号同样可发。去掉原"仅微信"限制。
  // if (CONFIG.platform !== 'wx') {
  //   log('邀请', '当前为 QQ 环境，跳过邀请码处理（仅微信支持）');
  //   return;
  // }

  const codes = readShareFile();
  if (codes.length === 0) return;

  log('邀请', `读取到 ${codes.length} 个邀请码（已去重），开始逐个处理...`);

  let success = 0;
  let failed = 0;

  for (let i = 0; i < codes.length; i++) {
    const code = codes[i];
    try {
      await sendReportArkClick(code.uid, code.openid, code.shareKey);
      success++;
      log('邀请', `[${i + 1}/${codes.length}] 已向 uid=${code.uid} 发送好友申请 (share_key=${(code.shareKey || '').slice(0, 8)}…)`);
    } catch (err) {
      failed++;
      logWarn('邀请', `[${i + 1}/${codes.length}] 向 uid=${code.uid} 发送申请失败: ${err.message}`);
    }

    if (i < codes.length - 1) {
      await sleep(INVITE_REQUEST_DELAY);
    }
  }

  log('邀请', `处理完成: 成功 ${success}, 失败 ${failed}`);
  clearShareFile();
}

/**
 * 清空 share.txt 文件
 */
function clearShareFile() {
  const filePath = getShareFilePath();
  try {
    writeTextFileAtomic(filePath, '');
    log('邀请', '已清空 share.txt');
  } catch (_) {
    // 忽略清空失败
  }
}

module.exports = {
  parseShareLink,
  readShareFile,
  sendReportArkClick,
  processInviteCodes,
  clearShareFile,
};
