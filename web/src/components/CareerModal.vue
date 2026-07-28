<template>
  <Transition name="career-fade">
    <div
      v-if="show"
      class="fixed inset-0 z-[1100] flex items-center justify-center p-4 backdrop-blur-sm bg-black/40 sm:p-6 dark:bg-black/55"
      @click.self="close"
    >
      <div
        class="career-card relative w-full max-w-[90vw] max-h-[82dvh] overflow-y-auto rounded-3xl bg-white/70 p-5 shadow-2xl ring-1 ring-white/50 backdrop-blur-2xl sm:max-w-[560px] sm:max-h-[86vh] sm:p-6 dark:bg-gray-800/70 dark:ring-white/10"
        @click.stop
      >
        <button
          class="absolute right-3 top-3 z-10 text-gray-400 hover:text-gray-600 sm:right-4 sm:top-4 dark:hover:text-gray-200"
          aria-label="关闭"
          @click="close"
        >
          <svg class="h-5 w-5 sm:h-6 sm:w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 6l12 12M6 18L18 6" />
          </svg>
        </button>

        <div v-if="loading" class="flex items-center justify-center py-16">
          <div class="flex items-center gap-2 text-gray-500">
            <svg class="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10" stroke-opacity="0.25" />
              <path d="M22 12a10 10 0 0 1-10 10" stroke-linecap="round" />
            </svg>
            <span>加载中…</span>
          </div>
        </div>
        <div v-else-if="errorMsg" class="flex items-center justify-center py-16">
          <div class="text-center">
            <div class="text-red-500">{{ errorMsg }}</div>
            <button class="mt-3 rounded bg-blue-500 px-4 py-2 text-white" @click="load">重试</button>
          </div>
        </div>

        <template v-else-if="player">
          <div class="flex items-start gap-3 pb-3 sm:gap-4 sm:pb-4">
            <img
              v-if="player.avatar"
              :src="player.avatar"
              :alt="player.name"
              decoding="async"
              class="h-14 w-14 flex-shrink-0 rounded-full bg-gray-200 object-cover ring-1 ring-gray-200 sm:h-16 sm:w-16 dark:ring-gray-600"
              @error="onAvatarError"
            />
            <div
              v-else
              class="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-gray-200 to-gray-300 text-xl font-bold text-gray-500 sm:h-16 sm:w-16 dark:from-gray-600 dark:to-gray-700"
            >
              {{ (player.name || '?').charAt(0).toUpperCase() }}
            </div>

            <div class="min-w-0 flex-1 pt-0.5">
              <div class="truncate pr-7 text-lg font-bold text-gray-900 sm:text-xl dark:text-gray-100">
                {{ player.name || '未设置昵称' }}
              </div>
              <div class="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] sm:text-xs">
                <span class="rounded bg-orange-100 px-1.5 py-0.5 font-medium text-orange-700 dark:bg-orange-900/40 dark:text-orange-300">
                  Lv.{{ player.level || 0 }}
                </span>
                <span class="rounded bg-blue-50 px-1.5 py-0.5 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                  经验 {{ formatNumber(player.exp || 0) }}
                </span>
              </div>
              <div class="mt-1 truncate text-[11px] text-gray-500 sm:text-xs dark:text-gray-400" :title="String(player.gid || 0)">
                角色编号：{{ player.gid || 0 }}
              </div>
            </div>
          </div>

          <div class="mb-3 rounded-xl border border-amber-200/70 bg-amber-50/60 p-2.5 sm:mb-4 sm:p-3 dark:border-amber-700/40 dark:bg-amber-900/10">
            <div class="mb-2 text-center text-sm font-semibold text-amber-800 dark:text-amber-200">生涯</div>
            <div class="grid grid-cols-2 gap-2 sm:gap-3">
              <div class="min-w-0 rounded-lg bg-white/75 px-2 py-2 text-center dark:bg-gray-800/55">
                <div class="flex items-center justify-center gap-1 text-[10px] font-medium text-orange-700 sm:text-xs dark:text-orange-300">
                  <img v-if="iconHarvest" :src="iconHarvest" alt="" decoding="async" class="h-5 w-5 flex-shrink-0 object-contain" @error="onStatIconError('harvest')" />
                  <span class="whitespace-nowrap">历史累计收获</span>
                </div>
                <div class="mt-0.5 whitespace-nowrap text-base font-extrabold leading-tight text-orange-600 sm:text-lg dark:text-orange-200" :title="formatNumber(totalHarvest)">
                  {{ formatCompactNumber(totalHarvest) }}
                </div>
              </div>
              <div class="min-w-0 rounded-lg bg-white/75 px-2 py-2 text-center dark:bg-gray-800/55">
                <div class="flex items-center justify-center gap-1 text-[10px] font-medium text-rose-700 sm:text-xs dark:text-rose-300">
                  <img v-if="iconSteal" :src="iconSteal" alt="" decoding="async" class="h-5 w-5 flex-shrink-0 object-contain" @error="onStatIconError('steal')" />
                  <span class="whitespace-nowrap">累计摘取好友作物</span>
                </div>
                <div class="mt-0.5 whitespace-nowrap text-base font-extrabold leading-tight text-rose-600 sm:text-lg dark:text-rose-200" :title="formatNumber(totalFriendPick)">
                  {{ formatCompactNumber(totalFriendPick) }}
                </div>
              </div>
            </div>

            <div v-if="podiumItems.length" class="mt-3 grid grid-cols-3 items-end gap-2 border-t border-amber-200/60 pt-3 dark:border-amber-700/30">
              <div v-for="entry in podiumItems" :key="`podium-${entry.item.id}`" class="min-w-0 text-center">
                <div
                  class="mx-auto mb-1 flex h-7 w-7 items-center justify-center rounded-full text-xs font-extrabold text-white shadow"
                  :class="rankBadgeClass(entry.rank - 1)"
                >
                  {{ entry.rank }}
                </div>
                <img
                  v-if="entry.item.image && !itemImageErrors[entry.item.id]"
                  :src="entry.item.image"
                  :alt="entry.item.name"
                  decoding="async"
                  class="mx-auto h-14 w-14 object-contain sm:h-16 sm:w-16"
                  @error="onItemImageError(entry.item.id)"
                />
                <div v-else class="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-green-100 text-sm font-bold text-green-700 sm:h-16 sm:w-16 dark:bg-green-900/40 dark:text-green-300">
                  {{ entry.item.name?.charAt(0) || '?' }}
                </div>
                <div class="mt-1 truncate text-[10px] text-gray-500 sm:text-xs" :title="entry.item.name">{{ entry.item.name }}</div>
                <div class="whitespace-nowrap text-sm font-extrabold text-amber-900 sm:text-base dark:text-amber-100" :title="formatNumber(entry.item.count)">
                  {{ formatCompactNumber(entry.item.count) }}
                </div>
              </div>
            </div>
          </div>

          <div class="mb-2 flex items-baseline gap-2 text-sm font-semibold text-gray-900 sm:text-base dark:text-gray-100">
            <span>收获明细</span>
            <span class="text-[10px] font-normal text-gray-400 sm:text-xs">({{ items.length }})</span>
          </div>
          <div v-if="remainingItems.length" class="grid grid-cols-4 gap-2 sm:gap-3">
            <div
              v-for="item in remainingItems"
              :key="item.id"
              class="min-w-0 rounded-lg border border-gray-100 bg-gray-50 p-1.5 text-center sm:p-2 dark:border-gray-700 dark:bg-gray-700/50"
            >
              <img
                v-if="item.image && !itemImageErrors[item.id]"
                :src="item.image"
                :alt="item.name"
                loading="lazy"
                decoding="async"
                class="mx-auto h-10 w-10 object-contain sm:h-12 sm:w-12"
                @error="onItemImageError(item.id)"
              />
              <div v-else class="mx-auto flex h-10 w-10 items-center justify-center rounded bg-green-100 text-xs font-bold text-green-700 sm:h-12 sm:w-12 dark:bg-green-900/40 dark:text-green-300">
                {{ item.name?.charAt(0) || '?' }}
              </div>
              <div class="mt-1 truncate text-[10px] font-medium text-gray-700 sm:text-xs dark:text-gray-200" :title="item.name">{{ item.name }}</div>
              <div class="whitespace-nowrap text-[11px] font-bold text-gray-800 sm:text-sm dark:text-gray-100" :title="formatNumber(item.count)">
                {{ formatCompactNumber(item.count) }}
              </div>
            </div>
          </div>
          <button
            v-if="visibleCount < items.length"
            class="mt-3 w-full rounded-lg bg-gray-100 py-2 text-xs text-gray-600 transition-colors hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
            @click="visibleCount += 40"
          >
            加载更多（剩余 {{ items.length - visibleCount }}）
          </button>
          <div v-if="!items.length" class="py-8 text-center text-gray-400">暂无收获数据</div>
        </template>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useAccountStore } from '@/stores/account'
import { useStatusStore } from '@/stores/status'
import api from '@/api'

type CareerItem = { id: number; count: number; name: string; image: string; level: number; rarity: number }

const props = defineProps<{ show: boolean }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const accountStore = useAccountStore()
const { currentAccountId } = storeToRefs(accountStore)
const statusStore = useStatusStore()

const loading = ref(false)
const errorMsg = ref('')
const items = ref<CareerItem[]>([])
const player = ref<{ gid: number; name: string; avatar: string; openid: string; level: number; exp: number } | null>(null)
const totalHarvest = ref(0)
const totalFriendPick = ref(0)
const visibleCount = ref(35)
const itemImageErrors = ref<Record<number, boolean>>({})
const statIconErrors = ref<Record<string, boolean>>({})

const iconHarvest = computed(() => statIconErrors.value.harvest ? '' : `/game-config/seed_images_named/${encodeURIComponent('10001_收获_icon_harvest.png')}`)
const iconSteal = computed(() => statIconErrors.value.steal ? '' : `/game-config/seed_images_named/${encodeURIComponent('10008_摘菜_icon_steal.png')}`)

const podiumItems = computed(() => {
  const order = [1, 0, 2]
  return order.flatMap((index) => {
    const item = items.value[index]
    return item ? [{ item, rank: index + 1 }] : []
  })
})
const remainingItems = computed(() => items.value.slice(3, visibleCount.value))

function onItemImageError(id: number) {
  itemImageErrors.value[id] = true
}
function onAvatarError(e: Event) {
  const img = e.target as HTMLImageElement
  if (img) img.style.display = 'none'
}
function onStatIconError(key: 'harvest' | 'steal') {
  statIconErrors.value[key] = true
}
function rankBadgeClass(idx: number) {
  if (idx === 0) return 'bg-gradient-to-br from-yellow-300 to-yellow-600 ring-1 ring-yellow-200/60'
  if (idx === 1) return 'bg-gradient-to-br from-gray-300 to-gray-500 ring-1 ring-gray-200/60'
  return 'bg-gradient-to-br from-orange-300 to-orange-600 ring-1 ring-orange-200/60'
}
function formatNumber(n: number) {
  if (!Number.isFinite(n)) return '0'
  return Math.round(n).toLocaleString('zh-CN')
}
function formatCompactNumber(n: number) {
  if (!Number.isFinite(n)) return '0'
  const value = Math.round(n)
  if (Math.abs(value) >= 100000000) return `${trimDecimal(value / 100000000)}亿`
  if (Math.abs(value) >= 10000) return `${trimDecimal(value / 10000)}万`
  return value.toLocaleString('zh-CN')
}
function trimDecimal(n: number) {
  return n.toFixed(1).replace(/\.0$/, '')
}

async function load() {
  if (!currentAccountId.value) {
    errorMsg.value = '请先选择账号'
    return
  }
  loading.value = true
  errorMsg.value = ''
  visibleCount.value = 35
  try {
    const res = await api.get('/api/career', { timeout: 15000 })
    const payload = res?.data || {}
    if (!payload?.ok) {
      const raw = payload?.error || '获取生涯统计失败'
      errorMsg.value = raw === 'API Timeout'
        ? '加载超时，请确认该账号已在游戏中上线后重试'
        : raw
      items.value = []
      player.value = null
      totalHarvest.value = 0
      totalFriendPick.value = 0
      return
    }
    const data = payload.data || {}
    const pl = data.player || {}
    const stStatus = statusStore.status?.status || statusStore.status || {}
    player.value = {
      gid: Number(pl.gid || stStatus.gid || 0),
      name: pl.name || stStatus.nickname || stStatus.name || '',
      avatar: pl.avatar || stStatus.avatar_url || stStatus.avatar || '',
      openid: pl.openid || stStatus.openid || '',
      level: Number(pl.level || stStatus.level || 0),
      exp: Number(pl.exp || stStatus.exp || stStatus.expCurrent || 0),
    }
    const meta = data.meta || {}
    totalHarvest.value = Number(meta.stats_total || 0)
    totalFriendPick.value = Number(meta.stats_count || 0)
    items.value = (data.items || []).map((it: any) => ({
      id: Number(it.id || 0),
      count: Number(it.count || 0),
      name: String(it.name || `物品 ${it.id}`),
      image: itemImageErrors.value[Number(it.id)] ? '' : (it.image || ''),
      level: Number(it.level || 0),
      rarity: Number(it.rarity || 0),
    }))
  }
  catch (e: any) {
    const msg = e?.message || '请求失败'
    errorMsg.value = /timeout|超时/i.test(msg)
      ? '加载超时，请确认该账号已在游戏中上线后重试'
      : msg
  }
  finally {
    loading.value = false
  }
}

function close() {
  emit('close')
}

watch(() => props.show, (v) => {
  if (v) load()
  else {
    items.value = []
    player.value = null
    totalHarvest.value = 0
    totalFriendPick.value = 0
    errorMsg.value = ''
    loading.value = false
    visibleCount.value = 35
  }
})

watch(currentAccountId, () => {
  if (props.show) load()
})
</script>

<style scoped>
.career-fade-enter-active,
.career-fade-leave-active {
  transition: opacity 0.18s ease;
}
.career-fade-enter-from,
.career-fade-leave-to {
  opacity: 0;
}
@keyframes career-pop {
  from {
    opacity: 0;
    transform: scale(0.94) translateY(10px);
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}
.career-card {
  animation: career-pop 0.22s cubic-bezier(0.22, 1, 0.36, 1);
  transform-origin: center;
  /* 隐藏滚动条但保留滚动能力 */
  scrollbar-width: none;      /* Firefox */
  -ms-overflow-style: none;   /* 旧版 IE/Edge */
}
.career-card::-webkit-scrollbar {
  width: 0;
  height: 0;
  display: none;              /* Chrome / Safari / Edge */
}
</style>
