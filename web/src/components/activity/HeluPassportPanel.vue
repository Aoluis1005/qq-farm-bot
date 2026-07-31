<script setup lang="ts">
import type { ActivityLabels } from './types'
import type { HeluDrawReward, HeluSeasonPassport, HeluSeasonRewardTier } from '@/stores/activity'
import BaseButton from '@/components/ui/BaseButton.vue'
import ActivityItemImage from './ActivityItemImage.vue'

defineProps<{
  passport?: HeluSeasonPassport | null
  loading?: boolean
  labels: ActivityLabels
}>()

defineEmits<{
  claim: []
}>()

const T = {
  itemPrefix: '\u7269\u54C1',
  none: '\u65E0',
  claimed: '\u5DF2\u9886',
  claimable: '\u53EF\u9886',
  locked: '\u672A\u8FBE\u6210',
  claimableUnit: '\u7EA7\u53EF\u9886',
  claimAll: '\u4E00\u952E\u9886\u53D6',
  currentLevel: '\u5F53\u524D\u7B49\u7EA7',
  currentProgress: '\u5F53\u524D\u8FDB\u5EA6',
  claimedLevel: '\u5DF2\u9886\u7B49\u7EA7',
  rewardTierCount: '\u5956\u52B1\u5C42\u6570',
  recentClaim: '\u6700\u8FD1\u9886\u53D6',
  itemUnit: '\u9879',
  levelRewards: '\u7B49\u7EA7\u5956\u52B1',
  tierUnit: '\u5C42',
  levelPrefix: '\u7B2C',
  levelUnit: '\u7EA7',
  freeTrack: '\u6E38\u8BB0',
  premiumTrack: '\u73CD\u85CF',
}

function formatNumber(value?: number) {
  return Number(value || 0).toLocaleString()
}

function rewardName(item: { itemName?: string, name?: string, itemId?: number }) {
  // 优先用 item.name（中文真名），itemName 兜底（game 的「物品{id}」格式）
  return item.name || item.itemName || `${T.itemPrefix}${item.itemId || ''}`
}

function rewardCount(item: { itemCount?: number, count?: number }) {
  return item.itemCount || item.count || 1
}

function rewardSummary(items?: HeluDrawReward[]) {
  if (!items?.length)
    return T.none
  return items.map(item => `${rewardName(item)}x${rewardCount(item)}`).join(' / ')
}

function previewRewards(tier: HeluSeasonRewardTier) {
  return [...(tier.freeRewards || []), ...(tier.premiumRewards || [])].slice(0, 3)
}

function tierThumb(tier: HeluSeasonRewardTier) {
  return tier.freeRewards?.[0] || tier.premiumRewards?.[0] || null
}

function tierState(passport: HeluSeasonPassport | null | undefined, level: number) {
  if (level <= Number(passport?.freeClaimedLevel || 0))
    return T.claimed
  if (level <= Number(passport?.currentLevel || 0))
    return T.claimable
  return T.locked
}

function tierStateClass(passport: HeluSeasonPassport | null | undefined, level: number) {
  const state = tierState(passport, level)
  if (state === T.claimed)
    return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300'
  if (state === T.claimable)
    return 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300'
  return 'bg-gray-50 text-gray-500 dark:bg-gray-900/40 dark:text-gray-300'
}

function progressText(passport?: HeluSeasonPassport | null) {
  const current = passport?.currentProgress
  const need = passport?.nextLevelNeed
  if (current === undefined && need === undefined)
    return '-'
  return `${formatNumber(current)} / ${formatNumber(need)}`
}
</script>

<template>
  <section class="rounded-lg bg-white shadow-sm dark:bg-gray-800">
    <div class="flex flex-col gap-3 border-b border-gray-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between dark:border-gray-700">
      <div class="min-w-0 flex items-center gap-3">
        <div class="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-sky-50 text-sky-600 dark:bg-sky-900/20 dark:text-sky-300">
          <div class="i-carbon-map" />
        </div>
        <div class="min-w-0">
          <h2 class="truncate text-base text-gray-900 font-semibold dark:text-gray-100">
            {{ passport?.title || labels.journeyTab }}
          </h2>
          <div class="mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400">
            {{ passport?.seasonTitle || labels.defaultHeluTitle }}
          </div>
        </div>
      </div>
      <div class="flex shrink-0 items-center gap-2">
        <span class="rounded-lg bg-gray-50 px-2.5 py-1 text-xs text-gray-500 dark:bg-gray-900/40 dark:text-gray-300">
          {{ passport?.claimableLevels || 0 }} {{ T.claimableUnit }}
        </span>
        <BaseButton
          class="w-24"
          variant="primary"
          :loading="loading"
          :disabled="!passport || !passport.claimableLevels"
          @click="$emit('claim')"
        >
          {{ T.claimAll }}
        </BaseButton>
      </div>
    </div>

    <div class="grid gap-3 p-4 md:grid-cols-4">
      <div class="rounded-lg bg-gray-50 px-3 py-2.5 dark:bg-gray-900/40">
        <div class="text-xs text-gray-500 dark:text-gray-400">
          {{ T.currentLevel }}
        </div>
        <div class="mt-1 text-sm text-gray-900 font-semibold dark:text-gray-100">
          {{ formatNumber(passport?.currentLevel) }}
        </div>
      </div>
      <div class="rounded-lg bg-gray-50 px-3 py-2.5 dark:bg-gray-900/40">
        <div class="text-xs text-gray-500 dark:text-gray-400">
          {{ T.currentProgress }}
        </div>
        <div class="mt-1 text-sm text-gray-900 font-semibold dark:text-gray-100">
          {{ progressText(passport) }}
        </div>
      </div>
      <div class="rounded-lg bg-gray-50 px-3 py-2.5 dark:bg-gray-900/40">
        <div class="text-xs text-gray-500 dark:text-gray-400">
          {{ T.claimedLevel }}
        </div>
        <div class="mt-1 text-sm text-gray-900 font-semibold dark:text-gray-100">
          {{ formatNumber(passport?.freeClaimedLevel) }}
        </div>
      </div>
      <div class="rounded-lg bg-gray-50 px-3 py-2.5 dark:bg-gray-900/40">
        <div class="text-xs text-gray-500 dark:text-gray-400">
          {{ T.rewardTierCount }}
        </div>
        <div class="mt-1 text-sm text-gray-900 font-semibold dark:text-gray-100">
          {{ formatNumber(passport?.maxLevel || passport?.rewardTierCount) }}
        </div>
      </div>
    </div>

    <div v-if="passport?.rewards?.length" class="border-t border-gray-100 px-4 py-3 dark:border-gray-700">
      <div class="mb-2 flex items-center justify-between gap-3">
        <div class="text-sm text-gray-900 font-semibold dark:text-gray-100">
          {{ T.recentClaim }}
        </div>
        <div class="text-xs text-gray-500 dark:text-gray-400">
          {{ passport.rewards.length }} {{ T.itemUnit }}
        </div>
      </div>
      <div class="flex flex-wrap gap-2">
        <span
          v-for="item in passport.rewards"
          :key="`${item.itemId}-${item.itemCount}`"
          class="max-w-full min-w-0 inline-flex items-center gap-1.5 rounded-full bg-gray-50 px-2.5 py-1 text-xs text-gray-700 dark:bg-gray-900/40 dark:text-gray-200"
        >
          <ActivityItemImage :item="item"
            img-class="h-5 w-5 shrink-0"
          />
          <span class="truncate">{{ rewardName(item) }} x{{ rewardCount(item) }}</span>
        </span>
      </div>
    </div>
  </section>

  <section class="mt-4 rounded-lg bg-white shadow-sm dark:bg-gray-800">
    <div class="flex items-center justify-between gap-3 border-b border-gray-100 px-4 py-3 dark:border-gray-700">
      <h3 class="text-base text-gray-900 font-semibold dark:text-gray-100">
        {{ T.levelRewards }}
      </h3>
      <span class="text-xs text-gray-500 dark:text-gray-400">
        {{ passport?.levelRewardTiers?.length || 0 }} {{ T.tierUnit }}
      </span>
    </div>

    <div
      v-if="!passport?.levelRewardTiers?.length"
      class="m-4 rounded-lg bg-gray-50 p-6 text-center text-sm text-gray-500 dark:bg-gray-900/40 dark:text-gray-400"
    >
      {{ labels.empty }}
    </div>

    <div v-else class="grid grid-cols-[repeat(auto-fill,minmax(156px,1fr))] gap-3 p-4">
      <article
        v-for="tier in passport.levelRewardTiers"
        :key="tier.level"
        class="min-h-[216px] min-w-0 flex flex-col overflow-hidden border border-gray-200 rounded-lg bg-white shadow-sm dark:border-gray-700 dark:bg-gray-900/20"
      >
        <div class="relative grid h-24 place-items-center bg-gray-50 dark:bg-gray-900/40">
          <span
            class="absolute left-0 top-0 rounded-br-lg px-2 py-1 text-[10px] font-semibold"
            :class="tierStateClass(passport, tier.level)"
          >
            {{ tierState(passport, tier.level) }}
          </span>
          <ActivityItemImage v-if="tierThumb(tier)?.image"
            :item="tierThumb(tier)!"
            img-class="max-h-16 max-w-16"
          />
          <div v-else class="grid h-14 w-14 place-items-center rounded-lg bg-white text-sm text-gray-500 font-semibold dark:bg-gray-800">
            Lv.{{ tier.level }}
          </div>
        </div>

        <div class="min-h-[120px] flex flex-1 flex-col p-3">
          <div class="flex items-center justify-between gap-2">
            <div class="truncate text-sm text-gray-900 font-semibold dark:text-gray-100">
              {{ T.levelPrefix }} {{ tier.level }} {{ T.levelUnit }}
            </div>
            <div class="flex shrink-0 -space-x-1">
              <span
                v-for="item in previewRewards(tier)"
                :key="`${tier.level}-${item.itemId}-${item.itemCount}`"
                class="grid h-6 w-6 place-items-center rounded-full bg-white ring-1 ring-gray-100 dark:bg-gray-800 dark:ring-gray-700"
              >
                <ActivityItemImage :item="item"
                  img-class="h-4 w-4"
                />
              </span>
            </div>
          </div>
          <div class="mt-2 text-[11px] text-gray-500 leading-5 space-y-1 dark:text-gray-400">
            <div class="line-clamp-2">
              {{ T.freeTrack }}: {{ rewardSummary(tier.freeRewards) }}
            </div>
            <div class="line-clamp-2">
              {{ T.premiumTrack }}: {{ rewardSummary(tier.premiumRewards) }}
            </div>
          </div>
        </div>
      </article>
    </div>
  </section>
</template>
