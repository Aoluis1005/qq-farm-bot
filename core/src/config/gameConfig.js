const fs = require('node:fs');
const path = require('node:path');
const { getResourcePath } = require('./runtime-paths');

// 等级经验配置
let roleLevelConfig = null;
let levelExpTable = null;

// 植物配置
let plantConfig = null;
const plantMap = new Map();          // plantId → plant
const seedToPlant = new Map();       // seedId → plant
const fruitToPlant = new Map();      // fruitId → plant

// 物品配置
let itemInfoConfig = null;
const itemInfoMap = new Map();       // itemId → itemInfo
const seedItemMap = new Map();       // seedItemId → itemInfo
const seedImageMap = new Map();      // seedId/itemId → imageUrl
const seedAssetImageMap = new Map(); // assetName → imageUrl
const skinDetailImageMap = new Map();// itemId → skinDetailImageUrl
const seedCdnFallback = new Map();   // seedId → cdnSourcePath

// 变异效果配置
let mutantEffectConfig = null;
const mutantEffectMap = new Map();       // mutantId → mutantEffect
const mutantEffectByIconMap = new Map(); // icon → mutantEffect

/** 加载所有游戏配置文件 */
function loadConfigs() {
    const basePath = getResourcePath('gameConfig');

    // 1. 加载等级经验表
    try {
        const roleLevelPath = path.join(basePath, 'RoleLevel.json');
        if (fs.existsSync(roleLevelPath)) {
            roleLevelConfig = JSON.parse(fs.readFileSync(roleLevelPath, 'utf8'));
            levelExpTable = [];
            for (const entry of roleLevelConfig) {
                levelExpTable[entry.level] = entry.exp;
            }
            console.warn(`[配置] 已加载等级经验表 (${  roleLevelConfig.length  } 级)`);
        }
    } catch (err) {
        console.warn('[配置] 加载 RoleLevel.json 失败:', err.message);
    }

    // 2. 加载植物配置
    try {
        const plantPath = path.join(basePath, 'Plant.json');
        if (fs.existsSync(plantPath)) {
            plantConfig = JSON.parse(fs.readFileSync(plantPath, 'utf8'));
            plantMap.clear();
            seedToPlant.clear();
            fruitToPlant.clear();
            for (const plant of plantConfig) {
                plantMap.set(plant.id, plant);
                if (plant.seed_id) seedToPlant.set(plant.seed_id, plant);
                if (plant.fruit && plant.fruit.id) fruitToPlant.set(plant.fruit.id, plant);
            }
            console.warn(`[配置] 已加载植物配置 (${  plantConfig.length  } 种)`);
        }
    } catch (err) {
        console.warn('[配置] 加载 Plant.json 失败:', err.message);
    }

    // 3. 加载物品配置
    try {
        const itemInfoPath = path.join(basePath, 'ItemInfo.json');
        if (fs.existsSync(itemInfoPath)) {
            itemInfoConfig = JSON.parse(fs.readFileSync(itemInfoPath, 'utf8'));
            itemInfoMap.clear();
            seedItemMap.clear();
            for (const item of itemInfoConfig) {
                const itemId = Number(item && item.id) || 0;
                if (itemId <= 0) continue;
                itemInfoMap.set(itemId, item);
                // type === 5 表示种子物品
                if (Number(item.type) === 5) {
                    seedItemMap.set(itemId, item);
                }
            }
            console.warn(`[配置] 已加载物品配置 (${  itemInfoConfig.length  } 项)`);
        }
    } catch (err) {
        console.warn('[配置] 加载 ItemInfo.json 失败:', err.message);
    }

    // 4. 加载种子图片映射
    try {
        const seedImagesPath = path.join(basePath, 'seed_images_named');
        seedImageMap.clear();
        seedAssetImageMap.clear();
        if (fs.existsSync(seedImagesPath)) {
            const files = fs.readdirSync(seedImagesPath);
            for (const filename of files) {
                const name = String(filename || '');
                const imageUrl = `/game-config/seed_images_named/${  encodeURIComponent(filename)}`;

                // 匹配 {id}_xxx.png 格式
                const namedMatch = name.match(/^(\d+)_.*\.(?:png|jpg|jpeg|webp|gif)$/i);
                if (namedMatch) {
                    const seedId = Number(namedMatch[1]) || 0;
                    if (seedId > 0 && !seedImageMap.has(seedId)) {
                        seedImageMap.set(seedId, imageUrl);
                    }
                }

                // 匹配纯 {id}.png 格式
                const numericMatch = name.match(/^(\d+)\.(?:png|jpg|jpeg|webp|gif)$/i);
                if (numericMatch) {
                    const itemId2 = Number(numericMatch[1]) || 0;
                    if (itemId2 > 0 && !seedImageMap.has(itemId2)) {
                        seedImageMap.set(itemId2, imageUrl);
                    }
                }

                // 匹配 Crop_X_Seed.png 格式（资产名映射）
                const assetMatch = name.match(/(Crop_\d+)_Seed\.(?:png|jpg|jpeg|webp|gif)$/i);
                if (assetMatch) {
                    const assetName = assetMatch[1];
                    if (assetName && !seedAssetImageMap.has(assetName)) {
                        seedAssetImageMap.set(assetName, imageUrl);
                    }
                }
            }
            console.warn(`[配置] 已加载种子图片映射 (${  seedImageMap.size  } 项)`);
        }
    } catch (err) {
        console.warn('[配置] 加载 seed_images_named 失败:', err.message);
    }

    // 5.5 加载 manifest.csv 种子 CDN 映射
    try {
        const manifestCsv = path.join(basePath, 'manifest.csv');
        seedCdnFallback.clear();
        if (fs.existsSync(manifestCsv)) {
            const lines = fs.readFileSync(manifestCsv, 'utf-8').split('\n');
            for (let i = 1; i < lines.length; i++) {
                const cols = lines[i].trim().split(',');
                if (cols.length >= 5) {
                    const name = cols[4];
                    const src = cols[1];
                    const m = name && name.match(/^Crop_(\d+)_Seed$/);
                    if (m && src) seedCdnFallback.set(Number(m[1]), src);
                }
            }
            console.log(`[配置] 已加载 manifest 种子映射 (${seedCdnFallback.size} 项)`);
        }
    } catch (err) {
        console.warn('[配置] 加载 manifest.csv 失败:', err.message);
    }

    // 5. 加载装扮道具图片映射
    try {
        const skinDetailPath = path.join(basePath, 'seed_images_named', 'skinDetail');
        skinDetailImageMap.clear();
        if (fs.existsSync(skinDetailPath)) {
            const skinFiles = fs.readdirSync(skinDetailPath);
            for (const skinFile of skinFiles) {
                const skinName = String(skinFile || '');
                const skinUrl = `/game-config/seed_images_named/skinDetail/${  encodeURIComponent(skinFile)}`;
                const skinMatch = skinName.match(/^(\d+)_img_(?:skin|nangua)_.*\.(?:png|jpg|jpeg|webp|gif)$/i);
                if (skinMatch) {
                    const skinId = Number(skinMatch[1]) || 0;
                    if (skinId > 0 && !skinDetailImageMap.has(skinId)) {
                        skinDetailImageMap.set(skinId, skinUrl);
                    }
                }
            }
            console.warn(`[配置] 已加载装扮道具图片映射 (${  skinDetailImageMap.size  } 项)`);
        }
    } catch (err) {
        console.warn('[配置] 加载 skinDetail 失败:', err.message);
    }

    // 6. 加载变异效果配置
    try {
        const mutantPath = path.join(basePath, 'MutantEffect.json');
        if (fs.existsSync(mutantPath)) {
            mutantEffectConfig = JSON.parse(fs.readFileSync(mutantPath, 'utf8'));
            mutantEffectMap.clear();
            mutantEffectByIconMap.clear();
            for (const mutant of mutantEffectConfig) {
                const mutantId = Number(mutant && mutant.id) || 0;
                if (mutantId <= 0) continue;
                mutantEffectMap.set(mutantId, mutant);
                if (mutant.icon) mutantEffectByIconMap.set(mutant.icon, mutant);
            }
            console.warn(`[配置] 已加载变异效果配置 (${  mutantEffectConfig.length  } 种)`);
        }
    } catch (err) {
        console.warn('[配置] 加载 MutantEffect.json 失败:', err.message);
    }
}

/** 获取等级经验表 */
function getLevelExpTable() {
    return levelExpTable;
}

/**
 * 获取升级所需经验进度
 * @returns {{current: number, needed: number}}
 */
function getLevelExpProgress(level, exp) {
    const result = { current: 0, needed: 0 };
    if (!levelExpTable || level <= 0) return result;

    const currentLevelExp = levelExpTable[level] || 0;
    const nextLevelExp = levelExpTable[level + 1] || currentLevelExp + 1;
    const progress = Math.max(0, exp - currentLevelExp);
    const totalNeeded = nextLevelExp - currentLevelExp;

    return { current: progress, needed: totalNeeded };
}

/** 根据植物ID获取植物 */
function getPlantById(plantId) {
    return plantMap.get(plantId);
}

/** 根据种子ID获取植物 */
function getPlantBySeedId(seedId) {
    return seedToPlant.get(seedId);
}

/** 根据植物ID获取植物名 */
function getPlantName(plantId) {
    const plant = plantMap.get(plantId);
    return plant ? plant.name : `植物${  plantId}`;
}

/** 根据种子ID获取植物名 */
function getPlantNameBySeedId(seedId) {
    const plant = seedToPlant.get(seedId);
    return plant ? plant.name : `种子${  seedId}`;
}

/**
 * 获取植物生长总时间（秒）
 * @param {number} plantId - 植物ID
 * @returns {number} 总生长秒数
 */
function getPlantGrowTime(plantId) {
    const plant = plantMap.get(plantId);
    if (!plant || !plant.grow_phases) return 0;

    const phases = plant.grow_phases.split(';').filter(Boolean);
    let totalSeconds = 0;
    for (const phase of phases) {
        const match = phase.match(/:(\d+)/);
        if (match) {
            totalSeconds += Number.parseInt(match[1]);
        }
    }
    return totalSeconds;
}

/**
 * 格式化生长时间
 * @param {number} seconds - 秒数
 * @returns {string} 格式化后的时间字符串
 */
function formatGrowTime(seconds) {
    if (seconds < 60) return `${seconds  }秒`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)  }分钟`;

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return minutes > 0 ? `${hours  }小时${  minutes  }分` : `${hours  }小时`;
}

/** 获取植物种植经验 */
function getPlantExp(plantId) {
    const plant = plantMap.get(plantId);
    return plant ? plant.exp : 0;
}

/**
 * 获取种子收获信息
 * @param {number} seedId - 种子ID
 * @returns {{expPerSeason: number, seasons: number, incomePerSeason: number}}
 */
function getSeedHarvestInfo(seedId) {
    const plant = seedToPlant.get(seedId);
    if (!plant) {
        return { expPerSeason: 0, seasons: 1, incomePerSeason: 0 };
    }

    const expPerSeason = plant.exp || 0;
    const seasons = plant.seasons || 1;
    const fruitCount = (plant.fruit && plant.fruit.count) || 0;

    // 通过种子ID的末位匹配果实价格
    const seedIdStr = String(seedId);
    const suffix = seedIdStr.slice(-4);
    let fruitUnitPrice = 0;

    for (const [itemId, itemInfo] of itemInfoMap) {
        // type === 4 表示果实类型物品
        if (Number(itemInfo.type) === 4) {
            const itemIdStr = String(itemId);
            if (itemIdStr.endsWith(suffix)) {
                fruitUnitPrice = Number(itemInfo.price) || 0;
                break;
            }
        }
    }

    const incomePerSeason = fruitUnitPrice * fruitCount;
    return { expPerSeason, seasons, incomePerSeason };
}

/** 根据果实ID获取果实名 */
function getFruitName(fruitId) {
    const plant = fruitToPlant.get(fruitId);
    return plant ? plant.name : `果实${  fruitId}`;
}

/** 根据果实ID获取植物 */
function getPlantByFruitId(fruitId) {
    return fruitToPlant.get(fruitId);
}

/** 获取所有种子列表 */
function getAllSeeds() {
    return Array.from(seedToPlant.values()).map(plant => ({
        seedId: plant.seed_id,
        name: plant.name,
        requiredLevel: Number(plant.land_level_need) || 0,
        price: getSeedPrice(plant.seed_id),
        image: getSeedImageBySeedId(plant.seed_id)
    }));
}

/** 内部函数：根据ID映射种子图片 */
function getMappedSeedImage(id) {
    const numericId = Number(id) || 0;
    if (numericId <= 0) return '';

    // 先查种子图片映射
    const directImage = seedImageMap.get(numericId);
    if (directImage) return directImage;

    // 再通过物品的 asset_name 查找
    const itemInfo = itemInfoMap.get(numericId);
    const assetName = itemInfo && itemInfo.asset_name ? String(itemInfo.asset_name).trim() : '';
    if (!assetName) return '';

    return seedAssetImageMap.get(assetName) || '';
}

/** 根据种子ID获取图片 */
function getSeedImageBySeedId(seedId) {
    return getMappedSeedImage(seedId);
}

/** 根据物品ID获取图片 */
function getItemImageById(itemId) {
    const numericId = Number(itemId) || 0;
    if (numericId <= 0) return '';

    const tryGetImage = (targetId) => {
        const img = seedImageMap.get(targetId);
        if (img) return img;
        const info = itemInfoMap.get(targetId);
        const assetName = info && info.asset_name ? String(info.asset_name) : '';
        if (assetName) {
            const assetImg = seedAssetImageMap.get(assetName);
            if (assetImg) return assetImg;
        }
        return '';
    };

    // 1. 先直接查找
    let image = tryGetImage(numericId);
    if (image) return image;

    // 2. 尝试通过果实ID找到植物，再用种子ID查找
    const plant = getPlantByFruitId(numericId);
    if (plant && plant.seed_id) {
        image = tryGetImage(plant.seed_id);
        if (image) return image;
    }

    // 3. 查找装扮道具图片映射
    const skinImg = skinDetailImageMap.get(numericId);
    if (skinImg) return skinImg;

    // 5. 查 manifest 种子 CDN 映射
    const cdnSeed = seedCdnFallback.get(numericId);
    if (cdnSeed) return `/api/game-asset?seedId=${numericId}`;

    return '';
}

/** 根据物品ID获取物品信息 */
function getItemById(itemId) {
    return itemInfoMap.get(Number(itemId) || 0);
}

/** 判断是否是种子物品 */
function isSeedItem(itemId) {
    return seedItemMap.has(Number(itemId) || 0);
}

/** 获取种子价格 */
function getSeedPrice(seedId) {
    const item = seedItemMap.get(Number(seedId) || 0);
    return item ? Number(item.price) || 0 : 0;
}

/** 获取种子所需等级 */
function getSeedLevel(seedId) {
    const item = seedItemMap.get(Number(seedId) || 0);
    return item ? Number(item.level) || 0 : 0;
}

/** 获取果实单价 */
function getFruitPrice(fruitId) {
    const item = itemInfoMap.get(Number(fruitId) || 0);
    return item ? Number(item.price) || 0 : 0;
}

/** 根据种子ID获取果实层级 */
function getFruitLayerBySeedId(seedId) {
    const numericSeedId = Number(seedId) || 0;
    const plant = seedToPlant.get(numericSeedId);
    if (!plant) {
        console.warn(`[getFruitLayerBySeedId] 未找到种子ID ${  numericSeedId  } 对应的植物`);
        return 0;
    }
    if (!plant.fruit || !plant.fruit.id) {
        console.warn(`[getFruitLayerBySeedId] 种子ID ${  numericSeedId  } 的植物没有果实信息`);
        return 0;
    }

    const fruitId = Number(plant.fruit.id) || 0;
    const fruitItem = itemInfoMap.get(fruitId);
    if (!fruitItem) {
        console.warn(`[getFruitLayerBySeedId] 未找到果实ID ${  fruitId  } 的物品信息`);
        return 0;
    }

    return Number(fruitItem.layer) || 0;
}

/** 根据果实ID获取果实层级 */
function getFruitLayerByFruitId(fruitId) {
    const numericFruitId = Number(fruitId) || 0;
    const fruitItem = itemInfoMap.get(numericFruitId);
    if (!fruitItem) return 0;
    return Number(fruitItem.layer) || 0;
}

/** 获取所有植物列表 */
function getAllPlants() {
    return Array.from(plantMap.values());
}

/** 根据变异效果ID获取变异效果 */
function getMutantEffectById(mutantId) {
    return mutantEffectMap.get(Number(mutantId) || 0);
}

/** 根据图标获取变异效果 */
function getMutantEffectByIcon(icon) {
    return mutantEffectByIconMap.get(String(icon || ''));
}

/** 获取所有变异效果 */
function getAllMutantEffects() {
    return mutantEffectConfig || [];
}

/** 根据多个变异效果ID批量获取 */
function getMutantEffectsByIds(ids) {
    if (!Array.isArray(ids)) return [];
    return ids
        .map(id => mutantEffectMap.get(Number(id) || 0))
        .filter(effect => effect !== undefined);
}

// 启动时加载配置
loadConfigs();

module.exports = {
    loadConfigs,
    getAllPlants,
    getAllSeeds,
    getLevelExpTable,
    getLevelExpProgress,
    getPlantById,
    getPlantBySeedId,
    getPlantName,
    getPlantNameBySeedId,
    getPlantGrowTime,
    getPlantExp,
    formatGrowTime,
    getSeedHarvestInfo,
    getFruitName,
    getPlantByFruitId,
    getItemById,
    getItemImageById,
    isSeedItem,
    getSeedPrice,
    getFruitPrice,
    getFruitLayerBySeedId,
    getFruitLayerByFruitId,
    getSeedImageBySeedId,
    getSeedLevel,
    getMutantEffectById,
    getMutantEffectByIcon,
    getAllMutantEffects,
    getMutantEffectsByIds
};