<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed, onMounted, ref, watch } from 'vue'
import api from '@/api'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import { useAccountStore } from '@/stores/account'
import { usePlantBlacklistStore } from '@/stores/plant-blacklist'
import { useStatusStore } from '@/stores/status'
import { useToastStore } from '@/stores/toast'

const accountStore = useAccountStore()
const plantBlacklistStore = usePlantBlacklistStore()
const toast = useToastStore()
const statusStore = useStatusStore()
const { currentAccountId } = storeToRefs(accountStore)
const { blacklist } = storeToRefs(plantBlacklistStore)
const { status } = storeToRefs(statusStore)

const loading = ref(false)
const list = ref<any[]>([])
const sortKey = ref('exp')
const imageErrors = ref<Record<string | number, boolean>>({})
const searchKeyword = ref('')
const batchLoading = ref(false)
let analyticsRequestId = 0

const activeTab = ref('crops')

const strategyLevel = ref(1)

watch(() => status.value?.status?.level, (newLevel) => {
  if (newLevel && Number(newLevel) > 0) {
    strategyLevel.value = Number(newLevel)
  }
}, { immediate: true })

const strategies = [
  {
    key: 'max_exp',
    label: '经验/时',
    metric: 'expPerHour',
    color: 'purple',
    icon: 'i-carbon-growth',
    unit: 'EXP',
    desc: '每小时经验收益最高',
  },
  {
    key: 'max_profit',
    label: '利润/时',
    metric: 'profitPerHour',
    color: 'amber',
    icon: 'i-carbon-currency',
    unit: '金币',
    desc: '每小时净利润最高',
  },
  {
    key: 'max_fert_exp',
    label: '普肥经验/时',
    metric: 'normalFertilizerExpPerHour',
    color: 'blue',
    icon: 'i-carbon-chemistry',
    unit: 'EXP',
    desc: '使用普通化肥后经验最高',
  },
  {
    key: 'max_fert_profit',
    label: '普肥利润/时',
    metric: 'normalFertilizerProfitPerHour',
    color: 'green',
    icon: 'i-carbon-piggy-bank',
    unit: '金币',
    desc: '使用普通化肥后利润最高',
  },
]

function getStrategyBestPlant(strategyKey: string) {
  const strategy = strategies.find(s => s.key === strategyKey)
  if (!strategy)
    return null

  const metric = strategy.metric
  const filtered = list.value.filter((item) => {
    const level = item.level
    if (level === null || level === undefined)
      return true
    return Number(level) <= strategyLevel.value
  })

  if (filtered.length === 0)
    return null

  if (strategyKey === 'level') {
    return [...filtered].sort((a, b) => {
      const av = a.level ?? -1
      const bv = b.level ?? -1
      return bv - av
    })[0]
  }

  return [...filtered].sort((a, b) => {
    const av = Number(a[metric])
    const bv = Number(b[metric])
    if (!Number.isFinite(av) && !Number.isFinite(bv))
      return 0
    if (!Number.isFinite(av))
      return 1
    if (!Number.isFinite(bv))
      return -1
    return bv - av
  })[0]
}

function getStrategyAvailableCount() {
  return list.value.filter((item) => {
    const level = item.level
    if (level === null || level === undefined)
      return true
    return Number(level) <= strategyLevel.value
  }).length
}

function getColorClass(color: string, type: 'bg' | 'text' | 'border' | 'gradient') {
  const colorMap: Record<string, Record<string, string>> = {
    purple: {
      bg: 'bg-purple-100 dark:bg-purple-900/30',
      text: 'text-purple-600 dark:text-purple-400',
      border: 'border-purple-200 dark:border-purple-800',
      gradient: 'from-purple-500 to-purple-600',
    },
    blue: {
      bg: 'bg-blue-100 dark:bg-blue-900/30',
      text: 'text-blue-600 dark:text-blue-400',
      border: 'border-blue-200 dark:border-blue-800',
      gradient: 'from-blue-500 to-blue-600',
    },
    amber: {
      bg: 'bg-amber-100 dark:bg-amber-900/30',
      text: 'text-amber-600 dark:text-amber-400',
      border: 'border-amber-200 dark:border-amber-800',
      gradient: 'from-amber-500 to-amber-600',
    },
    green: {
      bg: 'bg-green-100 dark:bg-green-900/30',
      text: 'text-green-600 dark:text-green-400',
      border: 'border-green-200 dark:border-green-800',
      gradient: 'from-green-500 to-green-600',
    },
    rose: {
      bg: 'bg-rose-100 dark:bg-rose-900/30',
      text: 'text-rose-600 dark:text-rose-400',
      border: 'border-rose-200 dark:border-rose-800',
      gradient: 'from-rose-500 to-rose-600',
    },
  }
  return colorMap[color]?.[type] || ''
}

const filteredList = computed(() => {
  const keyword = searchKeyword.value.trim().toLowerCase()
  if (!keyword)
    return list.value

  return list.value.filter((item: any) => {
    const name = String(item?.name || '').toLowerCase()
    const seedId = String(item?.seedId || '')
    return name.includes(keyword) || seedId.includes(keyword)
  })
})

const sortOptions = [
  { value: 'exp', label: '经验/小时' },
  { value: 'fert', label: '普通肥经验/小时' },
  { value: 'profit', label: '利润/小时' },
  { value: 'fert_profit', label: '普通肥利润/小时' },
  { value: 'level', label: '等级' },
]

const sortOrder = ref<'desc' | 'asc'>('desc')

const sortOrderOptions = [
  { value: 'desc', label: '倒序' },
  { value: 'asc', label: '正序' },
]

const sortedList = computed(() => {
  const metricMap: Record<string, string> = {
    exp: 'expPerHour',
    fert: 'normalFertilizerExpPerHour',
    profit: 'profitPerHour',
    fert_profit: 'normalFertilizerProfitPerHour',
    level: 'level',
  }
  const metric = metricMap[sortKey.value]
  if (!metric)
    return filteredList.value

  const sorted = [...filteredList.value].sort((a, b) => {
    const av = Number(a[metric])
    const bv = Number(b[metric])
    if (!Number.isFinite(av) && !Number.isFinite(bv))
      return 0
    if (!Number.isFinite(av))
      return 1
    if (!Number.isFinite(bv))
      return -1
    return sortOrder.value === 'desc' ? bv - av : av - bv
  })
  return sorted
})

async function loadAnalytics() {
  const accountId = currentAccountId.value
  if (!accountId) {
    list.value = []
    return
  }
  const requestedId = String(accountId)
  const requestId = ++analyticsRequestId
  loading.value = true
  try {
    const res = await api.get(`/api/analytics`, {
      params: { sort: sortKey.value },
      headers: { 'x-account-id': accountId },
    })
    if (requestId !== analyticsRequestId || String(currentAccountId.value || '') !== requestedId)
      return
    const data = res.data.data
    if (Array.isArray(data)) {
      list.value = data
    }
    else {
      list.value = []
    }
  }
  catch (e) {
    console.error(e)
    if (requestId === analyticsRequestId && String(currentAccountId.value || '') === requestedId)
      list.value = []
  }
  finally {
    if (requestId === analyticsRequestId)
      loading.value = false
  }
}

async function handleToggleBlacklist(item: any) {
  await plantBlacklistStore.toggleBlacklist(item.seedId)
  if (plantBlacklistStore.isBlacklisted(item.seedId)) {
    toast.success(`${item.name} 已加入偷菜黑名单`)
  }
  else {
    toast.success(`${item.name} 已移出偷菜黑名单`)
  }
}

async function handleAddAllToBlacklist() {
  if (batchLoading.value)
    return
  batchLoading.value = true
  try {
    const allSeedIds = list.value.map((item: any) => item.seedId)
    await plantBlacklistStore.addAllToBlacklist(allSeedIds)
    toast.success(`已将 ${allSeedIds.length} 种作物加入偷菜黑名单`)
  }
  finally {
    batchLoading.value = false
  }
}

async function handleClearBlacklist() {
  if (batchLoading.value)
    return
  batchLoading.value = true
  try {
    await plantBlacklistStore.clearBlacklist()
    toast.success('已清空偷菜黑名单')
  }
  finally {
    batchLoading.value = false
  }
}

onMounted(() => {
  loadAnalytics()
  plantBlacklistStore.fetchBlacklist()
})

watch([currentAccountId, sortKey], () => {
  if (!currentAccountId.value) {
    list.value = []
    plantBlacklistStore.clearBlacklistData()
    return
  }
  list.value = []
  imageErrors.value = {}
  plantBlacklistStore.clearBlacklistData()
  loadAnalytics()
  plantBlacklistStore.fetchBlacklist()
})

function formatLv(level: any) {
  if (level === null || level === undefined || level === '' || Number(level) < 0)
    return '未知'
  return String(level)
}

function getSeedNameById(seedId: number) {
  const item = list.value.find((i: any) => i.seedId === seedId)
  return item?.name || `蔬菜ID:${seedId}`
}

function formatGrowTime(seconds: any) {
  const s = Number(seconds)
  if (!Number.isFinite(s) || s <= 0)
    return '0秒'
  if (s < 60)
    return `${s}秒`
  if (s < 3600) {
    const mins = Math.floor(s / 60)
    const secs = s % 60
    return secs > 0 ? `${mins}分${secs}秒` : `${mins}分`
  }
  const hours = Math.floor(s / 3600)
  const mins = Math.floor((s % 3600) / 60)
  return mins > 0 ? `${hours}时${mins}分` : `${hours}时`
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex gap-2">
      <button
        class="whitespace-nowrap rounded-[14px] border border-[var(--theme-border)] bg-[var(--theme-glass)] px-3.5 py-[7px] text-xs font-semibold text-[var(--theme-text)] backdrop-blur-[16px] transition-colors"
        :class="activeTab === 'crops'
          ? '!bg-[var(--theme-primary)] text-white shadow-sm'
          : 'hover:bg-white/20 dark:hover:bg-white/10'"
        @click="activeTab = 'crops'"
      >
        <span class="inline-flex items-center gap-1">
          <span class="i-carbon-sprout h-3.5 w-3.5" />
          全部作物
          <span v-if="list.length" class="rounded-full bg-white/25 px-1.5 text-[10px]">{{ list.length }}</span>
        </span>
      </button>
      <button
        class="whitespace-nowrap rounded-[14px] border border-[var(--theme-border)] bg-[var(--theme-glass)] px-3.5 py-[7px] text-xs font-semibold text-[var(--theme-text)] backdrop-blur-[16px] transition-colors"
        :class="activeTab === 'blacklist'
          ? '!bg-[var(--theme-primary)] text-white shadow-sm'
          : 'hover:bg-white/20 dark:hover:bg-white/10'"
        @click="activeTab = 'blacklist'"
      >
        <span class="inline-flex items-center gap-1">
          <span class="i-carbon-subtract-alt h-3.5 w-3.5" />
          黑名单
          <span v-if="blacklist.length" class="rounded-full bg-white/25 px-1.5 text-[10px]">{{ blacklist.length }}</span>
        </span>
      </button>
      <button
        class="whitespace-nowrap rounded-[14px] border border-[var(--theme-border)] bg-[var(--theme-glass)] px-3.5 py-[7px] text-xs font-semibold text-[var(--theme-text)] backdrop-blur-[16px] transition-colors"
        :class="activeTab === 'strategy'
          ? '!bg-[var(--theme-primary)] text-white shadow-sm'
          : 'hover:bg-white/20 dark:hover:bg-white/10'"
        @click="activeTab = 'strategy'"
      >
        <span class="inline-flex items-center gap-1">
          <span class="i-carbon-chart-line h-3.5 w-3.5" />
          种植策略
        </span>
      </button>
    </div>

    <div>
      <div v-if="loading" class="flex justify-center py-12">
        <div class="i-svg-spinners-90-ring-with-bg text-4xl text-blue-500" />
      </div>

      <div v-else-if="!currentAccountId" class="rounded-lg bg-white p-8 text-center text-gray-500 shadow dark:bg-gray-800">
        请选择账号后查看数据分析
      </div>

      <div v-else-if="list.length === 0" class="rounded-lg bg-white p-8 text-center text-gray-500 shadow dark:bg-gray-800">
        暂无数据
      </div>

      <div v-else-if="activeTab === 'crops'" class="space-y-4">
        <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div class="flex items-center gap-3">
            <div class="i-carbon-sprout text-xl text-green-500" />
            <div>
              <h3 class="text-gray-700 font-semibold dark:text-gray-300">
                全部作物信息
              </h3>
              <p class="text-xs text-gray-500 dark:text-gray-400">
                共 {{ list.length }} 种作物
              </p>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <div class="relative">
              <div class="i-carbon-search absolute left-3 top-1/2 text-gray-400 -translate-y-1/2" />
              <input
                v-model="searchKeyword"
                type="text"
                placeholder="搜索作物..."
                class="w-full border border-gray-300 rounded-lg bg-white py-2 pl-10 pr-4 text-sm sm:w-64 dark:border-gray-600 focus:border-blue-500 dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
            </div>
            <div v-if="list.length" class="text-sm text-gray-500">
              {{ sortedList.length }}/{{ list.length }}
            </div>
            <label class="whitespace-nowrap text-sm font-medium">排序:</label>
            <BaseSelect
              v-model="sortKey"
              :options="sortOptions"
              class="w-40"
            />
            <BaseSelect
              v-model="sortOrder"
              :options="sortOrderOptions"
              class="w-20"
            />
          </div>
        </div>

        <div class="p-4 space-y-4">
          <div class="block sm:hidden space-y-4">
            <div v-for="(item, idx) in sortedList" :key="idx" class="border border-gray-200 rounded-lg bg-white p-4 shadow dark:border-gray-700 dark:bg-gray-800">
              <div class="mb-3 flex items-start gap-3">
                <div class="relative h-12 w-12 flex shrink-0 items-center justify-center overflow-hidden border border-gray-200 rounded-lg bg-gray-100 dark:border-gray-600 dark:bg-gray-700">
                  <img
                    v-if="item.image && !imageErrors[item.seedId]"
                    :src="item.image"
                    class="h-10 w-10 object-contain"
                    loading="lazy"
                    @error="imageErrors[item.seedId] = true"
                  >
                  <div v-else class="i-carbon-sprout text-2xl text-gray-400" />
                </div>
                <div class="min-w-0 flex-1">
                  <div class="flex items-center justify-between">
                    <div class="truncate text-gray-900 font-bold dark:text-gray-100">
                      {{ item.name }}
                      <span v-if="blacklist.includes(item.seedId)" class="ml-1 rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-600 dark:bg-red-900/30 dark:text-red-400">黑名单</span>
                    </div>
                    <div class="text-xs text-gray-500">
                      ID:{{ item.seedId }}
                    </div>
                  </div>
                  <div class="mt-1 flex items-center gap-2">
                    <span class="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500 font-medium dark:bg-gray-700">Lv{{ formatLv(item.level) }}</span>
                    <span class="text-xs text-gray-400">{{ item.seasons }}季</span>
                  </div>
                </div>
              </div>

              <div class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <div class="flex flex-col">
                  <span class="text-xs text-gray-500">时间</span>
                  <span class="text-gray-700 font-medium dark:text-gray-300">{{ formatGrowTime(item.growTime) }}</span>
                </div>
                <div class="flex flex-col">
                  <span class="text-xs text-gray-500">经验/时</span>
                  <span class="text-purple-600 font-bold dark:text-purple-400">{{ item.expPerHour }}</span>
                </div>
                <div class="flex flex-col">
                  <span class="text-xs text-gray-500">净利润/时</span>
                  <span class="text-amber-500 font-bold">{{ item.profitPerHour ?? '-' }}</span>
                </div>
                <div class="flex flex-col">
                  <span class="text-xs text-gray-500">普肥经验/时</span>
                  <span class="text-blue-600 font-bold dark:text-blue-400">{{ item.normalFertilizerExpPerHour ?? '-' }}</span>
                </div>
                <div class="flex flex-col">
                  <span class="text-xs text-gray-500">普肥利润/时</span>
                  <span class="text-green-500 font-bold">{{ item.normalFertilizerProfitPerHour ?? '-' }}</span>
                </div>
              </div>

              <div class="mt-3">
                <button
                  class="w-full rounded px-3 py-2 text-sm transition"
                  :class="blacklist.includes(item.seedId)
                    ? 'bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-400 dark:hover:bg-red-900/50'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'"
                  @click="handleToggleBlacklist(item)"
                >
                  {{ blacklist.includes(item.seedId) ? '移出偷菜黑名单' : '加入偷菜黑名单' }}
                </button>
              </div>
            </div>
          </div>

          <div class="hidden overflow-hidden border border-gray-200 rounded-lg bg-white shadow sm:block dark:border-gray-700 dark:bg-gray-800">
            <div class="overflow-x-auto">
              <table class="w-full whitespace-nowrap text-left text-sm">
                <thead class="border-b bg-gray-50 text-xs text-gray-500 uppercase dark:border-gray-700 dark:bg-gray-700/50 dark:text-gray-400">
                  <tr>
                    <th class="sticky left-0 z-10 bg-gray-50 px-4 py-3 font-medium shadow-[1px_0_0_0_rgba(0,0,0,0.05)] dark:bg-gray-800 dark:shadow-[1px_0_0_0_rgba(255,255,255,0.05)]">
                      作物 (Lv)
                    </th>
                    <th class="px-4 py-3 font-medium">
                      时间
                    </th>
                    <th class="px-4 py-3 text-right font-medium">
                      经验/时
                    </th>
                    <th class="px-4 py-3 text-right font-medium">
                      普通肥经验/时
                    </th>
                    <th class="px-4 py-3 text-right font-medium">
                      净利润/时
                    </th>
                    <th class="px-4 py-3 text-right font-medium">
                      普通肥净利润/时
                    </th>
                    <th class="px-4 py-3 text-center font-medium">
                      操作
                    </th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-gray-100 dark:divide-gray-700">
                  <tr v-for="(item, idx) in sortedList" :key="idx" class="group transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td class="sticky left-0 bg-white px-4 py-2 shadow-[1px_0_0_0_rgba(0,0,0,0.05)] transition-colors dark:bg-gray-800 group-hover:bg-gray-50 dark:shadow-[1px_0_0_0_rgba(255,255,255,0.05)] dark:group-hover:bg-gray-700/50">
                      <div class="flex items-center gap-3">
                        <div class="relative h-10 w-10 flex shrink-0 items-center justify-center overflow-hidden border border-gray-200 rounded-lg bg-gray-100 dark:border-gray-600 dark:bg-gray-700">
                          <img
                            v-if="item.image && !imageErrors[item.seedId]"
                            :src="item.image"
                            class="h-8 w-8 object-contain"
                            loading="lazy"
                            @error="imageErrors[item.seedId] = true"
                          >
                          <div v-else class="i-carbon-sprout text-xl text-gray-400" />
                        </div>
                        <div>
                          <div class="text-gray-900 font-bold dark:text-gray-100">
                            {{ item.name }}
                            <span v-if="blacklist.includes(item.seedId)" class="ml-1 rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-600 dark:bg-red-900/30 dark:text-red-400">黑名单</span>
                          </div>
                          <div class="mt-0.5 flex items-center gap-1.5">
                            <span class="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500 font-medium dark:bg-gray-700">Lv{{ formatLv(item.level) }}</span>
                            <span class="text-[10px] text-gray-400">ID:{{ item.seedId }}</span>
                          </div>
                        </div>
                      </div>
                    </td>
                    <td class="px-4 py-2 text-gray-600 dark:text-gray-300">
                      <div class="font-medium">
                        {{ formatGrowTime(item.growTime) }}
                      </div>
                      <div class="text-xs text-gray-400">
                        {{ item.seasons }}季
                      </div>
                    </td>
                    <td class="px-4 py-2 text-right">
                      <div class="text-purple-600 font-bold dark:text-purple-400">
                        {{ item.expPerHour }}
                      </div>
                    </td>
                    <td class="px-4 py-2 text-right">
                      <div class="text-blue-600 font-bold dark:text-blue-400">
                        {{ item.normalFertilizerExpPerHour ?? '-' }}
                      </div>
                    </td>
                    <td class="px-4 py-2 text-right">
                      <div class="text-amber-500 font-bold">
                        {{ item.profitPerHour ?? '-' }}
                      </div>
                    </td>
                    <td class="px-4 py-2 text-right">
                      <div class="text-green-500 font-bold">
                        {{ item.normalFertilizerProfitPerHour ?? '-' }}
                      </div>
                    </td>
                    <td class="px-4 py-2 text-center">
                      <button
                        class="rounded px-3 py-1.5 text-xs transition"
                        :class="blacklist.includes(item.seedId)
                          ? 'bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-400 dark:hover:bg-red-900/50'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'"
                        @click="handleToggleBlacklist(item)"
                      >
                        {{ blacklist.includes(item.seedId) ? '移出黑名单' : '加入黑名单' }}
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <div v-if="activeTab === 'blacklist'" class="overflow-hidden border border-gray-200 rounded-lg bg-white shadow dark:border-gray-700 dark:bg-gray-800">
        <div class="border-b border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-700/50">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-3">
              <div class="i-carbon-subtract-alt text-xl text-red-500" />
              <div>
                <h3 class="text-gray-700 font-semibold dark:text-gray-300">
                  偷菜黑名单
                </h3>
                <p class="text-xs text-gray-500 dark:text-gray-400">
                  加入黑名单的蔬菜在自动偷菜时会被跳过，但不会影响自己种植
                </p>
              </div>
            </div>
            <div class="flex items-center gap-2">
              <button
                class="flex items-center gap-1 rounded-lg bg-orange-50 px-3 py-2 text-sm text-orange-600 transition dark:bg-orange-900/20 hover:bg-orange-100 dark:text-orange-400 disabled:opacity-50 dark:hover:bg-orange-900/30"
                :disabled="batchLoading || list.length === 0"
                @click="handleAddAllToBlacklist"
              >
                <div v-if="batchLoading" class="i-svg-spinners-90-ring-with-bg" />
                <div v-else class="i-carbon-add" />
                一键全部加入黑名单
              </button>
              <button
                v-if="blacklist.length > 0"
                class="flex items-center gap-1 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 transition dark:bg-red-900/20 hover:bg-red-100 dark:text-red-400 disabled:opacity-50 dark:hover:bg-red-900/30"
                :disabled="batchLoading"
                @click="handleClearBlacklist"
              >
                <div class="i-carbon-trash-can" />
                清空黑名单
              </button>
            </div>
          </div>
        </div>

        <div class="p-4">
          <div v-if="blacklist.length === 0" class="py-8 text-center text-gray-500 dark:text-gray-400">
            暂无黑名单蔬菜
          </div>
          <div v-else class="space-y-3">
            <div
              v-for="seedId in blacklist"
              :key="seedId"
              class="flex items-center justify-between rounded-lg bg-gray-50 px-4 py-3 dark:bg-gray-700/50"
            >
              <div class="flex items-center gap-3">
                <div class="relative h-10 w-10 flex shrink-0 items-center justify-center overflow-hidden border border-gray-200 rounded-lg bg-gray-100 dark:border-gray-600 dark:bg-gray-700">
                  <img
                    v-if="list.find(i => i.seedId === seedId)?.image"
                    :src="list.find(i => i.seedId === seedId)?.image"
                    class="h-8 w-8 object-contain"
                    loading="lazy"
                  >
                  <div v-else class="i-carbon-sprout text-xl text-gray-400" />
                </div>
                <div>
                  <div class="text-sm text-gray-900 font-medium dark:text-white">
                    {{ getSeedNameById(seedId) }}
                  </div>
                  <div class="text-xs text-gray-400">
                    ID: {{ seedId }}
                  </div>
                </div>
              </div>
              <button
                class="rounded bg-red-100 px-3 py-1.5 text-sm text-red-700 transition dark:bg-red-900/30 hover:bg-red-200 dark:text-red-400 dark:hover:bg-red-900/50"
                @click="plantBlacklistStore.removeFromBlacklist(seedId)"
              >
                移出黑名单
              </button>
            </div>
          </div>
        </div>
      </div>

      <div v-if="activeTab === 'strategy'" class="overflow-hidden border border-gray-200 rounded-lg bg-white shadow dark:border-gray-700 dark:bg-gray-800">
        <div class="border-b border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-700/50">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-3">
              <div class="i-carbon-calculation text-xl text-blue-500" />
              <div>
                <h3 class="text-gray-700 font-semibold dark:text-gray-300">
                  策略推荐
                </h3>
                <p class="text-xs text-gray-500 dark:text-gray-400">
                  根据等级推荐最优种植策略
                </p>
              </div>
            </div>
            <div class="flex items-center gap-2">
              <span class="text-sm text-gray-500">参考等级:</span>
              <input
                v-model.number="strategyLevel"
                type="number"
                min="1"
                max="100"
                class="w-16 border border-gray-300 rounded-lg bg-white px-3 py-1.5 text-center text-sm outline-none dark:border-gray-600 focus:border-blue-400 dark:bg-gray-700 dark:text-gray-200"
              >
            </div>
          </div>
        </div>

        <div class="p-4">
          <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div
              v-for="strategy in strategies"
              :key="strategy.key"
              class="overflow-hidden border rounded-lg bg-white transition-shadow dark:bg-gray-800 hover:shadow-md"
              :class="getColorClass(strategy.color, 'border')"
            >
              <div class="p-3">
                <div class="mb-2 flex items-center gap-2">
                  <div
                    class="h-7 w-7 flex shrink-0 items-center justify-center rounded-lg bg-gradient-to-br text-white"
                    :class="getColorClass(strategy.color, 'gradient')"
                  >
                    <div class="text-sm" :class="strategy.icon" />
                  </div>
                  <div class="min-w-0 flex-1">
                    <div class="truncate text-sm font-semibold" :class="getColorClass(strategy.color, 'text')">
                      {{ strategy.label }}
                    </div>
                  </div>
                </div>

                <div v-if="getStrategyBestPlant(strategy.key)" class="space-y-2">
                  <div class="flex items-center gap-2">
                    <div class="h-10 w-10 flex shrink-0 items-center justify-center overflow-hidden border rounded-lg bg-gray-50 dark:border-gray-600 dark:bg-gray-700" :class="getColorClass(strategy.color, 'border')">
                      <img
                        v-if="getStrategyBestPlant(strategy.key)?.image && !imageErrors[getStrategyBestPlant(strategy.key)?.seedId]"
                        :src="getStrategyBestPlant(strategy.key)?.image"
                        class="h-8 w-8 object-contain"
                        loading="lazy"
                        @error="imageErrors[getStrategyBestPlant(strategy.key)?.seedId] = true"
                      >
                      <div v-else class="i-carbon-sprout text-lg text-gray-400" />
                    </div>
                    <div class="min-w-0 flex-1">
                      <div class="truncate text-sm text-gray-800 font-medium dark:text-gray-200">
                        {{ getStrategyBestPlant(strategy.key)?.name }}
                      </div>
                      <div class="text-xs text-gray-500">
                        Lv{{ formatLv(getStrategyBestPlant(strategy.key)?.level) }}
                      </div>
                    </div>
                  </div>
                  <div class="rounded-md bg-gray-50 px-2 py-1.5 dark:bg-gray-900/50">
                    <div class="flex items-baseline justify-between">
                      <span class="text-xs text-gray-500">{{ strategy.unit }}/时</span>
                      <span class="text-base font-bold" :class="getColorClass(strategy.color, 'text')">
                        {{ getStrategyBestPlant(strategy.key)?.[strategy.metric] }}
                      </span>
                    </div>
                  </div>
                </div>
                <div v-else class="py-3 text-center text-xs text-gray-400">
                  暂无可种植作物
                </div>
              </div>
            </div>
          </div>

          <div class="mt-3 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
            <div class="i-carbon-information" />
            <span>可种植 {{ getStrategyAvailableCount() }}/{{ list.length }} 种作物 · 策略计算与设置页面种植策略一致</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
:deep(.bg-white),
:deep(.dark\\:bg-gray-800),
:deep(.dark\\:bg-gray-700),
:deep(.dark\\:bg-gray-900) {
  background: var(--theme-glass) !important;
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
}

:deep(.shadow),
:deep(.shadow-sm) {
  box-shadow: none !important;
  border: 1px solid var(--theme-border) !important;
}

:deep(.border-gray-200),
:deep(.dark\\:border-gray-700),
:deep(.dark\\:border-gray-600) {
  border-color: var(--theme-border) !important;
}

:deep(.bg-gray-50) {
  background: color-mix(in srgb, var(--theme-bg) 20%, transparent) !important;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}

:deep(.text-gray-500) {
  color: var(--theme-text-secondary) !important;
}
</style>
