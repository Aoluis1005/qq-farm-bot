<script setup lang="ts">
import { useIntervalFn, useStorage } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useAccountStore } from '@/stores/account'
import { useShopStore } from '@/stores/shop'
import { useToastStore } from '@/stores/toast'

const accountStore = useAccountStore()
const shopStore = useShopStore()
const toast = useToastStore()
const router = useRouter()

const { currentAccountId } = storeToRefs(accountStore)
const { mysteryOffer, mysteryOfferAccountId, mysteryLoading } = storeToRefs(shopStore)

const MYSTERY_OFFER_REFRESH_INTERVAL = 3 * 60 * 60 * 1000
const now = ref(Date.now())
const notifiedOfferKeys = useStorage<Record<string, string>>('mystery_merchant_notified_offer_keys', {})

function getTimestampMs(timestamp?: number) {
  const value = Number(timestamp || 0)
  if (!value)
    return 0
  return value > 10_000_000_000 ? value : value * 1000
}

const isCurrentAccountOffer = computed(() => {
  return !!currentAccountId.value && mysteryOfferAccountId.value === String(currentAccountId.value)
})

const offerEndMs = computed(() => getTimestampMs(mysteryOffer.value?.endTime))

const hasActiveMysteryOffer = computed(() => {
  const offer = mysteryOffer.value
  if (!isCurrentAccountOffer.value || !offer?.active || offer.purchased)
    return false
  return !offerEndMs.value || offerEndMs.value > now.value
})

const remainingText = computed(() => {
  if (!offerEndMs.value)
    return '限时出现'

  const totalSeconds = Math.max(0, Math.floor((offerEndMs.value - now.value) / 1000))
  const days = Math.floor(totalSeconds / 86400)
  const hours = Math.floor((totalSeconds % 86400) / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const clock = [hours, minutes, seconds].map(v => String(v).padStart(2, '0')).join(':')

  return days > 0 ? `${days}天 ${clock}` : clock
})

const offerKey = computed(() => {
  const offer = mysteryOffer.value
  if (!currentAccountId.value || !offer?.active)
    return ''
  return [
    currentAccountId.value,
    offer.npcId,
    offer.itemId,
    offer.startTime,
    offer.endTime,
  ].join(':')
})

async function refreshMysteryOffer() {
  if (!currentAccountId.value || mysteryLoading.value)
    return
  await shopStore.fetchMysteryShop(String(currentAccountId.value))
}

function openMysteryShop() {
  router.push({ path: '/shop', query: { tab: 'mystery' } })
}

useIntervalFn(() => {
  now.value = Date.now()
}, 1000)

useIntervalFn(() => {
  refreshMysteryOffer()
}, MYSTERY_OFFER_REFRESH_INTERVAL, { immediate: false })

watch(
  currentAccountId,
  () => {
    refreshMysteryOffer()
  },
  { immediate: true },
)

watch(
  [hasActiveMysteryOffer, offerKey],
  ([active, key]) => {
    const accountId = String(currentAccountId.value || '')
    if (!active || !key || !accountId)
      return
    if (notifiedOfferKeys.value[accountId] === key)
      return

    notifiedOfferKeys.value = {
      ...notifiedOfferKeys.value,
      [accountId]: key,
    }
    const offer = mysteryOffer.value
    toast.warning(`神秘商人来了：${offer?.itemName || '限时商品'} x${offer?.itemCount || 1}`, 6000)
  },
  { immediate: true },
)
</script>

<template>
  <div
    v-if="hasActiveMysteryOffer"
    class="mx-2 mt-2 overflow-hidden border border-amber-300/80 rounded-lg bg-amber-50 shadow-sm md:mx-4 dark:border-amber-500/40 dark:bg-amber-950/35"
  >
    <div class="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div class="min-w-0 flex items-center gap-3">
        <div class="relative grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-amber-500 text-white shadow-sm">
          <div class="i-carbon-store text-xl" />
          <span class="absolute h-3 w-3 rounded-full bg-red-500 ring-2 ring-amber-50 -right-0.5 -top-0.5 dark:ring-amber-950" />
        </div>
        <div class="min-w-0">
          <div class="truncate text-sm text-amber-950 font-semibold dark:text-amber-100">
            神秘商人来了
            <span v-if="mysteryOffer?.itemName">：{{ mysteryOffer.itemName }} x{{ mysteryOffer.itemCount }}</span>
          </div>
          <div class="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-amber-800 dark:text-amber-200">
            <span>剩余 {{ remainingText }}</span>
            <span v-if="mysteryOffer?.discount">{{ mysteryOffer.discount / 10 }} 折限时商品</span>
          </div>
        </div>
      </div>

      <button
        class="h-9 inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-amber-600 px-3 text-sm text-white font-medium shadow-sm transition hover:bg-amber-700"
        @click="openMysteryShop"
      >
        <span>去看看</span>
        <div class="i-carbon-arrow-right text-base" />
      </button>
    </div>
  </div>
</template>
