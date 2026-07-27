/**
 * 个人生涯统计服务
 *
 * 功能：
 * - 获取生涯统计（作物/花卉收获排行 + 玩家自身维度聚合）
 * - 同时支持 proto 解码与原始 protobuf 回退（适配服务端字段号差异）
 * - 返回前用 gameConfig 把 fruit_id 翻译为名字/头像/等级/稀有度
 */
const { types } = require('../utils/proto');
const { sendMsgAsync } = require('../utils/network');
const gameConfig = require('../config/gameConfig');
const { createModuleLogger } = require('./logger');

const logger = createModuleLogger('career');

// ---- Protobuf 原始解码工具 ----

function readVarint(buffer, offset) {
  let value = 0n;
  let shift = 0n;
  let pos = offset;
  while (pos < buffer.length) {
    const byte = BigInt(buffer[pos]);
    value |= (byte & 0x7Fn) << shift;
    pos += 1;
    if ((byte & 0x80n) === 0n) break;
    shift += 7n;
  }
  return { value, next: pos };
}

function scanProtobufMessage(buf) {
  const fields = [];
  let pos = 0;
  while (pos < buf.length) {
    const tag = readVarint(buf, pos);
    if (tag.next <= pos) break;
    pos = tag.next;
    const fieldNum = Number(tag.value >> 3n);
    const wireType = Number(tag.value & 0x7n);

    if (wireType === 0) {
      const v = readVarint(buf, pos);
      fields.push({ field: fieldNum, wire: wireType, value: Number(v.value) });
      pos = v.next;
    } else if (wireType === 2) {
      const lenTag = readVarint(buf, pos);
      const length = Number(lenTag.value);
      const dataStart = lenTag.next;
      const dataEnd = dataStart + length;
      fields.push({ field: fieldNum, wire: wireType, length, bytes: Buffer.from(buf.subarray(dataStart, dataEnd)) });
      pos = dataEnd;
    } else if (wireType === 5) {
      fields.push({ field: fieldNum, wire: wireType, bytes: Buffer.from(buf.subarray(pos, pos + 4)) });
      pos += 4;
    } else if (wireType === 1) {
      fields.push({ field: fieldNum, wire: wireType, bytes: Buffer.from(buf.subarray(pos, pos + 8)) });
      pos += 8;
    } else {
      break;
    }
  }
  return fields;
}

function isPrintable(s) {
  if (!s) return false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 32 || c > 126) return false;
  }
  return s.length > 0 && s.length < 256;
}

/**
 * 把 CareerStatItem 装饰成前端可用结构
 * 用 gameConfig 查 fruit_id → name/image/level/rarity
 */
function decorateStatItem(rawItem) {
  const fruitId = Number(rawItem.id || rawItem.fruit_id || 0);
  const count = Number(rawItem.count || 0);
  let name = '';
  let image = '';
  let level = 0;
  let rarity = 0;
  try {
    const info = gameConfig.getItemById ? gameConfig.getItemById(fruitId) : null;
    if (info) {
      name = String(info.name || '').trim();
      rarity = Number(info.rarity || 0);
      level = Number(info.level || 0);
    }
    if (!name && gameConfig.getFruitName) {
      name = gameConfig.getFruitName(fruitId) || '';
    }
    if (gameConfig.getItemImageById) {
      image = gameConfig.getItemImageById(fruitId) || '';
    }
  } catch (err) {
    logger.warn('装饰生涯条目失败', { fruitId, error: err.message });
  }
  return {
    id: fruitId,
    count,
    name: name || `物品 ${fruitId}`,
    image,
    level,
    rarity,
  };
}

/**
 * 原始 protobuf 回退解析（适配协议字段号差异）
 * CareerInfoGetReply 真实结构：
 *   field 1  = repeated CareerStatItem (f1=fruit_id, f2=count)
 *   field 2  = varint (总收获数备用)
 *   field 3  = varint (备用统计)
 *   field 4  = string 玩家昵称
 *   field 5  = string 玩家头像 URL
 *   field 9  = varint Lv
 *   field 10 = varint 经验
 *   field 11 = varint gid 角色编号
 *   field 12 = repeated CareerLevelStat (f1=fruit_id, f2=count, f4=level)
 *   field 13 = varint achieved_levels
 *   field 15 = string openid
 */
function decodeCareerReplyRaw(rawBody) {
  const fields = scanProtobufMessage(Buffer.from(rawBody));
  const reply = {
    items: [],
    level_stats: [],
    name: '',
    avatar: '',
    level: 0,
    exp: 0,
    gid: 0,
    openid: '',
    achieved_levels: 0,
    stats_total: 0,
    stats_count: 0,
  };

  for (const f of fields) {
    if (f.wire === 0) {
      const v = Number(f.value);
      if (f.field === 2) reply.stats_total = v;
      else if (f.field === 3) reply.stats_count = v;
      else if (f.field === 9) reply.level = v;
      else if (f.field === 10) reply.exp = v;
      else if (f.field === 11) reply.gid = v;
      else if (f.field === 13) reply.achieved_levels = v;
    } else if (f.wire === 2 && f.bytes) {
      // string 字段
      if (f.field === 4 || f.field === 5 || f.field === 15) {
        const s = Buffer.from(f.bytes).toString('utf-8');
        if (isPrintable(s)) {
          if (f.field === 4) reply.name = s;
          else if (f.field === 5) reply.avatar = s;
          else if (f.field === 15) reply.openid = s;
        }
        continue;
      }
      // 嵌套消息
      const sub = scanProtobufMessage(f.bytes);
      const hasNested = sub.some(sf => sf.wire === 2 || sf.wire === 0);
      if (!hasNested) continue;
      const item = {};
      for (const sf of sub) {
        if (sf.wire === 0) {
          if (sf.field === 1) item.fruit_id = Number(sf.value);
          else if (sf.field === 2) item.count = Number(sf.value);
          else if (sf.field === 4) item.level = Number(sf.value);
        }
      }
      if (f.field === 1 && item.fruit_id) reply.items.push(item);
      else if (f.field === 12 && item.fruit_id) reply.level_stats.push(item);
    }
  }

  return reply;
}

/**
 * 把 CareerLevelStat 装饰成前端可用结构
 */
function decorateLevelStat(raw) {
  const fruitId = Number(raw.fruit_id || 0);
  const count = Number(raw.count || 0);
  const level = Number(raw.level || 0);
  let name = '';
  let image = '';
  try {
    const info = gameConfig.getItemById ? gameConfig.getItemById(fruitId) : null;
    if (info) name = String(info.name || '').trim();
    if (!name && gameConfig.getFruitName) name = gameConfig.getFruitName(fruitId) || '';
    if (gameConfig.getItemImageById) image = gameConfig.getItemImageById(fruitId) || '';
  } catch (e) {}
  return { id: fruitId, count, level, name: name || `物品 ${fruitId}`, image };
}

/**
 * 获取生涯统计（主入口）
 */
async function getCareerInfo() {
  const request = types.CareerInfoGetRequest.encode(
    types.CareerInfoGetRequest.create({})
  ).finish();

  try {
    const { body } = await sendMsgAsync(
      'gamepb.careerpb.CareerService',
      'CareerInfoGet',
      request,
      10000 // 缩短超时：避免卡满 20s 与前端 axios 超时撞车
    );

    logger.info('生涯统计API响应', { bodyLength: body ? body.length : 0 });

    let reply = null;
    // 优先 proto 解码（注意 proto.js 全局 keepCase:true，解码后字段名为 snake_case）
    try {
      const decoded = types.CareerInfoGetReply.decode(body);
      reply = {
        items: (decoded.items || []).map(it => ({
          fruit_id: Number(it.fruit_id || 0),
          count: Number(it.count || 0),
        })),
        level_stats: (decoded.level_stats || []).map(it => ({
          fruit_id: Number(it.fruit_id || 0),
          count: Number(it.count || 0),
          level: Number(it.level || 0),
        })),
        name: decoded.name || '',
        avatar: decoded.avatar || '',
        level: Number(decoded.level || 0),
        exp: Number(decoded.exp || 0),
        gid: Number(decoded.gid || 0),
        openid: decoded.openid || '',
        achieved_levels: Number(decoded.achieved_levels || 0),
        stats_total: Number(decoded.stats_total || 0),
        stats_count: Number(decoded.stats_count || 0),
      };
    } catch (err) {
      logger.warn('生涯统计 proto 解码失败，回退原始解析', { error: err.message });
      reply = decodeCareerReplyRaw(body);
    }
    // 兜底：proto 解码“成功”但取不到条目（字段名/结构不匹配导致全空）时，用原始扫描再次尝试
    if (!reply || (reply.items || []).length === 0) {
      const rawReply = decodeCareerReplyRaw(body);
      if (rawReply && (rawReply.items || []).length > 0) {
        logger.warn('proto 解码未取到条目，改用原始扫描结果');
        reply = rawReply;
      }
    }

    // 装饰 items（fruit_id → name/image/level/rarity）并按 count 倒序
    const decoratedItems = (reply.items || [])
      .map(decorateStatItem)
      .filter(it => it.id > 0 && it.count > 0)
      .sort((a, b) => b.count - a.count);

    const decoratedLevelStats = (reply.level_stats || [])
      .map(decorateLevelStat)
      .filter(it => it.id > 0);

    return {
      items: decoratedItems,
      level_stats: decoratedLevelStats,
      player: {
        gid: Number(reply.gid || 0),
        name: reply.name || '',
        avatar: reply.avatar || '',
        openid: reply.openid || '',
        level: Number(reply.level || 0),
        exp: Number(reply.exp || 0),
      },
      meta: {
        achieved_levels: Number(reply.achieved_levels || 0),
        stats_total: Number(reply.stats_total || 0),
        stats_count: Number(reply.stats_count || 0),
      },
      __raw: { bodyLength: body.length },
    };
  } catch (err) {
    logger.error('获取生涯统计失败', { error: err.message, stack: err.stack });
    // 超时 / 连接问题统一为 'API Timeout'，便于前端拦截器静默处理、弹窗显示友好文案
    const isTimeout = /超时|timeout/i.test(err.message || '');
    const error = isTimeout ? 'API Timeout' : (err.message || '获取生涯统计失败');
    return { items: [], level_stats: [], player: null, error };
  }
}

module.exports = {
  getCareerInfo,
  decodeCareerReplyRaw,
  decorateStatItem,
  decorateLevelStat,
};