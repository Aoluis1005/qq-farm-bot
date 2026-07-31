<script setup lang="ts">
import { computed } from 'vue'
import type { GuanxingActivity, GuanxingNode } from '@/stores/activity'
import BaseButton from '@/components/ui/BaseButton.vue'
import ActivityItemImage from './ActivityItemImage.vue'

const props = defineProps<{
  activity?: GuanxingActivity | null
  loading?: boolean
  claimLoading?: boolean
  autoClaim?: boolean
}>()

const emit = defineEmits<{
  claim: []
  'update:autoClaim': [value: boolean]
}>()

const T = {
  claimAll: '一键领取',
  autoClaim: '自动领取',
  autoClaimTip: '进入活动页自动领取已解锁奖励',
  currentDay: '当前进度',
  dayUnit: '天',
  unlocked: '已解锁',
  claimed: '已领取',
  claimable: '可领取',
  pending: '待领奖励',
  none: '无',
  locked: '未解锁',
  direction: '星宿星图',
  noData: '暂无星宿数据',
}

function rewardName(item: { itemName?: string, name?: string, itemId?: number }) {
  return item.name || item.itemName || `物品${item.itemId || ''}`
}

function rewardCount(item: { itemCount?: number, count?: number }) {
  return item.itemCount || item.count || 1
}

function nodeStatusClass(node: GuanxingNode) {
  if (node.claimed)
    return 'border-emerald-300 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-900/20'
  if (node.claimable)
    return 'border-amber-300 bg-amber-50 ring-2 ring-amber-200 dark:border-amber-600 dark:bg-amber-900/20 dark:ring-amber-700/40'
  if (node.unlocked)
    return 'border-sky-300 bg-sky-50 dark:border-sky-700 dark:bg-sky-900/20'
  return 'border-gray-200 bg-gray-50 opacity-60 dark:border-gray-700 dark:bg-gray-900/30'
}

function nodeDotClass(node: GuanxingNode) {
  if (node.claimed)
    return 'bg-emerald-500 shadow-emerald-300'
  if (node.claimable)
    return 'bg-amber-400 shadow-amber-300 animate-pulse'
  if (node.unlocked)
    return 'bg-sky-400 shadow-sky-300'
  return 'bg-gray-300 dark:bg-gray-600'
}

function nodeStatusBadge(node: GuanxingNode) {
  if (node.claimed)
    return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
  if (node.claimable)
    return 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
  if (node.unlocked)
    return 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300'
  return 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
}

// 星宿按四象分组（28宿顺序即 青龙→玄武→白虎→朱雀）
const directionGroups = computed(() => {
  const nodes = props.activity?.nodes || []
  const groups: Array<{ category: string, nodes: GuanxingNode[] }> = []
  for (const node of nodes) {
    const last = groups[groups.length - 1]
    if (last && last.category === node.category)
      last.nodes.push(node)
    else
      groups.push({ category: node.category || '星宿', nodes: [node] })
  }
  return groups
})

const claimableCount = computed(() => props.activity?.summary?.claimableCount || 0)
const canClaim = computed(() => claimableCount.value > 0)
</script>

<template>
  <section class="rounded-lg bg-white shadow-sm dark:bg-gray-800">
    <!-- 头部：标题 + 自动领取开关 + 一键领取 -->
    <div class="flex flex-col gap-3 border-b border-gray-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between dark:border-gray-700">
      <div class="min-w-0 flex items-center gap-3">
        <div class="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-indigo-50 text-indigo-600 dark:bg-indigo-900/20 dark:text-indigo-300">
          <div class="i-carbon-observation" />
        </div>
        <div class="min-w-0">
          <h2 class="truncate text-base text-gray-900 font-semibold dark:text-gray-100">
            {{ activity?.title || T.claimAll }}
          </h2>
          <div class="mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400">
            {{ activity?.seasonTitle || '二十八星宿·逐日点亮' }}
          </div>
        </div>
      </div>

      <div class="flex shrink-0 flex-wrap items-center gap-3">
        <!-- 自动领取开关 -->
        <label
          class="flex cursor-pointer select-none items-center gap-2"
          :title="T.autoClaimTip"
        >
          <span class="text-xs text-gray-600 dark:text-gray-300">{{ T.autoClaim }}</span>
          <button
            type="button"
            role="switch"
            :aria-checked="!!autoClaim"
            class="relative h-5 w-9 rounded-full transition-colors"
            :class="autoClaim ? 'bg-indigo-500' : 'bg-gray-300 dark:bg-gray-600'"
            @click="emit('update:autoClaim', !autoClaim)"
          >
            <span
              class="absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all"
              :class="autoClaim ? 'left-4' : 'left-0.5'"
            />
          </button>
        </label>

        <span class="rounded-lg bg-gray-50 px-2.5 py-1 text-xs text-gray-500 dark:bg-gray-900/40 dark:text-gray-300">
          {{ claimableCount }} {{ T.claimable }}
        </span>
        <BaseButton
          class="w-24"
          variant="primary"
          :loading="claimLoading"
          :disabled="!canClaim"
          @click="emit('claim')"
        >
          {{ T.claimAll }}
        </BaseButton>
      </div>
    </div>

    <!-- 进度统计 -->
    <div class="grid gap-3 p-4 md:grid-cols-4">
      <div class="rounded-lg bg-gray-50 px-3 py-2.5 dark:bg-gray-900/40">
        <div class="text-xs text-gray-500 dark:text-gray-400">{{ T.currentDay }}</div>
        <div class="mt-1 text-sm text-gray-900 font-semibold dark:text-gray-100">
          {{ activity?.currentDay || 0 }} / {{ activity?.totalDays || 28 }} {{ T.dayUnit }}
        </div>
      </div>
      <div class="rounded-lg bg-gray-50 px-3 py-2.5 dark:bg-gray-900/40">
        <div class="text-xs text-gray-500 dark:text-gray-400">{{ T.unlocked }}</div>
        <div class="mt-1 text-sm text-gray-900 font-semibold dark:text-gray-100">
          {{ activity?.summary?.unlockedCount || 0 }}
        </div>
      </div>
      <div class="rounded-lg bg-gray-50 px-3 py-2.5 dark:bg-gray-900/40">
        <div class="text-xs text-gray-500 dark:text-gray-400">{{ T.claimed }}</div>
        <div class="mt-1 text-sm text-emerald-600 font-semibold dark:text-emerald-300">
          {{ activity?.summary?.claimedCount || 0 }}
        </div>
      </div>
      <div class="rounded-lg bg-gray-50 px-3 py-2.5 dark:bg-gray-900/40">
        <div class="text-xs text-gray-500 dark:text-gray-400">{{ T.claimable }}</div>
        <div class="mt-1 text-sm text-amber-600 font-semibold dark:text-amber-300">
          {{ claimableCount }}
        </div>
      </div>
    </div>

    <!-- 待领奖励 -->
    <div
      v-if="activity?.summary?.pendingRewards?.length"
      class="border-t border-gray-100 px-4 py-3 dark:border-gray-700"
    >
      <div class="mb-2 text-sm text-gray-900 font-semibold dark:text-gray-100">{{ T.pending }}</div>
      <div class="flex flex-wrap gap-2">
        <span
          v-for="item in activity.summary.pendingRewards"
          :key="`${item.itemId}-${item.itemCount}`"
          class="max-w-full min-w-0 inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-xs text-amber-800 dark:bg-amber-900/20 dark:text-amber-200"
        >
          <ActivityItemImage :item="item" img-class="h-5 w-5 shrink-0" />
          <span class="truncate">{{ rewardName(item) }} x{{ rewardCount(item) }}</span>
        </span>
      </div>
    </div>

    <!-- 星宿星图 -->
    <div class="border-t border-gray-100 p-4 dark:border-gray-700">
      <div class="mb-3 flex items-center justify-between gap-3">
        <h3 class="text-base text-gray-900 font-semibold dark:text-gray-100">{{ T.direction }}</h3>
        <span class="text-xs text-gray-500 dark:text-gray-400">{{ activity?.nodes?.length || 0 }} / 28</span>
      </div>

      <div
        v-if="loading && !activity"
        class="rounded-lg bg-gray-50 p-6 text-center text-sm text-gray-500 dark:bg-gray-900/40 dark:text-gray-400"
      >
        正在加载星宿数据...
      </div>

      <div
        v-else-if="!activity?.nodes?.length"
        class="rounded-lg bg-gray-50 p-6 text-center text-sm text-gray-500 dark:bg-gray-900/40 dark:text-gray-400"
      >
        {{ T.noData }}
      </div>

      <div v-else class="space-y-4">
        <div
          v-for="group in directionGroups"
          :key="group.category"
          class="rounded-lg bg-gray-50/60 p-3 dark:bg-gray-900/30"
        >
          <div class="mb-2 flex items-center gap-2">
            <span class="rounded-md bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
              {{ group.category }}
            </span>
            <span class="text-[11px] text-gray-500 dark:text-gray-400">{{ group.nodes.length }} 宿</span>
          </div>
          <div class="grid grid-cols-4 gap-2 sm:grid-cols-7">
            <div
              v-for="node in group.nodes"
              :key="node.id"
              class="relative min-w-0 cursor-default rounded-lg border p-2 transition-all"
              :class="nodeStatusClass(node)"
              :title="node.explain || `${node.name} 第${node.day}日`"
            >
              <span
                class="absolute left-1.5 top-1.5 h-1.5 w-1.5 rounded-full shadow"
                :class="nodeDotClass(node)"
              />
              <span
                class="absolute right-1.5 top-1.5 rounded px-1 py-px text-[10px] font-medium"
                :class="nodeStatusBadge(node)"
              >
                {{ node.statusLabel }}
              </span>
              <div class="mt-2 text-sm text-gray-900 font-semibold dark:text-gray-100">
                {{ node.name }}
              </div>
              <div class="mt-1 flex items-center gap-1">
                <template v-if="node.rewards?.length">
                  <ActivityItemImage
                    v-for="item in node.rewards"
                    :key="`${node.id}-${item.itemId}`"
                    :item="item"
                    img-class="h-4 w-4"
                  />
                </template>
                <span v-else class="text-[10px] text-gray-400">-</span>
              </div>
              <div class="mt-1 truncate text-[10px] text-gray-500 dark:text-gray-400">
                {{ node.rewards?.map(r => `${rewardName(r)}x${rewardCount(r)}`).join(' / ') || '' }}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
