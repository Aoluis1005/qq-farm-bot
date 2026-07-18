const { PlantPhase, PHASE_NAMES } = require('../config/config');
const {
  getPlantName,
  getPlantById,
  getPlantGrowTime,
  getSeedImageBySeedId,
  getMutantEffectsByIds,
} = require('../config/gameConfig');
const {
  toNum,
  toTimeSec,
  getServerTimeSec,
  log,
  logWarn,
  randomDelay,
  sleep,
} = require('../utils/utils');
const { getUserState } = require('../utils/network');
const {
  getPlantBlacklist,
  getFriendBlacklist,
  readFriendDogInfoCache,
  writeFriendDogInfoCache,
} = require('../models/store');
const {
  enterFriendFarm,
  leaveFriendFarm,
  getDogName,
  handleFriendEnterError,
} = require('./friend-api');
const {
  getCurrentPhase,
  buildLandMap,
  getDisplayLandContext,
  isOccupiedSlaveLand,
} = require('./farm-land-analyzer');

const GOLDEN_BUG_ITEM_ID = 301101;
const GOLDEN_BUG_SOCIAL_TYPE = 2;

// ===== Analyze friend lands =====

/**
 * Analyze a friend's lands and classify them into actionable categories.
 * Returns actionable ordinary-farm and golden-bug land groups.
 */
function analyzeFriendLands(lands, myGid, friendName = '', options = {}) {
  const { plantBlacklist = null } = options;
  const result = {
    stealable: [],
    stealableInfo: [],
    needWater: [],
    needWeed: [],
    needBug: [],
    canPutWeed: [],
    canPutBug: [],
    canPutGoldenBug: [],
  };

  const landMap = buildLandMap(lands);

  for (const land of lands) {
    const landId = toNum(land.id);

    // Skip slave lands in merged planting
    if (isOccupiedSlaveLand(land, landMap)) continue;

    const plant = land.plant;
    if (!plant || !plant.phases || plant.phases.length === 0) continue;

    const currentPhase = getCurrentPhase(
      plant.phases,
      false,
      `[${friendName}]土地#${landId}`
    );
    if (!currentPhase) continue;

    const phase = currentPhase.phase;
    const socialItems = Array.isArray(plant.social_items) ? plant.social_items : [];
    const alreadyHasGoldenBug = socialItems.some(item => (
      toNum(item && item.item_id) === GOLDEN_BUG_ITEM_ID &&
      toNum(item && item.type) === GOLDEN_BUG_SOCIAL_TYPE
    ));

    if (phase !== PlantPhase.MATURE && phase !== PlantPhase.DEAD && !alreadyHasGoldenBug) {
      result.canPutGoldenBug.push(landId);
    }

    // Mature & stealable
    if (phase === PlantPhase.MATURE) {
      if (plant.stealable) {
        const plantId = toNum(plant.id);
        const plantName = getPlantName(plantId) || plant.name || '未知';
        const plantInfo = getPlantById(plantId);
        const seedId = plantInfo ? toNum(plantInfo.seed_id) : 0;

        // Respect plant blacklist
        if (plantBlacklist && seedId > 0 && plantBlacklist.includes(seedId)) continue;

        result.stealable.push(landId);
        result.stealableInfo.push({ landId, plantId, name: plantName });
      }
      continue;
    }

    // Dead — skip
    if (phase === PlantPhase.DEAD) continue;

    // Dry / weeds / insects
    if (toNum(plant.dry_num) > 0) result.needWater.push(landId);
    if (plant.weed_owners && plant.weed_owners.length > 0) result.needWeed.push(landId);
    if (plant.insect_owners && plant.insect_owners.length > 0) result.needBug.push(landId);

    // Can put weed / bug (limit: max 2 owners, and we haven't put one yet)
    if (phase !== PlantPhase.MATURE) {
      const weedOwners = plant.weed_owners || [];
      const bugOwners = plant.insect_owners || [];
      const alreadyPutWeed = weedOwners.some(owner => toNum(owner) === myGid);
      const alreadyPutBug = bugOwners.some(owner => toNum(owner) === myGid);

      if (weedOwners.length < 2 && !alreadyPutWeed) result.canPutWeed.push(landId);
      if (bugOwners.length < 2 && !alreadyPutBug) result.canPutBug.push(landId);
    }
  }

  return result;
}

// ===== Dog info =====

/**
 * Get a single friend's dog information by entering and leaving their farm.
 */
async function getFriendDogInfo(gid, friendName = '') {
  const numericGid = toNum(gid);
  const defaultResult = { dogId: 0, dogName: '无狗' };
  if (!numericGid) return defaultResult;

  const accountId = process.env.FARM_ACCOUNT_ID || '';
  const blacklist = new Set(getFriendBlacklist(accountId));
  if (blacklist.has(numericGid)) {
    return { dogId: 0, dogName: '无狗', blacklisted: true };
  }

  try {
    const enterReply = await enterFriendFarm(numericGid);
    await leaveFriendFarm(numericGid);

    const dogInfo = enterReply.__briefDogInfo;
    if (dogInfo && dogInfo.dogId > 0) {
      const dogId = toNum(dogInfo.dogId);
      const dogName = getDogName(dogId);
      return { dogId, dogName: dogName || '无狗' };
    }

    return { dogId: 0, dogName: '无狗' };
  } catch (err) {
    const handled = handleFriendEnterError(numericGid, friendName, err);
    if (handled.handled && handled.kind === 'blacklist') {
      return { dogId: 0, dogName: '无狗', blacklisted: true };
    }
    logWarn('好友', `获取好友 ${numericGid} 狗信息失败: ${err.message}`, {
      module: 'friend',
      event: '获取好友狗信息',
      result: 'error',
      friendGid: numericGid,
      error: err.message,
    });
    return { dogId: 0, dogName: '无狗' };
  }
}

/**
 * Batch get dog info for multiple friends.
 * Returns: { map: Map<gid, dogInfo>, failCount, blacklistCount }
 */
async function batchGetFriendDogInfo(friends) {
  const dogMap = new Map();
  const friendList = Array.isArray(friends) ? friends : [];
  let noDogCount = 0;
  let blacklistCount = 0;
  const BATCH_LOG_INTERVAL = 30;
  const BATCH_SLEEP_MS = 1000;
  const accountId = process.env.FARM_ACCOUNT_ID || '';
  const blacklist = new Set(getFriendBlacklist(accountId));

  // Normalize entries
  const entries = friendList
    .map(entry => {
      if (typeof entry === 'object' && entry !== null) {
        return { gid: toNum(entry.gid), name: entry.name || `GID:${toNum(entry.gid)}` };
      }
      return { gid: toNum(entry), name: `GID:${toNum(entry)}` };
    })
    .filter(e => e.gid > 0);

  log('好友', `batchGetFriendDogInfo 开始: 共 ${entries.length} 个好友`, {
    module: 'friend',
    event: 'batchGetFriendDogInfo',
    step: 'start',
    count: entries.length,
  });

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const gid = entry.gid;

    if (blacklist.has(gid)) {
      blacklistCount++;
      dogMap.set(gid, { dogId: 0, dogName: '无狗', blacklisted: true });
      continue;
    }

    const dogInfo = await getFriendDogInfo(gid, entry.name);
    if (dogInfo.dogId === 0) noDogCount++;
    if (dogInfo.blacklisted) {
      blacklistCount++;
      blacklist.add(gid);
    }
    dogMap.set(gid, dogInfo);

    if (i < entries.length - 1) {
      await randomDelay(100, 200);
    }

    // Periodic sleep to avoid rate limiting（自用：从 1000ms 降到 300ms）
    if ((i + 1) % BATCH_LOG_INTERVAL === 0 && i < entries.length - 1) {
      await sleep(300);
    }
  }

  log('好友',
    `batchGetFriendDogInfo 完成: 成功获取 ${dogMap.size} 个好友的狗信息，无狗 ${noDogCount} 个，黑名单 ${blacklistCount} 个`,
    {
      module: 'friend',
      event: 'batchGetFriendDogInfo',
      step: 'done',
      resultCount: dogMap.size,
      failCount: noDogCount,
      blacklistCount,
    }
  );

  return { map: dogMap, failCount: noDogCount, blacklistCount };
}

// ===== Friends list =====
let friendsListCache = null;

/**
 * Get a processed friends list with dog info from cache if available.
 * Filters out fake NPCs (name "小小农夫" with level 1).
 */
async function getFriendsList(forceRefresh = false) {
  try {
    if (!forceRefresh && friendsListCache) return friendsListCache;

    log('好友', '开始获取好友列表', {
      module: 'friend',
      event: '获取好友列表',
    });

    const { getAllFriends } = require('./friend-api');
    const allFriendsReply = await getAllFriends(forceRefresh);
    const rawFriends = allFriendsReply.game_friends || [];
    const userState = getUserState();
    const accountId = process.env.FARM_ACCOUNT_ID || '';
    const dogInfoCache = accountId ? readFriendDogInfoCache(accountId) : null;

    const friends = rawFriends
      .filter(friend => {
        // Exclude self
        if (toNum(friend.gid) === userState.gid) return false;
        // Exclude fake NPC
        if (
          (friend.name === '小小农夫' || friend.remark === '小小农夫') &&
          toNum(friend.level) === 1
        ) {
          return false;
        }
        return true;
      })
      .map(friend => {
        const gid = toNum(friend.gid);
        const cachedDog = dogInfoCache && dogInfoCache[gid] ? dogInfoCache[gid] : null;
        return {
          gid,
          name: friend.remark || friend.name || `GID:${gid}`,
          avatarUrl: String(friend.avatar_url || '').trim(),
          level: toNum(friend.level),
          gold: toNum(friend.gold),
          dogId: cachedDog ? cachedDog.dogId : 0,
          dogName: cachedDog ? cachedDog.dogName : '',
          plant: friend.plant
            ? {
                stealNum: toNum(friend.plant.steal_plant_num),
                dryNum: toNum(friend.plant.dry_num),
                weedNum: toNum(friend.plant.weed_num),
                insectNum: toNum(friend.plant.insect_num),
              }
            : null,
        };
      })
      .sort((a, b) => {
        const cmp = (a.name || '').localeCompare(b.name || '', 'zh-CN');
        if (cmp !== 0) return cmp;
        return (a.gid || 0) - (b.gid || 0);
      });

    friendsListCache = friends;

    const cachedDogCount = dogInfoCache ? Object.keys(dogInfoCache).length : 0;
    log('好友',
      `获取好友列表成功，共 ${friends.length} 位好友${ 
        cachedDogCount > 0 ? `，已从缓存加载 ${cachedDogCount} 个狗信息` : ''}`,
      {
        module: 'friend',
        event: '获取好友列表',
        result: 'ok',
        count: friends.length,
        cachedDogInfoCount: cachedDogCount,
      }
    );

    return friends;
  } catch (err) {
    log('好友', `获取好友列表失败: ${err.message}`, {
      module: 'friend',
      event: '获取好友列表',
      result: 'error',
      error: err.message,
    });
    return [];
  }
}

/**
 * Fetch dog info for all friends in the list.
 * Caches guard dog (护主犬, id=90021) info locally.
 */
async function fetchFriendsDogInfo() {
  const accountId = process.env.FARM_ACCOUNT_ID || '';
  let friends = friendsListCache;

  if (!friends || friends.length === 0) {
    friends = await getFriendsList(true);
  }

  if (!friends || friends.length === 0) {
    return { ok: false, error: '好友列表为空，请先获取好友列表' };
  }

  const dogTargets = friends.map(f => ({
    gid: toNum(f.gid),
    name: f.name || `GID:${toNum(f.gid)}`,
  }));

  const { map: dogMap, failCount, blacklistCount } = await batchGetFriendDogInfo(dogTargets);

  const guardDogFriends = {};
  for (const friend of friends) {
    const dogInfo = dogMap.get(friend.gid);
    if (dogInfo) {
      friend.dogId = dogInfo.dogId;
      friend.dogName = dogInfo.dogName;
      friend.blacklisted = dogInfo.blacklisted || false;
      if (friend.dogId === 90021) {
        guardDogFriends[friend.gid] = {
          dogId: friend.dogId,
          dogName: friend.dogName,
        };
      }
    }
  }

  friendsListCache = friends;

  // Persist guard dog info to disk cache
  if (accountId && Object.keys(guardDogFriends).length > 0) {
    writeFriendDogInfoCache(accountId, guardDogFriends);
    log('好友',
      `已保存 ${Object.keys(guardDogFriends).length} 个护主犬好友信息到本地缓存`,
      {
        module: 'friend',
        event: '保存护主犬好友缓存',
        count: Object.keys(guardDogFriends).length,
      }
    );
  }

  const guardDogCount = friends.filter(f => f.dogId === 90021).length;

  log('好友',
    `获取好友狗信息完成: 共 ${friends.length} 个好友，护主犬 ${guardDogCount} 个，无狗 ${failCount} 个，黑名单 ${blacklistCount} 个`,
    {
      module: 'friend',
      event: '获取好友狗信息',
      result: 'ok',
      count: friends.length,
      guardDogCount,
      failCount,
      blacklistCount,
    }
  );

  return {
    ok: true,
    friends,
    failCount,
    blacklistCount,
    guardDogCount,
  };
}

// ===== Friend lands detail =====

/**
 * Get a friend's lands in detail (for frontend display).
 */
async function getFriendLandsDetail(gid) {
  try {
    const enterReply = await enterFriendFarm(gid);
    const lands = enterReply.lands || [];
    const userState = getUserState();
    const plantBlacklist = getPlantBlacklist(userState.accountId);
    const analysis = analyzeFriendLands(lands, userState.gid, '', { plantBlacklist });
    await leaveFriendFarm(gid);

    const detailLands = [];
    const serverTimeSec = getServerTimeSec();
    const landMap = buildLandMap(lands);

    for (const land of lands) {
      const landId = toNum(land.id);
      const landLevel = toNum(land.level);
      const isUnlocked = !!land.unlocked;
      const { sourceLand, occupiedByMaster, masterLandId, occupiedLandIds } =
        getDisplayLandContext(land, landMap);

      // Locked land
      if (!isUnlocked) {
        detailLands.push({
          id: landId,
          unlocked: false,
          status: 'locked',
          plantName: '',
          phaseName: '未解锁',
          level: landLevel,
          needWater: false,
          needWeed: false,
          needBug: false,
          occupiedByMaster: false,
          masterLandId: 0,
          occupiedLandIds: [],
          plantSize: 1,
        });
        continue;
      }

      const targetPlant = (sourceLand && sourceLand.plant) || land.plant;

      // Empty land
      if (!targetPlant || !targetPlant.phases || targetPlant.phases.length === 0) {
        detailLands.push({
          id: landId,
          unlocked: true,
          status: 'empty',
          plantName: '',
          phaseName: '空地',
          level: landLevel,
          occupiedByMaster,
          masterLandId,
          occupiedLandIds,
          plantSize: 1,
        });
        continue;
      }

      const currentPhase = getCurrentPhase(targetPlant.phases, false, '');
      if (!currentPhase) {
        detailLands.push({
          id: landId,
          unlocked: true,
          status: 'empty',
          plantName: '',
          phaseName: '',
          level: landLevel,
          occupiedByMaster,
          masterLandId,
          occupiedLandIds,
          plantSize: 1,
        });
        continue;
      }

      const phase = currentPhase.phase;
      const plantId = toNum(targetPlant.id);
      const plantName = getPlantName(plantId) || targetPlant.name || '未知';
      const plantInfo = getPlantById(plantId);
      const seedId = toNum(plantInfo && plantInfo.seed_id);
      const seedImage = seedId > 0 ? getSeedImageBySeedId(seedId) : '';
      const plantSize = Math.max(1, toNum(plantInfo && plantInfo.size) || 1);
      const totalSeasons = Math.max(1, toNum(plantInfo && plantInfo.seasons) || 1);
      const currentSeasonRaw = toNum(targetPlant.season);
      const currentSeason =
        currentSeasonRaw > 0 ? Math.min(currentSeasonRaw, totalSeasons) : 1;
      const phaseName = PHASE_NAMES[phase] || '';

      // Compute maturity time
      const maturePhase = Array.isArray(targetPlant.phases)
        ? targetPlant.phases.find(p => p && toNum(p.phase) === PlantPhase.MATURE)
        : null;
      const matureTimeSec = maturePhase ? toTimeSec(maturePhase.begin_time) : 0;
      const matureInSec = matureTimeSec > serverTimeSec ? matureTimeSec - serverTimeSec : 0;
      const totalGrowTime = getPlantGrowTime(plantId);

      // Determine status
      let status = 'growing';
      if (phase === PlantPhase.MATURE) {
        status = targetPlant.stealable ? 'stealable' : 'harvested';
      } else if (phase === PlantPhase.DEAD) {
        status = 'dead';
      }

      // Mutant effects
      const mutantConfigIds = targetPlant.mutant_config_ids || [];
      const mutantEffects = getMutantEffectsByIds(mutantConfigIds);

      detailLands.push({
        id: landId,
        unlocked: true,
        status,
        plantName,
        seedId,
        seedImage,
        phaseName,
        currentSeason,
        totalSeason: totalSeasons,
        level: landLevel,
        matureInSec,
        totalGrowTime,
        needWater: toNum(targetPlant.dry_num) > 0,
        needWeed: targetPlant.weed_owners && targetPlant.weed_owners.length > 0,
        needBug: targetPlant.insect_owners && targetPlant.insect_owners.length > 0,
        occupiedByMaster,
        masterLandId,
        occupiedLandIds,
        plantSize,
        mutantEffects,
      });
    }

    return { lands: detailLands, summary: analysis };
  } catch {
    return { lands: [], summary: {} };
  }
}

// ===== Cache accessors =====

function getFriendsListCache() {
  return friendsListCache;
}

function setFriendsListCache(cache) {
  friendsListCache = cache;
}

// ===== Exports =====
module.exports = {
  analyzeFriendLands,
  getFriendDogInfo,
  batchGetFriendDogInfo,
  getFriendsList,
  fetchFriendsDogInfo,
  getFriendLandsDetail,
  getFriendsListCache,
  setFriendsListCache,
};
