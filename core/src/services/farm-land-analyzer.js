const { PlantPhase, PHASE_NAMES } = require('../config/config');
const { getPlantName, getPlantNameOrNull, getPlantExp, getPlantById, getPlantGrowTime, getSeedImageBySeedId, getMutantEffectsByIds } = require('../config/gameConfig');
const { toNum, toTimeSec, getServerTimeSec, logWarn } = require('../utils/utils');
const { getAllLands } = require('./farm-api');

const GOLDEN_BUG_ITEM_ID = 301101;
const GOLDEN_BUG_SOCIAL_TYPE = 2;

function hasGoldenBug(plant) {
  return !!(plant && Array.isArray(plant.social_items) && plant.social_items.some(item => (
    toNum(item && item.item_id) === GOLDEN_BUG_ITEM_ID &&
    toNum(item && item.type) === GOLDEN_BUG_SOCIAL_TYPE
  )));
}

// ─── 辅助函数 ───

function isTransientNetworkError(err) {
  const msg = String(err && err.message || '');
  if (!msg) return false;
  return [
    '连接未打开', '请求超时', '请求已中断',
    '连接关闭', '发送失败', '请求队列已满'
  ].some(pattern => msg.includes(pattern));
}

/**
 * 获取作物当前所处阶段
 * 从 phases 数组最后往前找第一个 begin_time <= 当前服务器时间的阶段
 * @param {Array} phases - 阶段列表
 * @param {boolean} debug - 是否输出调试信息
 * @param {string} label - 调试标签
 */
function getCurrentPhase(phases, debug, label) {
  if (!phases || phases.length === 0) return null;
  const serverTime = getServerTimeSec();

  if (debug) {
    console.warn(`    ${label} 服务器时间=${serverTime} (${new Date(serverTime * 1000).toLocaleTimeString()})`);
    for (let i = 0; i < phases.length; i++) {
      const p = phases[i];
      const beginTime = toTimeSec(p.begin_time);
      const phaseName = PHASE_NAMES[p.phase] || `阶段${  p.phase}`;
      const diff = beginTime > 0 ? beginTime - serverTime : 0;
      const diffLabel = diff > 0 ? `(未来 ${diff}s)` : diff < 0 ? `(已过 ${-diff}s)` : '';
      console.warn(`    ${label}   [${i}] ${phaseName}(${p.phase}) begin=${beginTime} ${diffLabel} dry=${toTimeSec(p.dry_time)} weed=${toTimeSec(p.weeds_time)} insect=${toTimeSec(p.insect_time)}`);
    }
  }

  // 从后往前找最后一个已开始的阶段
  for (let i = phases.length - 1; i >= 0; i--) {
    const beginTime = toTimeSec(phases[i].begin_time);
    if (beginTime > 0 && beginTime <= serverTime) {
      if (debug) {
        console.warn(`    ${label}   → 当前阶段: ${PHASE_NAMES[phases[i].phase] || phases[i].phase}`);
      }
      return phases[i];
    }
  }
  // 所有阶段都在未来，使用第一个
  if (debug) {
    console.warn(`    ${label}   → 所有阶段都在未来，使用第一个: ${PHASE_NAMES[phases[0].phase] || phases[0].phase}`);
  }
  return phases[0];
}

// ─── 土地映射 ───

/** 构建 id → land 的地图 */
function buildLandMap(lands) {
  const map = new Map();
  const list = Array.isArray(lands) ? lands : [];
  for (const land of list) {
    const landId = toNum(land && land.id);
    if (landId > 0) map.set(landId, land);
  }
  return map;
}

/** 获取从属土地 ID 列表 */
function getSlaveLandIds(land) {
  const slaveIds = Array.isArray(land && land.slave_land_ids) ? land.slave_land_ids : [];
  return [...new Set(slaveIds.map(id => toNum(id)).filter(Boolean))];
}

/** 检查地块是否有植物数据 */
function hasPlantData(land) {
  const plant = land && land.plant;
  return !!(plant && Array.isArray(plant.phases) && plant.phases.length > 0);
}

/**
 * 获取关联的主土地
 * 如果当前土地有 master_land_id 且该主人确实拥有当前土地作为从属
 */
function getLinkedMasterLand(land, landMap) {
  const landId = toNum(land && land.id);
  const masterId = toNum(land && land.master_land_id);
  if (!masterId || masterId === landId) return null;

  const masterLand = landMap.get(masterId);
  if (!masterLand) return null;

  const slaveIds = getSlaveLandIds(masterLand);
  if (slaveIds.length > 0 && !slaveIds.includes(landId)) return null;

  return masterLand;
}

/**
 * 获取地块的显示上下文（处理合并种植）
 * @returns {{ sourceLand, occupiedByMaster, masterLandId, occupiedLandIds }} 显示用土地上下文
 */
function getDisplayLandContext(land, landMap) {
  const master = getLinkedMasterLand(land, landMap);
  if (master && hasPlantData(master)) {
    const allIds = [toNum(master.id), ...getSlaveLandIds(master)].filter(Boolean);
    return {
      sourceLand: master,
      occupiedByMaster: true,
      masterLandId: toNum(master.id),
      occupiedLandIds: allIds.length > 1 ? allIds : [toNum(master.id)].filter(Boolean)
    };
  }
  const landId = toNum(land && land.id);
  return {
    sourceLand: land,
    occupiedByMaster: false,
    masterLandId: landId,
    occupiedLandIds: [landId].filter(Boolean)
  };
}

/** 检查是否为被主土地占用的从属土地 */
function isOccupiedSlaveLand(land, landMap) {
  return !!getDisplayLandContext(land, landMap).occupiedByMaster;
}

// ─── 土地状态汇总 ───

function summarizeLandDetails(lands) {
  const summary = {
    harvestable: 0, growing: 0, empty: 0, dead: 0,
    needWater: 0, needWeed: 0, needBug: 0
  };
  for (const land of (Array.isArray(lands) ? lands : [])) {
    if (!land || !land.unlocked) continue;
    const status = String(land.status || '');
    if (status === 'harvestable') summary.harvestable++;
    else if (status === 'dead') summary.dead++;
    else if (status === 'empty') summary.empty++;
    else if (status === 'growing' || status === 'stealable' || status === 'harvested') summary.growing++;

    if (land.needWater) summary.needWater++;
    if (land.needWeed) summary.needWeed++;
    if (land.needBug) summary.needBug++;
  }
  return summary;
}

// ─── 土地分析 ───

/**
 * 分析所有土地状态
 * @param {Array} lands - 地块列表
 * @param {boolean} debug - 是否输出调试信息
 */
function analyzeLands(lands, debug = false) {
  const result = {
    harvestable: [], needWater: [], needWeed: [], needBug: [], needGoldenBug: [],
    growing: [], empty: [], dead: [], unlockable: [], upgradable: [],
    harvestableInfo: []
  };

  const serverTime = getServerTimeSec();
  const landMap = buildLandMap(lands);

  for (const land of lands) {
    const landId = toNum(land.id);

    // 未解锁
    if (!land.unlocked) {
      if (land.could_unlock) result.unlockable.push(landId);
      continue;
    }

    if (land.could_upgrade) result.upgradable.push(landId);

    // 跳过被主土地占用的从属土地
    if (isOccupiedSlaveLand(land, landMap)) continue;

    const plant = land.plant;
    if (!plant || !plant.phases || plant.phases.length === 0) {
      result.empty.push(landId);
      continue;
    }

    if (hasGoldenBug(plant)) result.needGoldenBug.push(landId);

    const plantName = plant.name || '未知作物';
    const debugLabel = `土地#${landId}(${plantName})`;
    const currentPhase = getCurrentPhase(plant.phases, debug, debugLabel);

    if (!currentPhase) {
      result.empty.push(landId);
      continue;
    }

    const phase = currentPhase.phase;

    // 枯死
    if (phase === PlantPhase.DEAD) {
      result.dead.push(landId);
      continue;
    }

    // 成熟可收获
    if (phase === PlantPhase.MATURE) {
      result.harvestable.push(landId);
      const plantId = toNum(plant.id);
      const displayName = getPlantNameOrNull(plantId) || plant.name || getPlantName(plantId);
      const plantExp = getPlantExp(plantId);
      result.harvestableInfo.push({
        landId, plantId,
        name: displayName || plantName,
        exp: plantExp
      });
      continue;
    }

    // 需要浇水（有干旱计数或干燥时间已到）
    const dryNum = toNum(plant.dry_num);
    const dryTime = toTimeSec(currentPhase.dry_time);
    if (dryNum > 0 || (dryTime > 0 && dryTime <= serverTime)) {
      result.needWater.push(landId);
    }

    // 需要除草
    const weedsTime = toTimeSec(currentPhase.weeds_time);
    const hasWeeds = (plant.weed_owners && plant.weed_owners.length > 0) ||
                     (weedsTime > 0 && weedsTime <= serverTime);
    if (hasWeeds) result.needWeed.push(landId);

    // 需要除虫
    const insectTime = toTimeSec(currentPhase.insect_time);
    const hasInsects = (plant.insect_owners && plant.insect_owners.length > 0) ||
                       (insectTime > 0 && insectTime <= serverTime);
    if (hasInsects) result.needBug.push(landId);

    result.growing.push(landId);
  }

  return result;
}

// ─── 收获后地块分类 ───

function getLandLifecycleState(land) {
  if (!land) return 'unknown';
  const plant = land.plant;
  if (!plant || !Array.isArray(plant.phases) || plant.phases.length === 0) return 'empty';

  const currentPhase = getCurrentPhase(plant.phases, false, '');
  if (!currentPhase) return 'empty';

  const phase = toNum(currentPhase.phase);
  if (phase === PlantPhase.DEAD) return 'dead';
  if (phase === PlantPhase.UNKNOWN) return 'empty';
  if (phase >= PlantPhase.SEED && phase <= PlantPhase.MATURE) return 'growing';
  return 'unknown';
}

/** 根据最新土地数据分类收获过的地块 */
function classifyHarvestedLandsByMap(landIds, landMap) {
  const removable = [];
  const growing = [];
  const unknown = [];

  for (const landId of landIds) {
    const land = landMap.get(landId);
    if (!land) { unknown.push(landId); continue; }

    const state = getLandLifecycleState(land);
    if (state === 'dead' || state === 'empty') {
      removable.push(landId);
    } else if (state === 'growing') {
      growing.push(landId);
    } else {
      unknown.push(landId);
    }
  }
  return { removable, growing, unknown };
}

/**
 * 收获后解析可铲除的地块（多季作物进入下一季的情况）
 * @param {number[]} harvestedLandIds - 已收获的地块 ID
 * @param {object} harvestResult - harvest 接口的返回结果
 */
async function resolveRemovableHarvestedLands(harvestedLandIds, harvestResult) {
  const landIds = Array.isArray(harvestedLandIds) ? harvestedLandIds.filter(Boolean) : [];
  if (landIds.length === 0) {
    return { removable: [], growing: [], fallbackRemoved: 0 };
  }

  // 先用收获结果中的数据构建土地映射
  const resultLandMap = buildLandMap(harvestResult && harvestResult.land);
  const classified = classifyHarvestedLandsByMap(landIds, resultLandMap);

  const removable = [...classified.removable];
  const growing = [...classified.growing];
  let unknown = [...classified.unknown];
  let fallbackRemoved = 0;

  // 对于未知状态的地块，重新拉取全农场数据
  if (unknown.length > 0) {
    try {
      const landsReply = await getAllLands();
      const freshLandMap = buildLandMap(landsReply && landsReply.lands);
      const reclassified = classifyHarvestedLandsByMap(unknown, freshLandMap);
      removable.push(...reclassified.removable);
      growing.push(...reclassified.growing);
      unknown = reclassified.unknown;
    } catch (err) {
      if (!isTransientNetworkError(err)) {
        logWarn('农场', `收后状态补拉失败: ${err.message}`, {
          module: 'farm', event: '收获后状态补拉', result: 'error'
        });
      }
    }
  }

  // 依然未知的地块归入可铲除
  if (unknown.length > 0) {
    removable.push(...unknown);
    fallbackRemoved = unknown.length;
  }

  return {
    removable: [...new Set(removable)],
    growing: [...new Set(growing)],
    fallbackRemoved
  };
}

// ─── 地块详情（供前端展示）──

function getLandTypeByLevel(level) {
  const lv = toNum(level);
  if (lv === 5) return 'purple';
  if (lv === 4) return 'gold';
  if (lv === 3) return 'black';
  if (lv === 2) return 'red';
  return 'normal';
}

function getLandTypeNameByLevel(level) {
  const typeMap = {
    purple: '紫土地',
    gold: '金土地',
    black: '黑土地',
    red: '红土地',
    normal: '普通地'
  };
  return typeMap[getLandTypeByLevel(level)] || '';
}

async function getLandsDetail() {
  try {
    const landsReply = await getAllLands();
    const result = { lands: [], summary: {} };
    if (!landsReply.lands) return result;

    const serverTime = getServerTimeSec();
    const details = [];
    const landMap = buildLandMap(landsReply.lands);

    for (const land of landsReply.lands) {
      const landId = toNum(land.id);
      const level = toNum(land.level);
      const maxLevel = toNum(land.max_level);
      const landsLevel = toNum(land.lands_level);
      const landSize = toNum(land.land_size);
      const landType = getLandTypeByLevel(level);
      const landTypeName = getLandTypeNameByLevel(level);
      const couldUnlock = !!land.could_unlock;
      const couldUpgrade = !!land.could_upgrade;

      const { sourceLand, occupiedByMaster, masterLandId, occupiedLandIds } =
        getDisplayLandContext(land, landMap);

      // 未解锁
      if (!land.unlocked) {
        details.push({
          id: landId, unlocked: false, status: 'locked',
          plantName: '', phaseName: '',
          level, maxLevel, landsLevel, landSize, landType, landTypeName,
          couldUnlock, couldUpgrade,
          currentSeason: 0, totalSeason: 0,
          occupiedByMaster: false, masterLandId: 0,
          occupiedLandIds: [], plantSize: 1
        });
        continue;
      }

      const plant = sourceLand && sourceLand.plant;

      // 空地
      if (!plant || !plant.phases || plant.phases.length === 0) {
        details.push({
          id: landId, unlocked: true, status: 'empty',
          plantName: '', phaseName: '空地',
          level, maxLevel, landsLevel, landSize, landType, landTypeName,
          couldUnlock, couldUpgrade,
          currentSeason: 0, totalSeason: 0,
          occupiedByMaster, masterLandId, occupiedLandIds, plantSize: 1
        });
        continue;
      }

      const currentPhase = getCurrentPhase(plant.phases, false, '');
      if (!currentPhase) {
        details.push({
          id: landId, unlocked: true, status: 'empty',
          plantName: '', phaseName: '',
          level, maxLevel, landsLevel, landSize, landType, landTypeName,
          couldUnlock, couldUpgrade,
          currentSeason: 0, totalSeason: 0,
          occupiedByMaster, masterLandId, occupiedLandIds, plantSize: 1
        });
        continue;
      }

      const phase = currentPhase.phase;
      const plantId = toNum(plant.id);
      const displayName = getPlantNameOrNull(plantId) || plant.name || getPlantName(plantId) || '未知';
      const plantInfo = getPlantById(plantId);
      const seedId = toNum(plantInfo && plantInfo.seed_id);
      const seedImage = seedId > 0 ? getSeedImageBySeedId(seedId) : '';
      const plantSize = Math.max(1, toNum(plantInfo && plantInfo.size) || 1);
      const totalSeason = Math.max(1, toNum(plantInfo && plantInfo.seasons) || 1);
      const rawSeason = toNum(plant.season);
      const currentSeason = rawSeason > 0 ? Math.min(rawSeason, totalSeason) : 1;
      const phaseName = PHASE_NAMES[phase] || '';

      // 计算剩余成熟时间
      const maturePhaseData = Array.isArray(plant.phases)
        ? plant.phases.find(p => p && toNum(p.phase) === PlantPhase.MATURE)
        : null;
      const matureTime = maturePhaseData ? toTimeSec(maturePhaseData.begin_time) : 0;
      const matureInSec = matureTime > serverTime ? matureTime - serverTime : 0;
      const totalGrowTime = getPlantGrowTime(plantId);

      // 确定状态
      let status = 'growing';
      if (phase === PlantPhase.MATURE) status = 'harvestable';
      else if (phase === PlantPhase.DEAD) status = 'dead';
      else if (phase === PlantPhase.UNKNOWN || !plant.phases.length) status = 'empty';

      // 是否需要浇水/除草/除虫
      const needWater = toNum(plant.dry_num) > 0 ||
        (toTimeSec(currentPhase.dry_time) > 0 && toTimeSec(currentPhase.dry_time) <= serverTime);
      const needWeed = (plant.weed_owners && plant.weed_owners.length > 0) ||
        (toTimeSec(currentPhase.weeds_time) > 0 && toTimeSec(currentPhase.weeds_time) <= serverTime);
      const needBug = (plant.insect_owners && plant.insect_owners.length > 0) ||
        (toTimeSec(currentPhase.insect_time) > 0 && toTimeSec(currentPhase.insect_time) <= serverTime);

      // 变异效果
      const mutantConfigIds = plant.mutant_config_ids || [];
      const mutantEffects = getMutantEffectsByIds(mutantConfigIds);

      details.push({
        id: landId, unlocked: true, status,
        plantName: displayName, plantId, seedId, seedImage,
        phaseName, currentSeason, totalSeason,
        matureInSec, totalGrowTime,
        needWater, needWeed, needBug,
        stealable: !!plant.stealable,
        level, maxLevel, landsLevel, landSize, landType, landTypeName,
        couldUnlock, couldUpgrade,
        occupiedByMaster, masterLandId, occupiedLandIds,
        plantSize, mutantEffects
      });
    }

    return { lands: details, summary: summarizeLandDetails(details) };
  } catch {
    return { lands: [], summary: {} };
  }
}

module.exports = {
  getCurrentPhase,
  buildLandMap,
  getDisplayLandContext,
  isOccupiedSlaveLand,
  analyzeLands,
  resolveRemovableHarvestedLands,
  getLandsDetail,
  getLandTypeByLevel,
  getLandTypeNameByLevel
};
