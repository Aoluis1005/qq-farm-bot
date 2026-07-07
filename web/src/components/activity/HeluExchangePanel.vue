<script setup lang="ts">
import type { ActivityLabels, ExchangeItem, ExchangeState } from './types'
import { ref } from 'vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import { formatCurrencyAmountByLabel } from '@/utils/number-format'

const props = defineProps<{
  items: ExchangeItem[]
  balance: number
  exchangeLoading: boolean
  labels: ActivityLabels
}>()

const emit = defineEmits<{
  (event: 'exchange', item: ExchangeItem): void
}>()

const imageErrors = ref<Record<string | number, boolean>>({})

function formatPrice(item: ExchangeItem) {
  return formatCurrencyAmountByLabel(item.price, getCurrencyLabel(item))
}

function itemImage(item: { image?: string }) {
  return item.image || ''
}

function itemFallbackText(item: { itemName?: string, name?: string, itemId?: number }) {
  const name = String(item.itemName || item.name || '').trim()
  if (name)
    return name.slice(0, 1)
  return String(item.itemId || '?')
}

function hasImage(item: ExchangeItem) {
  return Boolean(itemImage(item)) && !imageErrors.value[item.id]
}

function getCurrencyNameById(currencyId?: number) {
  const id = Number(currencyId || 0)
  if (id === 1018)
    return props.labels.helu
  if (id === 1002)
    return props.labels.coupon
  if (id === 1001)
    return props.labels.gold
  return props.labels.activityCurrency
}

function getExchangeState(item: ExchangeItem): ExchangeState {
  const price = Number(item.price || 0)
  const isHeluCurrency = Number(item.currencyId || 0) === 1018
  const ownedBlocksExchange = item.ownedBlocksExchange !== false && item.owned === true && item.isRepeatable !== true
  const canExchange = isHeluCurrency && !ownedBlocksExchange && price > 0 && props.balance >= price

  if (ownedBlocksExchange)
    return { canExchange: false, label: props.labels.owned }
  if (canExchange)
    return { canExchange: true, label: props.labels.canExchange }
  if (isHeluCurrency && props.balance < price)
    return { canExchange: false, label: props.labels.noHelu }
  if (!isHeluCurrency)
    return { canExchange: false, label: props.labels.unsupportedCurrency }

  return { canExchange: false, label: item.statusLabel || props.labels.unavailable }
}

function getCurrencyLabel(item: ExchangeItem) {
  if ('currencyName' in item && item.currencyName)
    return item.currencyName
  return getCurrencyNameById(item.currencyId)
}
</script>

<template>
  <div class="space-y-4">
    <div v-if="items.length === 0" class="rounded-lg bg-white p-10 text-center text-sm text-gray-500 shadow dark:bg-gray-800 dark:text-gray-400">
      {{ labels.empty }}
    </div>

    <div v-else class="grid grid-cols-[repeat(auto-fill,minmax(156px,1fr))] gap-3">
      <article
        v-for="item in items"
        :key="item.id"
        class="min-h-[216px] min-w-0 flex flex-col overflow-hidden border border-gray-200 rounded-lg bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800"
      >
        <div class="relative grid h-24 place-items-center bg-gray-50 dark:bg-gray-900/40">
          <span class="absolute left-0 top-0 rounded-br-lg bg-white/90 px-2 py-0.5 text-[10px] text-gray-500 font-semibold dark:bg-gray-800/90 dark:text-gray-300">
            {{ getExchangeState(item).label }}
          </span>
          <img
            v-if="hasImage(item)"
            :src="itemImage(item)"
            :alt="item.itemName"
            class="max-h-14 max-w-14 object-contain"
            @error="imageErrors[item.id] = true"
          >
          <div v-else class="grid h-14 w-14 place-items-center rounded-lg bg-white text-sm text-gray-500 font-semibold dark:bg-gray-800">
            {{ itemFallbackText(item) }}
          </div>
        </div>

        <div class="min-h-[120px] flex flex-1 flex-col p-3">
          <div class="min-w-0 text-center">
            <div class="line-clamp-2 text-sm text-gray-900 font-semibold dark:text-gray-100">
              {{ item.itemName }}
            </div>
            <div class="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {{ item.itemTypeLabel || labels.typeFallback }} / x{{ item.itemCount }}
              <span v-if="Number(item.exchangeLimit || 0) > 0">
                / 上限 {{ item.exchangeLimit }}
              </span>
            </div>
          </div>

          <div class="mt-2 text-center text-xs text-amber-600 font-semibold dark:text-amber-400">
            {{ formatPrice(item) }} {{ getCurrencyLabel(item) }}
          </div>

          <div class="mt-auto pt-3">
            <BaseButton
              class="w-full"
              :variant="getExchangeState(item).canExchange ? 'primary' : 'secondary'"
              :loading="exchangeLoading"
              :disabled="!getExchangeState(item).canExchange"
              @click="emit('exchange', item)"
            >
              {{ getExchangeState(item).label }}
            </BaseButton>
          </div>
        </div>
      </article>
    </div>
  </div>
</template>
