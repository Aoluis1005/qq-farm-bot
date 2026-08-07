<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'

const props = withDefaults(defineProps<{
  land: any
  showActions?: boolean
}>(), {
  showActions: true,
})

defineEmits<{
  (e: 'fertilize', land: any): void
  (e: 'remove', land: any): void
}>()

const land = computed(() => props.land)
const now = ref(Date.now())
let timer: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  timer = setInterval(() => {
    now.value = Date.now()
  }, 1000)
})

onUnmounted(() => {
  if (timer)
    clearInterval(timer)
})

const growProgress = computed(() => {
  const matureInSec = land.value.matureInSec || 0
  const totalGrowTime = land.value.totalGrowTime || 0

  if (totalGrowTime <= 0 || matureInSec <= 0)
    return 0

  return Math.min(100, Math.max(0, (matureInSec / totalGrowTime) * 100))
})

const canFertilize = computed(() =>
  props.showActions
  && Number(land.value?.matureInSec) > 0
  && land.value?.status !== 'locked'
  && land.value?.status !== 'empty',
)

const canRemove = computed(() =>
  props.showActions
  && land.value?.status !== 'locked'
  && land.value?.status !== 'empty'
  && Boolean(
    land.value?.plantName
    || land.value?.seedImage
    || Number(land.value?.matureInSec) > 0
    || ['dead', 'growing', 'harvestable', 'stealable'].includes(String(land.value?.status || '')),
  ),
)

const mutantEffects = computed(() => {
  const effects = Array.isArray(land.value?.mutantEffects) ? land.value.mutantEffects : []
  return effects
    .map((effect: any) => {
      const icon = String(effect?.icon || '').trim()
      return {
        id: Number(effect?.id) || 0,
        name: String(effect?.name || effect?.effect_name || icon || '变异').trim(),
        icon,
        image: icon ? `/game-config/seed_images_named/mutant/${icon}.png` : '',
        tag: String(effect?.tag || '').trim(),
      }
    })
    .filter((effect: any) => effect.icon)
})

function getLandStatusClass(targetLand: any) {
  const status = targetLand.status
  const level = Number(targetLand.level) || 0

  if (status === 'locked')
    return 'bg-gray-100 dark:bg-gray-800 opacity-60 border-dashed'

  let baseClass = 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700'

  switch (level) {
    case 1:
      baseClass = 'bg-yellow-50/80 dark:bg-yellow-900/10 border-yellow-200 dark:border-yellow-800'
      break
    case 2:
      baseClass = 'bg-red-50/80 dark:bg-red-900/10 border-red-200 dark:border-red-800'
      break
    case 3:
      baseClass = 'land-level-black bg-gray-300 dark:bg-gray-700 border-gray-400 dark:border-gray-500 text-gray-900 dark:text-gray-100'
      break
    case 4:
      baseClass = 'bg-amber-100/80 dark:bg-amber-900/20 border-amber-300 dark:border-amber-600'
      break
    case 5:
      baseClass = 'bg-purple-100/80 dark:bg-purple-900/20 border-purple-300 dark:border-purple-700'
      break
  }

  if (status === 'dead')
    return 'bg-gray-200 dark:bg-gray-700 border-gray-300 dark:border-gray-600 grayscale'

  if (status === 'harvestable')
    return `${baseClass} ring-2 ring-yellow-500 ring-offset-1 dark:ring-offset-gray-900`

  if (status === 'stealable')
    return `${baseClass} ring-2 ring-purple-500 ring-offset-1 dark:ring-offset-gray-900`

  if (mutantEffects.value.length > 0)
    return `${baseClass} ring-1 ring-pink-300 dark:ring-pink-700`

  return baseClass
}

function formatTime(sec: number) {
  if (sec <= 0)
    return ''

  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  return `${h > 0 ? `${h}:` : ''}${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

function getSafeImageUrl(url: string) {
  if (!url)
    return ''
  if (url.startsWith('http://'))
    return url.replace('http://', 'https://')
  return url
}

function getLandTypeName(level: number) {
  const typeMap: Record<number, string> = {
    0: '普通地',
    1: '黄土地',
    2: '红土地',
    3: '黑土地',
    4: '金土地',
    5: '紫土地',
  }
  return typeMap[Number(level) || 0] || ''
}

function getDisplayLandTypeName(targetLand: any) {
  return targetLand?.landTypeName || getLandTypeName(Number(targetLand?.level) || 0)
}

function getPlantSizeText(targetLand: any) {
  const size = Number(targetLand?.plantSize) || 1
  if (size <= 1)
    return ''
  return `${size}x${size}`
}
</script>

<template>
  <div
    class="relative min-h-[140px] flex flex-col items-center border rounded-lg p-2 transition dark:border-gray-700 hover:shadow-md"
    :class="[getLandStatusClass(land), { 'land-card--merged': Number(land.plantSize) > 1 }]"
  >
    <div class="land-card-id absolute left-1 top-1 text-[10px] text-gray-400 font-mono">
      #{{ land.id }}
    </div>

    <div
      v-if="land.plantSize > 1"
      class="absolute right-1 top-1 z-10 rounded bg-pink-100 px-1.5 py-0.5 text-[10px] font-semibold text-pink-700 dark:bg-pink-900/30 dark:text-pink-300"
    >
      合种 {{ getPlantSizeText(land) }}
    </div>

    <!-- 合种（2x2 合并）土地：跨 2 行 2 列占位，直观区别于普通土地 -->
    <div
      v-if="Number(land.plantSize) > 1"
      class="pointer-events-none absolute inset-x-0 top-0 h-[3px] rounded-t-lg bg-gradient-to-r from-pink-400 via-fuchsia-400 to-pink-400 opacity-80"
    />

    <div
      v-if="mutantEffects.length > 0"
      class="absolute left-1 top-5 flex flex-col gap-1"
    >
      <img
        v-for="effect in mutantEffects"
        :key="`${land.id}-${effect.id}-${effect.icon}`"
        :src="effect.image"
        :alt="effect.name"
        :title="effect.tag && effect.tag !== '无' ? `${effect.name} · ${effect.tag}` : effect.name"
        class="h-4 w-4 rounded-sm object-contain drop-shadow-sm"
        loading="lazy"
      >
    </div>

    <div
      class="mb-1 mt-4 flex items-center justify-center"
      :class="Number(land.plantSize) > 1 ? 'h-14 w-14' : 'h-10 w-10'"
    >
      <img
        v-if="land.seedImage"
        :src="getSafeImageUrl(land.seedImage)"
        class="max-h-full max-w-full object-contain"
        loading="lazy"
        referrerpolicy="no-referrer"
      >
      <div v-else class="i-carbon-sprout text-xl text-gray-300" />
    </div>

    <div class="land-card-name w-full truncate px-1 text-center text-xs text-gray-900 font-bold dark:text-gray-100" :title="land.plantName">
      {{ land.plantName || '-' }}
    </div>

    <div class="land-card-meta mb-0.5 mt-0.5 w-full text-center text-[10px] text-gray-500">
      <span v-if="land.matureInSec > 0" class="text-orange-500">
        预计 {{ formatTime(land.matureInSec) }} 后成熟
      </span>
      <span v-else>
        {{ land.phaseName || (land.status === 'locked' ? '未解锁' : '未开垦') }}
      </span>
    </div>

    <div v-if="land.matureInSec > 0 && land.totalGrowTime > 0" class="w-full px-1">
      <div class="rainbow-progress-bar">
        <div
          class="rainbow-progress-fill"
          :style="{ width: `${growProgress}%` }"
        />
      </div>
    </div>

    <div class="land-card-type text-[10px] text-gray-400">
      {{ getDisplayLandTypeName(land) }}
    </div>

    <div class="land-card-type mb-1 text-[10px] text-gray-400">
      季数 {{ land.totalSeason > 0 ? (`${land.currentSeason}/${land.totalSeason}`) : '-/-' }}
    </div>

    <div class="mt-auto flex origin-bottom scale-90 gap-0.5 text-[10px]">
      <span v-if="land.needWater" class="rounded bg-blue-100 px-0.5 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">水</span>
      <span v-if="land.needWeed" class="rounded bg-green-100 px-0.5 text-green-700 dark:bg-green-900/30 dark:text-green-400">草</span>
      <span v-if="land.needBug" class="rounded bg-red-100 px-0.5 text-red-700 dark:bg-red-900/30 dark:text-red-400">虫</span>
      <span v-if="land.status === 'harvestable'" class="rounded bg-orange-100 px-0.5 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">可收</span>
      <span v-else-if="land.status === 'stealable'" class="rounded bg-purple-100 px-0.5 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">可偷</span>
    </div>

    <div v-if="canFertilize || canRemove" class="grid grid-cols-2 mt-2 h-7 w-full gap-1">
      <button
        v-if="canFertilize"
        type="button"
        class="land-action-button text-emerald-700 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-900/30"
        title="催熟"
        @click="$emit('fertilize', land)"
      >
        <span class="i-carbon-growth text-sm" />
        <span>催熟</span>
      </button>
      <div v-else />

      <button
        v-if="canRemove"
        type="button"
        class="land-action-button text-red-700 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-900/30"
        title="铲除作物"
        @click="$emit('remove', land)"
      >
        <span class="i-carbon-trash-can text-sm" />
        <span>铲除</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.land-action-button {
  height: 28px;
  min-width: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 3px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.78);
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
  box-shadow: inset 0 0 0 1px currentColor;
  transition:
    background-color 0.15s ease,
    transform 0.15s ease;
}

.land-action-button:hover {
  transform: translateY(-1px);
}

.land-level-black .land-card-id,
.land-level-black .land-card-meta,
.land-level-black .land-card-type {
  color: #475569;
}

:global(.dark) .land-level-black .land-card-id,
:global(.dark) .land-level-black .land-card-meta,
:global(.dark) .land-level-black .land-card-type {
  color: #cbd5e1;
}

.land-level-black .land-card-name {
  color: #111827;
  text-shadow: none;
}

:global(.dark) .land-level-black .land-card-name {
  color: #f8fafc;
  text-shadow: 0 1px 1px rgba(0, 0, 0, 0.65);
}

.land-level-black .land-action-button {
  background: rgba(255, 255, 255, 0.78);
}

:global(.dark) .land-level-black .land-action-button {
  background: rgba(255, 255, 255, 0.9);
}

.rainbow-progress-bar {
  width: 80%;
  margin: 0 auto;
  height: 8px;
  background: linear-gradient(145deg, #f0f0f0, #e6e6e6);
  border-radius: 10px;
  overflow: hidden;
  box-shadow:
    inset 3px 3px 6px rgba(0, 0, 0, 0.1),
    inset -3px -3px 6px rgba(255, 255, 255, 0.9),
    2px 2px 4px rgba(0, 0, 0, 0.05);
  position: relative;
}

.rainbow-progress-bar::before {
  content: '';
  position: absolute;
  top: 1px;
  left: 2px;
  right: 2px;
  height: 3px;
  background: linear-gradient(90deg, rgba(255, 255, 255, 0.8), rgba(255, 255, 255, 0.2));
  border-radius: 10px 10px 0 0;
  pointer-events: none;
}

.rainbow-progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #ff6b9d 0%, #ff9f43 20%, #ffd32a 40%, #26de81 60%, #45aaf2 80%, #a55eea 100%);
  border-radius: 10px;
  transition: width 1s linear;
  position: relative;
  box-shadow:
    inset 0 2px 4px rgba(255, 255, 255, 0.6),
    inset 0 -1px 2px rgba(0, 0, 0, 0.1);
  animation: cute-pulse 2s ease-in-out infinite;
}

.rainbow-progress-fill::after {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: linear-gradient(90deg, transparent 0%, rgba(255, 255, 255, 0.4) 50%, transparent 100%);
  animation: shimmer 2s infinite;
  border-radius: 10px;
}

@keyframes cute-pulse {
  0%,
  100% {
    filter: brightness(1) saturate(1);
  }
  50% {
    filter: brightness(1.1) saturate(1.1);
  }
}

@keyframes shimmer {
  0% {
    transform: translateX(-100%);
  }
  100% {
    transform: translateX(100%);
  }
}

@media (prefers-color-scheme: dark) {
  .rainbow-progress-bar {
    background: linear-gradient(145deg, #2a2a2a, #1e1e1e);
    box-shadow:
      inset 3px 3px 6px rgba(0, 0, 0, 0.3),
      inset -3px -3px 6px rgba(60, 60, 60, 0.3),
      2px 2px 4px rgba(0, 0, 0, 0.2);
  }

  .rainbow-progress-bar::before {
    background: linear-gradient(90deg, rgba(255, 255, 255, 0.1), rgba(255, 255, 255, 0.02));
  }

  .rainbow-progress-fill {
    box-shadow:
      inset 0 2px 4px rgba(255, 255, 255, 0.2),
      inset 0 -1px 2px rgba(0, 0, 0, 0.2);
  }
}

/* ===== 合种（2x2 合并）土地：跨 2 行 2 列，直观区别于普通土地 ===== */
.land-card--merged {
  grid-column: span 2;
  grid-row: span 2;
  min-height: 220px;
}
.land-card--merged .land-seed-icon {
  width: 56px;
  height: 56px;
}
.land-card--merged .land-card-id {
  font-size: 11px;
}

</style>
