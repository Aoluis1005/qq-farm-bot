/**
 * 护主犬奖励（同气礼包）服务
 *
 * 【2026-08-05 抓包实锤，协议已完整还原】
 *   查询可领数量：DogService.GetDogInfo（无参，body=0）
 *     响应 body f7 varint = 当前可领同气礼包数量
 *     （实测：领取前 GetDogInfo f7=66，与领取到的数量一致）
 *   领取：DogService.ClaimSkillGifts（无参，body=0）
 *     响应 body f3 varint = 本次领取数量
 *     （实测响应 0a 06 08 e7 97 06 10 42 18 42 → f1{f1:101351(物品ID),f2:66}, f3:66）
 *   两个请求体都是空，走 TSDK 自动加密/auth_token，模式同 ReportArkClick。
 */
const { sendMsgAsync } = require('../utils/network');
const { log } = require('../utils/utils');

const DOG_SERVICE = 'gamepb.dogpb.DogService';

/**
 * 从 protobuf 响应体中提取顶层指定字段号的 varint 值。
 * @param {Buffer|Uint8Array} bodyBytes
 * @param {number} fieldNo
 * @returns {number|null}
 */
function extractVarintField(bodyBytes, fieldNo) {
  if (!bodyBytes || bodyBytes.length === 0) return null;
  try {
    const Reader = require('protobufjs/minimal').Reader;
    const reader = Reader.create(Buffer.from(bodyBytes));
    while (reader.pos < reader.len) {
      const key = reader.uint32();
      const fno = key >> 3;
      const wt = key & 7;
      if (fno === fieldNo && wt === 0) {
        return reader.uint32();
      }
      if (wt === 0) reader.skip();
      else if (wt === 1) reader.skip(8);
      else if (wt === 5) reader.skip(4);
      else if (wt === 2) { const l = reader.uint32(); reader.skip(l); }
      else break;
    }
  } catch (_) {
    // 解析失败返回 null
  }
  return null;
}

/**
 * 查询当前可领同气礼包数量（GetDogInfo 响应 f7）
 * @returns {Promise<{ok:boolean, claimable:number}>}
 */
async function getDogGiftStatus() {
  const { body } = await sendMsgAsync(DOG_SERVICE, 'GetDogInfo', Buffer.alloc(0));
  const claimable = extractVarintField(body, 7);
  return { ok: true, claimable: claimable || 0 };
}

/**
 * 领取同气礼包（ClaimSkillGifts，无参）
 * @returns {Promise<{ok:boolean, claimed:number}>}
 */
async function claimDogGifts() {
  const { body } = await sendMsgAsync(DOG_SERVICE, 'ClaimSkillGifts', Buffer.alloc(0));
  const claimed = extractVarintField(body, 3);
  log('宠物', `领取同气礼包: ${claimed || 0} 个`, {
    module: 'dog',
    event: '领取同气礼包',
    result: 'ok',
    claimed: claimed || 0,
  });
  return { ok: true, claimed: claimed || 0 };
}

module.exports = {
  getDogGiftStatus,
  claimDogGifts,
  extractVarintField,
};
