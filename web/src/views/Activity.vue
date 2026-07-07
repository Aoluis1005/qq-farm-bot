<script setup lang="ts">
import type { ActivityLabels, ActivitySection, ActivitySectionKey } from '@/components/activity/types'
import type { ActivityExchangeShopItem } from '@/stores/activity'
import { storeToRefs } from 'pinia'
import { computed, onMounted, ref, watch } from 'vue'
import ActivitySubActivityPanel from '@/components/activity/ActivitySubActivityPanel.vue'
import HeluDrawPanel from '@/components/activity/HeluDrawPanel.vue'
import HeluExchangePanel from '@/components/activity/HeluExchangePanel.vue'
import HeluPassportPanel from '@/components/activity/HeluPassportPanel.vue'
import HeluSolarTermsPanel from '@/components/activity/HeluSolarTermsPanel.vue'
import QingmeiActivityPanel from '@/components/activity/QingmeiActivityPanel.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import { useAccountStore } from '@/stores/account'
import { useActivityStore } from '@/stores/activity'
import { useToastStore } from '@/stores/toast'
import { formatGoldAmount } from '@/utils/number-format'

const L: ActivityLabels = {
  title: '\u6D3B\u52A8\u4E2D\u5FC3',
  currentAccount: '\u5F53\u524D\u8D26\u53F7',
  none: '\u672A\u9009\u62E9',
  needAccount: '\u8BF7\u5148\u9009\u62E9\u8D26\u53F7\uFF0C\u518D\u67E5\u770B\u6D3B\u52A8\u6570\u636E\u3002',
  refresh: '\u5237\u65B0',
  loading: '\u6B63\u5728\u52A0\u8F7D\u6D3B\u52A8\u6570\u636E...',
  empty: '\u6682\u65E0\u6570\u636E',
  warningTitle: '\u6D3B\u52A8\u63D0\u793A',
  heluTitle: '\u8377\u9732\u6D3B\u52A8',
  giftLotusTab: '\u5947\u9047\u793C\u83B2',
  shopTab: '\u8377\u9732\u5546\u5E97',
  journeyTab: '\u8377\u98CE\u6E38\u8BB0',
  notesTab: '\u8282\u4EE4\u5C0F\u672D',
  pool: '\u5956\u6C60',
  recent: '\u6700\u8FD1\u7ED3\u679C',
  freeRemain: '\u514D\u8D39\u5269\u4F59',
  paidRemain: '\u70B9\u5238\u5269\u4F59',
  dailyUsed: '\u4ECA\u65E5\u5DF2\u62BD',
  dailyRemain: '\u4ECA\u65E5\u5269\u4F59',
  helu: '\u8377\u9732',
  heluBalance: '\u8377\u9732\u4F59\u989D',
  exchangeGoods: '\u5151\u6362\u5956\u52B1',
  drawOne: '\u62BD 1 \u6B21',
  drawBatch: '\u62BD\u591A\u6B21',
  drawDone: '\u62BD\u5956\u5B8C\u6210',
  batchDone: '\u6279\u91CF\u62BD\u5956\u5B8C\u6210',
  drawFail: '\u62BD\u5956\u5931\u8D25',
  exchangeDone: '\u5151\u6362\u6210\u529F\uFF1A',
  exchangeFail: '\u5151\u6362\u5931\u8D25',
  canExchange: '\u7ACB\u5373\u5151\u6362',
  unavailable: '\u6682\u4E0D\u53EF\u7528',
  owned: '\u5DF2\u62E5\u6709',
  noHelu: '\u8377\u9732\u4E0D\u8DB3',
  unsupportedCurrency: '\u6682\u4E0D\u652F\u6301\u8BE5\u8D27\u5E01',
  priceLabel: '\u4EF7\u683C',
  stateLabel: '\u72B6\u6001',
  drawCostLabel: '\u62BD\u5956\u8BF4\u660E',
  freeDraw: '\u4F18\u5148\u6D88\u8017\u514D\u8D39\u6B21\u6570',
  paidDraw: '\u6BCF\u6B21\u6D88\u8017',
  recentCost: '\u672C\u6B21\u6D88\u8017',
  rewardPoolCount: '\u5956\u6C60\u5956\u52B1',
  exchangeCount: '\u5151\u6362\u5956\u52B1',
  typeFallback: '\u6D3B\u52A8\u5956\u52B1',
  gold: '\u91D1\u5E01',
  coupon: '\u70B9\u5238',
  activityCurrency: '\u6D3B\u52A8\u8D27\u5E01',
  defaultHeluTitle: '\u8377\u98CE\u5341\u91CC\u83B2\u521D\u7EFD',
  decorationLabel: '\u88C5\u626E',
  subActivityUnavailable: '\u6682\u672A\u4ECE\u6D3B\u52A8\u6570\u636E\u4E2D\u8BFB\u5230\u8BE5\u5B50\u6D3B\u52A8\u8282\u70B9\u3002',
  activityStatus: '\u6D3B\u52A8\u72B6\u6001',
} as const

const SHOW_QINGMEI_ACTIVITY = false

const accountStore = useAccountStore()
const activityStore = useActivityStore()
const toast = useToastStore()

const { currentAccountId, currentAccount } = storeToRefs(accountStore)
const {
  heluActivity,
  heluLoading,
  drawLoading,
  exchangeLoading,
  passportClaimLoading,
  solarClaimLoading,
  qingmeiClaimLoading,
  qingmeiSellLoading,
  heluError,
} = storeToRefs(activityStore)

const activeSection = ref<ActivitySectionKey>('giftLotus')

const drawInfo = computed(() => heluActivity.value?.draw)
const rewardPool = computed(() => drawInfo.value?.rewardPool || [])
const recentRewards = computed(() => {
  const result = heluActivity.value?.lastDrawResult
  return [...(result?.rewards || []), ...(result?.items || [])]
})
const heluExchangeItems = computed(() => heluActivity.value?.exchangeShop || [])
const heluBalance = computed(() => heluActivity.value?.heluBalance || 0)
const activityWarning = computed(() => String(heluActivity.value?.warning || '').trim())
const anyLoading = computed(() => heluLoading.value)
const subActivities = computed(() => heluActivity.value?.subActivities || [])
const passport = computed(() => heluActivity.value?.passport || null)
const solarTerms = computed(() => heluActivity.value?.solarTerms || null)
const qingmeiActivity = computed(() => heluActivity.value?.qingmei || null)

const recentCostText = computed(() => {
  const cost = heluActivity.value?.lastDrawResult?.cost
  if (!cost || !Number(cost.itemCount || 0))
    return ''
  return `${cost.itemCount} ${cost.itemName || getCurrencyNameById(cost.itemId)}`
})

const sectionTabs = computed<ActivitySection[]>(() => [
  { key: 'giftLotus', label: L.giftLotusTab, icon: 'i-carbon-gift', count: rewardPool.value.length },
  { key: 'shop', label: L.shopTab, icon: 'i-carbon-store', count: heluExchangeItems.value.length },
  { key: 'journey', label: L.journeyTab, icon: 'i-carbon-map', count: passport.value?.claimableLevels || 0 },
  { key: 'notes', label: L.notesTab, icon: 'i-carbon-notebook', count: solarTerms.value?.claimableCount || 0 },
  ...(SHOW_QINGMEI_ACTIVITY
    ? [{ key: 'qingmei' as const, label: '青梅酿万金', icon: 'i-carbon-fruit-bowl', count: qingmeiActivity.value?.claimable ? 1 : 0 }]
    : []),
])
const activeError = computed(() => heluError.value)
const activeSubActivity = computed(() => {
  return subActivities.value.find(item => item.key === activeSection.value)
    || subActivities.value.find(item => item.key === 'giftLotus')
    || null
})
const headerPills = computed(() => [
  {
    label: L.heluBalance,
    value: formatNumber(heluBalance.value),
    icon: 'i-carbon-currency',
    class: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300',
  },
  {
    label: L.dailyRemain,
    value: drawInfo.value?.dailyRemaining || 0,
    icon: 'i-carbon-time',
    class: 'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300',
  },
  {
    label: L.currentAccount,
    value: currentAccount.value?.name || L.none,
    icon: 'i-carbon-user',
    class: 'bg-gray-50 text-gray-700 dark:bg-gray-900/40 dark:text-gray-300',
  },
])

function segmentedButtonClasses(active: boolean) {
  return active
    ? 'text-white shadow-sm'
    : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'
}

function formatNumber(value?: number) {
  return Number(value || 0).toLocaleString()
}

function getCurrencyNameById(currencyId?: number) {
  const id = Number(currencyId || 0)
  if (id === 1018)
    return L.helu
  if (id === 1002)
    return L.coupon
  if (id === 1001)
    return L.gold
  return L.activityCurrency
}

async function refreshAll() {
  if (!currentAccountId.value)
    return
  await activityStore.fetchHeluActivity(currentAccountId.value)
}

async function draw(mode: 'one' | 'batch') {
  if (!currentAccountId.value || drawLoading.value)
    return

  const result = await activityStore.drawHelu(currentAccountId.value, { mode })
  if (result?.ok)
    toast.success(mode === 'one' ? L.drawDone : L.batchDone)
  else
    toast.error(result?.error || L.drawFail)
}

async function exchange(item: ActivityExchangeShopItem) {
  if (!currentAccountId.value)
    return

  const result = await activityStore.exchangeHelu(currentAccountId.value, item.id)
  if (result?.ok)
    toast.success(L.exchangeDone + item.itemName)
  else
    toast.error(result?.error || L.exchangeFail)
}

async function claimPassport() {
  if (!currentAccountId.value)
    return

  const result = await activityStore.claimHeluPassport(currentAccountId.value)
  if (result?.ok)
    toast.success('荷风游记奖励领取完成')
  else
    toast.error(result?.error || '荷风游记领取失败')
}

async function claimSolar(term: { id: number, title?: string }) {
  if (!currentAccountId.value)
    return

  const result = await activityStore.claimHeluSolar(currentAccountId.value, term.id)
  if (result?.ok)
    toast.success(`节令小札领取完成：${term.title || term.id}`)
  else
    toast.error(result?.error || '节令小札领取失败')
}

async function claimQingmei() {
  if (!currentAccountId.value)
    return

  const result = await activityStore.claimQingmeiSeeds(currentAccountId.value)
  if (result?.ok && result.alreadyClaimed)
    toast.success('今日已领取青梅种子')
  else if (result?.ok)
    toast.success(`已领取青梅种子 × ${result.claimedCount || 24}`)
  else
    toast.error(result?.error || '青梅种子领取失败')
}

async function sellQingmeiWine() {
  if (!currentAccountId.value)
    return

  const result = await activityStore.brewAndSellQingmeiWine(currentAccountId.value)
  if (result?.ok) {
    const gold = Number(result.sell?.gold || result.sell?.item?.itemCount || 0)
    toast.success(gold > 0 ? `青梅酿售卖完成，获得金币 ${formatGoldAmount(gold)}` : '青梅酿售卖完成')
  }
  else {
    toast.error(result?.error || '青梅酿售卖失败')
  }
}

watch(sectionTabs, (sections) => {
  if (!sections.some(section => section.key === activeSection.value))
    activeSection.value = sections[0]?.key || 'giftLotus'
}, { immediate: true })

watch(currentAccountId, () => {
  activityStore.clearActivityData()
  refreshAll()
})

onMounted(() => {
  refreshAll()
})
</script>

<template>
  <section class="space-y-4">
    <header class="rounded-lg bg-white p-4 shadow-sm dark:bg-gray-800">
      <div class="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div class="min-w-0 flex flex-wrap items-center gap-3">
          <div class="flex items-center gap-2">
            <div class="i-carbon-events text-2xl text-emerald-500" />
            <h1 class="text-xl text-gray-900 font-bold dark:text-gray-100">
              {{ L.title }}
            </h1>
          </div>
          <div class="flex flex-wrap items-center gap-2 text-sm">
            <div
              v-for="item in headerPills"
              :key="item.label"
              class="h-8 flex items-center gap-2 rounded-lg px-3 text-xs"
              :class="item.class"
            >
              <span :class="item.icon" />
              <span>{{ item.label }} {{ item.value }}</span>
            </div>
          </div>
        </div>

        <div class="min-w-0 flex flex-wrap items-center gap-2">
          <div class="max-w-full min-w-0 overflow-x-auto pb-1">
            <div class="h-9 min-w-max inline-flex overflow-hidden border border-gray-200 rounded-lg bg-white p-0.5 dark:border-gray-700 dark:bg-gray-800">
              <button
                v-for="section in sectionTabs"
                :key="section.key"
                class="min-w-20 shrink-0 rounded-md px-3 text-sm font-medium transition"
                :class="segmentedButtonClasses(activeSection === section.key)"
                :style="activeSection === section.key ? { backgroundColor: 'var(--theme-primary)' } : {}"
                @click="activeSection = section.key"
              >
                <span>{{ section.label }}</span>
              </button>
            </div>
          </div>
          <BaseButton
            class="w-24"
            variant="primary"
            :loading="anyLoading"
            :disabled="!currentAccountId"
            @click="refreshAll"
          >
            {{ L.refresh }}
          </BaseButton>
        </div>
      </div>
    </header>

    <div
      v-if="!currentAccountId"
      class="rounded-lg bg-white p-10 text-center text-sm text-gray-500 shadow dark:bg-gray-800 dark:text-gray-400"
    >
      <div class="i-carbon-user-profile mx-auto mb-3 text-3xl text-gray-300" />
      {{ L.needAccount }}
    </div>

    <template v-else>
      <div class="min-w-0 space-y-4">
        <div
          v-if="activityWarning"
          class="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800 shadow-sm dark:bg-amber-900/20 dark:text-amber-100"
        >
          <div class="font-semibold">
            {{ L.warningTitle }}
          </div>
          <div class="mt-1">
            {{ activityWarning }}
          </div>
        </div>

        <div
          v-if="activeError"
          class="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600 shadow-sm dark:bg-red-900/20 dark:text-red-300"
        >
          {{ activeError }}
        </div>

        <div
          v-if="anyLoading && !activeError"
          class="rounded-lg bg-sky-50 px-4 py-3 text-sm text-sky-900 shadow-sm dark:bg-sky-900/20 dark:text-sky-100"
        >
          {{ L.loading }}
        </div>

        <HeluDrawPanel
          v-if="activeSection === 'giftLotus'"
          :title="activeSubActivity?.title || L.giftLotusTab"
          :balance="heluBalance"
          :draw-info="drawInfo"
          :reward-pool="rewardPool"
          :recent-rewards="recentRewards"
          :recent-cost-text="recentCostText"
          :draw-loading="drawLoading"
          :labels="L"
          @draw="draw"
        />

        <HeluExchangePanel
          v-else-if="activeSection === 'shop'"
          :items="heluExchangeItems"
          :balance="heluBalance"
          :exchange-loading="exchangeLoading"
          :labels="L"
          @exchange="exchange"
        />

        <HeluPassportPanel
          v-else-if="activeSection === 'journey'"
          :passport="passport"
          :loading="passportClaimLoading"
          :labels="L"
          @claim="claimPassport"
        />

        <HeluSolarTermsPanel
          v-else-if="activeSection === 'notes'"
          :solar-terms="solarTerms"
          :loading="solarClaimLoading"
          :labels="L"
          @claim="claimSolar"
        />

        <QingmeiActivityPanel
          v-else-if="SHOW_QINGMEI_ACTIVITY && activeSection === 'qingmei'"
          :activity="qingmeiActivity"
          :loading="qingmeiClaimLoading"
          :sell-loading="qingmeiSellLoading"
          @claim="claimQingmei"
          @sell-wine="sellQingmeiWine"
        />

        <ActivitySubActivityPanel
          v-else-if="activeSubActivity"
          :activity="activeSubActivity"
          :labels="L"
        />
      </div>
    </template>
  </section>
</template>
