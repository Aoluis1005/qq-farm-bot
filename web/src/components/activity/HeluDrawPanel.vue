<script setup lang="ts">
import type { ActivityLabels } from './types'
import type { HeluActivityData, HeluDrawReward } from '@/stores/activity'
import { ref } from 'vue'
import BaseButton from '@/components/ui/BaseButton.vue'

defineProps<{
  title: string
  balance: number
  drawInfo?: HeluActivityData['draw']
  rewardPool: HeluDrawReward[]
  recentRewards: HeluDrawReward[]
  recentCostText: string
  drawLoading: boolean
  labels: ActivityLabels
}>()

const emit = defineEmits<{
  (event: 'draw', mode: 'one' | 'batch'): void
}>()

const imageErrors = ref<Record<string, boolean>>({})

function formatNumber(value?: number) {
  return Number(value || 0).toLocaleString()
}

function itemImage(item: { image?: string }) {
  return item.image || ''
}

function itemFallbackText(item: { itemName?: string, name?: string, itemId?: number }) {
  // 优先用 item.name（中文真名），itemName 兜底
  const name = String(item.name || item.itemName || '').trim()
  if (name)
    return name.slice(0, 1)
  return String(item.itemId || '?')
}

function keyOf(item: { itemId?: number, id?: number, itemName?: string, name?: string }) {
  return [item.id || item.itemId || 0, item.name || item.itemName || 'item'].join('-')
}

function hasImage(item: { image?: string, itemId?: number, id?: number, itemName?: string, name?: string }) {
  return Boolean(itemImage(item)) && !imageErrors.value[keyOf(item)]
}
</script>

<template>
  <div class="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
    <section class="rounded-lg bg-white p-5 shadow dark:bg-gray-800">
      <div class="mb-4 flex items-center justify-between">
        <div>
          <h3 class="text-base text-gray-900 font-semibold dark:text-gray-100">
            {{ title }}
          </h3>
          <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {{ labels.helu }} {{ formatNumber(balance) }}
          </p>
        </div>
        <div class="grid h-12 w-12 place-items-center rounded-lg bg-blue-50 text-blue-500 dark:bg-blue-900/20">
          <div class="i-carbon-ticket text-xl" />
        </div>
      </div>

      <div class="grid grid-cols-2 gap-3">
        <div class="rounded-lg bg-gray-50 px-3 py-3 dark:bg-gray-900/40">
          <div class="text-lg font-semibold">
            {{ drawInfo?.freeRemaining || 0 }}
          </div>
          <div class="text-xs text-gray-500 dark:text-gray-400">
            {{ labels.freeRemain }}
          </div>
        </div>
        <div class="rounded-lg bg-gray-50 px-3 py-3 dark:bg-gray-900/40">
          <div class="text-lg font-semibold">
            {{ drawInfo?.paidRemaining || 0 }}
          </div>
          <div class="text-xs text-gray-500 dark:text-gray-400">
            {{ labels.paidRemain }}
          </div>
        </div>
        <div class="rounded-lg bg-gray-50 px-3 py-3 dark:bg-gray-900/40">
          <div class="text-lg font-semibold">
            {{ drawInfo?.dailyUsed || 0 }}
          </div>
          <div class="text-xs text-gray-500 dark:text-gray-400">
            {{ labels.dailyUsed }}
          </div>
        </div>
        <div class="rounded-lg bg-gray-50 px-3 py-3 dark:bg-gray-900/40">
          <div class="text-lg font-semibold">
            {{ drawInfo?.dailyRemaining || 0 }}
          </div>
          <div class="text-xs text-gray-500 dark:text-gray-400">
            {{ labels.dailyRemain }}
          </div>
        </div>
      </div>

      <div class="grid mt-4 gap-3 sm:grid-cols-2">
        <BaseButton
          variant="primary"
          block
          :loading="drawLoading"
          :disabled="!(drawInfo?.actions?.one?.available)"
          @click="emit('draw', 'one')"
        >
          {{ drawInfo?.actions?.one?.label || labels.drawOne }}
        </BaseButton>

        <BaseButton
          variant="secondary"
          block
          :loading="drawLoading"
          :disabled="!(drawInfo?.actions?.batch?.available)"
          @click="emit('draw', 'batch')"
        >
          {{ drawInfo?.actions?.batch?.label || labels.drawBatch }}
        </BaseButton>
      </div>
    </section>

    <div class="space-y-4">
      <section class="rounded-lg bg-white shadow-sm dark:bg-gray-800">
        <div class="flex items-center justify-between border-b border-gray-100 px-4 py-3 dark:border-gray-700">
          <h3 class="text-base text-gray-900 font-semibold dark:text-gray-100">
            {{ labels.pool }}
          </h3>
          <span class="text-xs text-gray-500 dark:text-gray-400">{{ rewardPool.length }}</span>
        </div>

        <div v-if="rewardPool.length === 0" class="m-4 rounded-lg bg-gray-50 p-8 text-center text-sm text-gray-500 dark:bg-gray-900/40 dark:text-gray-400">
          {{ labels.empty }}
        </div>

        <div v-else class="grid grid-cols-[repeat(auto-fill,minmax(156px,1fr))] gap-3 p-4">
          <div
            v-for="item in rewardPool"
            :key="keyOf(item)"
            class="min-h-[156px] min-w-0 overflow-hidden border border-gray-200 rounded-lg bg-white text-center shadow-sm dark:border-gray-700 dark:bg-gray-900/30"
          >
            <div class="grid h-24 place-items-center bg-gray-50 dark:bg-gray-900/40">
              <img
                v-if="hasImage(item)"
                :src="itemImage(item)"
                :alt="item.name || item.itemName"
                class="max-h-14 max-w-14 object-contain"
                @error="imageErrors[keyOf(item)] = true"
              >
              <span v-else class="text-sm text-gray-500 font-semibold">{{ itemFallbackText(item) }}</span>
            </div>
            <div class="min-w-0 p-3">
              <div class="line-clamp-2 text-sm text-gray-900 font-semibold dark:text-gray-100">
                {{ item.name || item.itemName }}
              </div>
              <div class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                x{{ item.itemCount }}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section class="rounded-lg bg-white shadow-sm dark:bg-gray-800">
        <div class="flex items-center justify-between border-b border-gray-100 px-4 py-3 dark:border-gray-700">
          <div>
            <h3 class="text-base text-gray-900 font-semibold dark:text-gray-100">
              {{ labels.recent }}
            </h3>
            <div v-if="recentCostText" class="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {{ labels.recentCost }}: {{ recentCostText }}
            </div>
          </div>
          <span class="text-xs text-gray-500 dark:text-gray-400">{{ recentRewards.length }}</span>
        </div>

        <div v-if="recentRewards.length === 0" class="m-4 rounded-lg bg-gray-50 p-8 text-center text-sm text-gray-500 dark:bg-gray-900/40 dark:text-gray-400">
          {{ labels.empty }}
        </div>

        <div v-else class="grid grid-cols-[repeat(auto-fill,minmax(156px,1fr))] gap-3 p-4">
          <div
            v-for="item in recentRewards"
            :key="keyOf(item)"
            class="min-h-[156px] min-w-0 overflow-hidden border border-gray-200 rounded-lg bg-white text-center shadow-sm dark:border-gray-700 dark:bg-gray-900/30"
          >
            <div class="grid h-24 place-items-center bg-gray-50 dark:bg-gray-900/40">
              <img
                v-if="hasImage(item)"
                :src="itemImage(item)"
                :alt="item.name || item.itemName"
                class="max-h-14 max-w-14 object-contain"
                @error="imageErrors[keyOf(item)] = true"
              >
              <span v-else class="text-sm text-gray-500 font-semibold">{{ itemFallbackText(item) }}</span>
            </div>
            <div class="min-w-0 p-3">
              <div class="line-clamp-2 text-sm text-gray-900 font-semibold dark:text-gray-100">
                {{ item.name || item.itemName }}
              </div>
              <div class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                x{{ item.itemCount }}
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>
