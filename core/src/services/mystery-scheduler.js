/**
 * 神秘商人自动购买调度模块
 * 按照账号自动化配置（mystery_auto_buy / mysteryAutoBuyCurrencies）
 * 周期性检测当前活动神秘商人，并在其货币类型命中勾选列表时自动购买。
 */
const { log, logWarn, toNum } = require('../utils/utils');
const {
  isMysteryAutoBuyOn,
  getMysteryAutoBuyCurrencies
} = require('../models/store');
const { getActiveMysteryShop, buyMysteryShopGoods } = require('./mystery-shop');

// 自动购买检测间隔（毫秒）。神秘商人出现频率不高，且购买的是整个商品，
// 过短轮询会频繁打扰服务器。默认 1 小时一次。
const MYSTERY_AUTO_BUY_INTERVAL_MS = 60 * 60 * 1000;

// 单次检测内连续购买的安全上限，防止服务器异常时无限循环
const MYSTERY_AUTO_BUY_MAX_PER_CYCLE = 20;

let mysteryAutoBuyTimer = null;

/** 启动神秘商人自动购买定时器 */
function startMysteryAutoBuyTimer() {
  if (mysteryAutoBuyTimer) clearInterval(mysteryAutoBuyTimer);

  if (!isMysteryAutoBuyOn()) return;

  mysteryAutoBuyTimer = setInterval(() => {
    checkMysteryAutoBuyOnce();
  }, MYSTERY_AUTO_BUY_INTERVAL_MS);

  log('神秘商人', `自动购买定时器已启动，间隔 ${MYSTERY_AUTO_BUY_INTERVAL_MS / 1000} 秒`, {
    module: 'mystery',
    event: 'auto_buy_timer',
    result: 'start'
  });
}

/** 停止神秘商人自动购买定时器 */
function stopMysteryAutoBuyTimer() {
  if (mysteryAutoBuyTimer) {
    clearInterval(mysteryAutoBuyTimer);
    mysteryAutoBuyTimer = null;
  }
  log('神秘商人', '自动购买定时器已停止', {
    module: 'mystery',
    event: 'auto_buy_timer',
    result: 'stop'
  });
}

/**
 * 执行一次神秘商人自动购买检测
 * - 仅在开关开启时生效
 * - 仅购买货币类型命中勾选列表的活动商人
 * - 一次购买即买下该商人的整个商品；若购买后商人刷新出新商品且仍命中货币列表，
 *   会继续买光，直到没有可买的活动商人（受安全上限约束）
 */
async function checkMysteryAutoBuyOnce() {
  if (!isMysteryAutoBuyOn()) return;

  const allowedCurrencies = getMysteryAutoBuyCurrencies();

  if (!Array.isArray(allowedCurrencies) || allowedCurrencies.length === 0) {
    logWarn('神秘商人', '自动购买已开启，但未勾选任何货币类型，跳过', {
      module: 'mystery',
      event: 'auto_buy',
      result: 'skip'
    });
    return;
  }

  let bought = 0;
  let lastNpcId = -1;

  try {
    for (let i = 0; i < MYSTERY_AUTO_BUY_MAX_PER_CYCLE; i++) {
      const offer = await getActiveMysteryShop();
      if (!offer || !offer.active) break;
      if (toNum(offer.npcId) === lastNpcId) break; // 防止重复购买同一商人

      if (!allowedCurrencies.includes(toNum(offer.currencyId))) {
        // 货币类型不在勾选列表内，停止本轮（不购买非目标货币）
        break;
      }

      await buyMysteryShopGoods(offer.npcId);
      bought++;
      lastNpcId = toNum(offer.npcId);

      log('神秘商人', `自动购买成功：${offer.itemName || ('物品' + offer.itemId)}（${offer.currencyName}）`, {
        module: 'mystery',
        event: 'auto_buy',
        result: 'ok',
        npcId: offer.npcId,
        itemId: offer.itemId,
        currencyId: offer.currencyId
      });
    }

    if (bought > 0) {
      log('神秘商人', `本次自动购买共完成 ${bought} 笔`, {
        module: 'mystery',
        event: 'auto_buy',
        result: 'done',
        bought
      });
    }
  } catch (err) {
    logWarn('神秘商人', `自动购买检测失败: ${err.message}`, {
      module: 'mystery',
      event: 'auto_buy',
      result: 'error',
      error: err.message
    });
  }
}

module.exports = {
  startMysteryAutoBuyTimer,
  stopMysteryAutoBuyTimer,
  checkMysteryAutoBuyOnce
};
