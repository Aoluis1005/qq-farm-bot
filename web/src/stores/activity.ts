import { defineStore } from 'pinia'
import { ref } from 'vue'
import api from '@/api'
import { useAccountStore } from '@/stores/account'

export interface ActivityExchangeShopItem {
  id: number
  sort: number
  status: number
  owned: boolean
  isRepeatable?: boolean
  exchangeLimit?: number
  ownedBlocksExchange?: boolean
  statusLabel: string
  name: string
  itemId: number
  itemCount: number
  itemName: string
  image?: string
  itemType: number
  itemTypeLabel: string
  isDecoration: boolean
  currencyId: number
  currencyName: string
  price: number
  desc: string
  extra: string
}

export interface HeluDrawReward {
  itemId: number
  itemCount: number
  count?: number
  itemName: string
  name?: string
  image?: string
}

export interface HeluDrawCost {
  itemId?: number
  itemName?: string
  itemCount?: number
  image?: string
}

export interface HeluDrawResult {
  rewards?: HeluDrawReward[]
  items?: HeluDrawReward[]
  cost?: HeluDrawCost | null
}

export interface HeluSeasonRewardTier {
  level: number
  freeRewards: HeluDrawReward[]
  premiumRewards: HeluDrawReward[]
}

export interface HeluSeasonPassport {
  uid?: string
  title: string
  seasonTitle?: string
  currentLevel: number
  score?: number
  currentProgress?: number
  nextLevelNeed?: number
  maxLevel?: number
  freeClaimedLevel?: number
  premiumClaimedLevel?: number
  claimableLevels: number
  rewardTierCount?: number
  levelRewardTiers?: HeluSeasonRewardTier[]
  rewards?: HeluDrawReward[]
  configText?: string
  startTime?: number
  endTime?: number
  nowTime?: number
  warning?: string
}

export interface HeluSolarTerm {
  id: number
  title: string
  status: number
  statusLabel: string
  claimable: boolean
  startTime: number
  endTime: number
  rewards: HeluDrawReward[]
}

export interface HeluSolarTerms {
  nowTime?: number
  terms: HeluSolarTerm[]
  claimableCount: number
  currentTerm?: HeluSolarTerm | null
  tipsText?: string
  warning?: string
}

export type HeluSubActivityKey = 'giftLotus' | 'shop' | 'journey' | 'notes'

export interface QingmeiActivity {
  uid: string
  title: string
  activityId: number
  claimActivityId: number
  claimCommand: number
  wineActivityId?: number
  wineTitle?: string
  winePreviewCommand?: number
  wineBrewCommand?: number
  wineSellCommand?: number
  startTime?: number
  endTime?: number
  status?: number
  claimed: boolean
  claimable: boolean
  reward: HeluDrawReward
  material?: HeluDrawReward
  warning?: string
}

export interface QingmeiBrewResult {
  wineType: number
  cost: number
  price: number
  canDouble: boolean
}

export interface QingmeiSellResult {
  multiple: number
  gold: number
  item?: HeluDrawReward
}

export interface HeluSubActivity {
  key: HeluSubActivityKey
  id: number
  parentId: number
  title: string
  icon: string
  type: number
  sort: number
  status: number
  visible: boolean
  enabled: boolean
  startTime: number
  endTime: number
  payload?: Record<string, unknown> | null
  payloadSummary: Array<{ key: string, value: string }>
  hasDraw: boolean
  hasExchangeShop: boolean
  available: boolean
  source: string
}

export interface HeluActivityData {
  uid: string
  title: string
  activityId: number
  drawActivityId: number
  drawCommand: number
  draw: {
    freeMax: number
    freeUsed: number
    freeRemaining: number
    paidMax: number
    paidUsed: number
    paidRemaining: number
    paidPrice: number
    paidCurrencyId: number
    rewardPool: HeluDrawReward[]
    actions?: {
      one?: { count: number, available: boolean, cost: number, currencyId: number, type: string, label: string }
      batch?: { count: number, available: boolean, cost: number, currencyId: number, type: string, label: string }
    }
    dailyMax: number
    dailyUsed: number
    dailyRemaining: number
  }
  exchangeActivityId: number
  exchangeShop: ActivityExchangeShopItem[]
  subActivities: HeluSubActivity[]
  passport?: HeluSeasonPassport | null
  solarTerms?: HeluSolarTerms | null
  qingmei?: QingmeiActivity | null
  heluBalance: number
  lastDrawResult?: HeluDrawResult | null
  warning?: string
  summary: {
    rewardPoolCount: number
    exchangeShopCount: number
    activityCount: number
    subActivityCount?: number
    dailyUsed: number
    dailyRemaining: number
  }
  raw?: {
    activityCount?: number
    activityTitles?: string[]
    activityIds?: number[]
  }
}

export const useActivityStore = defineStore('activity', () => {
  const heluActivity = ref<HeluActivityData | null>(null)

  const heluLoading = ref(false)
  const drawLoading = ref(false)
  const exchangeLoading = ref(false)
  const passportClaimLoading = ref(false)
  const solarClaimLoading = ref(false)
  const qingmeiClaimLoading = ref(false)
  const qingmeiSellLoading = ref(false)

  const heluError = ref('')

  let heluRequestId = 0

  function clearActivityData() {
    heluActivity.value = null
    heluLoading.value = false
    drawLoading.value = false
    exchangeLoading.value = false
    passportClaimLoading.value = false
    solarClaimLoading.value = false
    qingmeiClaimLoading.value = false
    qingmeiSellLoading.value = false
    heluError.value = ''
  }

  function isCurrentAccount(accountId: string) {
    const accountStore = useAccountStore()
    const currentId = String((accountStore.currentAccountId as { value?: string })?.value ?? accountStore.currentAccountId ?? '')
    return currentId === String(accountId)
  }

  async function fetchHeluActivity(accountId: string) {
    if (!accountId)
      return
    const requestedId = String(accountId)
    const requestId = ++heluRequestId
    heluLoading.value = true
    heluError.value = ''
    try {
      const { data } = await api.get('/api/activity/helu', {
        headers: { 'x-account-id': accountId },
      })
      if (requestId !== heluRequestId || !isCurrentAccount(requestedId))
        return
      if (data.ok)
        heluActivity.value = data.activity || null
      else
        heluError.value = data.error || '\u83B7\u53D6\u8377\u9732\u6D3B\u52A8\u5931\u8D25'
    }
    catch (err: any) {
      if (requestId === heluRequestId && isCurrentAccount(requestedId))
        heluError.value = err.message || '\u83B7\u53D6\u8377\u9732\u6D3B\u52A8\u5931\u8D25'
    }
    finally {
      if (requestId === heluRequestId)
        heluLoading.value = false
    }
  }

  async function drawHelu(accountId: string, payload: { mode?: string, count?: number } = {}) {
    const requestedId = String(accountId)
    drawLoading.value = true
    try {
      const { data } = await api.post('/api/activity/helu/draw', payload, {
        headers: { 'x-account-id': accountId },
      })
      if (isCurrentAccount(requestedId) && data.ok && data.activity)
        heluActivity.value = data.activity
      return data
    }
    finally {
      drawLoading.value = false
    }
  }

  async function exchangeHelu(accountId: string, slotId: number, count: number) {
    const requestedId = String(accountId)
    exchangeLoading.value = true
    try {
      const { data } = await api.post('/api/activity/helu/exchange', {
        slotId,
        count,
      }, {
        headers: { 'x-account-id': accountId },
      })
      if (isCurrentAccount(requestedId) && data.ok && data.activity)
        heluActivity.value = data.activity
      return data
    }
    finally {
      exchangeLoading.value = false
    }
  }

  async function claimHeluPassport(accountId: string) {
    const requestedId = String(accountId)
    passportClaimLoading.value = true
    try {
      const { data } = await api.post('/api/activity/helu/passport/claim', {}, {
        headers: { 'x-account-id': accountId },
      })
      if (isCurrentAccount(requestedId) && data.ok && data.activity)
        heluActivity.value = data.activity
      return data
    }
    finally {
      passportClaimLoading.value = false
    }
  }

  async function claimHeluSolar(accountId: string, termId?: number) {
    const requestedId = String(accountId)
    solarClaimLoading.value = true
    try {
      const { data } = await api.post('/api/activity/helu/solar/claim', {
        termId,
      }, {
        headers: { 'x-account-id': accountId },
      })
      if (isCurrentAccount(requestedId) && data.ok && data.activity)
        heluActivity.value = data.activity
      return data
    }
    finally {
      solarClaimLoading.value = false
    }
  }

  async function claimQingmeiSeeds(accountId: string) {
    const requestedId = String(accountId)
    qingmeiClaimLoading.value = true
    try {
      const { data } = await api.post('/api/activity/qingmei/claim', {}, {
        headers: { 'x-account-id': accountId },
      })
      if (isCurrentAccount(requestedId) && data.ok && data.activity) {
        heluActivity.value = data.activity
        if (heluActivity.value?.qingmei) {
          heluActivity.value.qingmei.claimed = true
          heluActivity.value.qingmei.claimable = false
        }
      }
      else if (isCurrentAccount(requestedId) && data.ok && data.qingmei && heluActivity.value) {
        heluActivity.value.qingmei = {
          ...data.qingmei,
          claimed: true,
          claimable: false,
        }
      }
      return data
    }
    finally {
      qingmeiClaimLoading.value = false
    }
  }

  async function brewAndSellQingmeiWine(accountId: string) {
    const requestedId = String(accountId)
    qingmeiSellLoading.value = true
    try {
      const { data } = await api.post('/api/activity/qingmei/wine/sell', {
        share: true,
      }, {
        headers: { 'x-account-id': accountId },
      })
      if (isCurrentAccount(requestedId) && data.ok && data.activity)
        heluActivity.value = data.activity
      return data
    }
    finally {
      qingmeiSellLoading.value = false
    }
  }

  return {
    heluActivity,
    heluLoading,
    drawLoading,
    exchangeLoading,
    passportClaimLoading,
    solarClaimLoading,
    qingmeiClaimLoading,
    qingmeiSellLoading,
    heluError,
    clearActivityData,
    fetchHeluActivity,
    drawHelu,
    exchangeHelu,
    claimHeluPassport,
    claimHeluSolar,
    claimQingmeiSeeds,
    brewAndSellQingmeiWine,
  }
})
