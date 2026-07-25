const { log, logWarn, toNum } = require('../utils/utils');
const {
  isMysteryAutoBuyOn,
  getMysteryAutoBuyCurrencies
} = require('../models/store');
const { getActiveMysteryShop, buyMysteryShopGoods } = require('./mystery-shop');

const MYSTERY_AUTO_BUY_INTERVAL_MS = 60 * 60 * 1000;
const MYSTERY_AUTO_BUY_MAX_PER_CYCLE = 20;

let mysteryAutoBuyTimer = null;

function startMysteryAutoBuyTimer() {
  if (mysteryAutoBuyTimer) clearInterval(mysteryAutoBuyTimer);
  if (!isMysteryAutoBuyOn()) return;

  // 启动时立即执行一次（单次查询+购买，不循环避免队列卡死）
  runOnce();

  mysteryAutoBuyTimer = setInterval(() => {
    checkMysteryAutoBuyOnce();
  }, MYSTERY_AUTO_BUY_INTERVAL_MS);

  log('神秘商人', `自动购买定时器已启动，间隔 ${MYSTERY_AUTO_BUY_INTERVAL_MS / 1000} 秒`, {
    module: 'mystery',
    event: 'auto_buy_timer',
    result: 'start'
  });
}

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

/** 单次查询+购买（不循环，用于启动时立即执行） */
async function runOnce() {
  if (!isMysteryAutoBuyOn()) return;
  const allowedCurrencies = getMysteryAutoBuyCurrencies();
  if (!Array.isArray(allowedCurrencies) || allowedCurrencies.length === 0) {
    logWarn('神秘商人', '自动购买已开启，但未勾选任何货币类型，跳过', {
      module: 'mystery', event: 'auto_buy', result: 'skip'
    });
    return;
  }
  try {
    const offer = await getActiveMysteryShop();
    if (!offer || !offer.active) return;
    if (!allowedCurrencies.includes(toNum(offer.currencyId))) return;
    await buyMysteryShopGoods(offer.npcId);
    log('神秘商人', `自动购买成功：${offer.itemName || ('物品' + offer.itemId)}（${offer.currencyName}）`, {
      module: 'mystery', event: 'auto_buy', result: 'ok',
      npcId: offer.npcId, itemId: offer.itemId, currencyId: offer.currencyId
    });
  } catch (err) {
    logWarn('神秘商人', `自动购买检测失败: ${err.message}`, {
      module: 'mystery', event: 'auto_buy', result: 'error', error: err.message
    });
  }
}

async function checkMysteryAutoBuyOnce() {
  if (!isMysteryAutoBuyOn()) return;
  const allowedCurrencies = getMysteryAutoBuyCurrencies();
  if (!Array.isArray(allowedCurrencies) || allowedCurrencies.length === 0) {
    logWarn('神秘商人', '自动购买已开启，但未勾选任何货币类型，跳过', {
      module: 'mystery', event: 'auto_buy', result: 'skip'
    });
    return;
  }
  let bought = 0;
  let lastNpcId = -1;
  try {
    for (let i = 0; i < MYSTERY_AUTO_BUY_MAX_PER_CYCLE; i++) {
      const offer = await getActiveMysteryShop();
      if (!offer || !offer.active) break;
      if (toNum(offer.npcId) === lastNpcId) break;
      if (!allowedCurrencies.includes(toNum(offer.currencyId))) break;
      await buyMysteryShopGoods(offer.npcId);
      bought++;
      lastNpcId = toNum(offer.npcId);
      log('神秘商人', `自动购买成功：${offer.itemName || ('物品' + offer.itemId)}（${offer.currencyName}）`, {
        module: 'mystery', event: 'auto_buy', result: 'ok',
        npcId: offer.npcId, itemId: offer.itemId, currencyId: offer.currencyId
      });
    }
    if (bought > 0) {
      log('神秘商人', `本次自动购买共完成 ${bought} 笔`, {
        module: 'mystery', event: 'auto_buy', result: 'done', bought
      });
    }
  } catch (err) {
    logWarn('神秘商人', `自动购买检测失败: ${err.message}`, {
      module: 'mystery', event: 'auto_buy', result: 'error', error: err.message
    });
  }
}

module.exports = {
  startMysteryAutoBuyTimer,
  stopMysteryAutoBuyTimer,
  checkMysteryAutoBuyOnce
};
