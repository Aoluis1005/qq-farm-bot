import { defineStore } from 'pinia'
import { ref } from 'vue'
import api from '@/api'
import { useAccountStore } from '@/stores/account'

export interface AutomationConfig {
  farm?: boolean
  farm_push?: boolean
  land_upgrade?: boolean
  friend?: boolean
  task?: boolean
  sell?: boolean
  fertilizer_gift?: boolean
  fertilizer_buy_organic?: boolean
  fertilizer_buy_normal?: boolean
  fertilizer?: string
  fertilizer_multi_season?: boolean
  fertilizer_land_types?: string[]
  fertilizer_smart_seconds?: number
  mystery_auto_buy?: boolean
  friend_steal?: boolean
  friend_help?: boolean
  friend_bad?: boolean
  friend_golden_bug?: boolean
  friend_help_exp_limit?: boolean
  friend_turbo_mode?: boolean
  golden_bug_clear?: boolean
  skip_own_weed_bug?: boolean
}

export interface IntervalsConfig {
  farm?: number
  friend?: number
  farmMin?: number
  farmMax?: number
  friendMin?: number
  friendMax?: number
  helpMin?: number
  helpMax?: number
  stealMin?: number
  stealMax?: number
}

export interface FriendQuietHoursConfig {
  enabled?: boolean
  start?: string
  end?: string
}

export interface OfflineConfig {
  channel: string
  reloginUrlMode: string
  endpoint: string
  token: string
  title: string
  msg: string
  offlineDeleteSec: number
  smtpHost: string
  smtpPort: number
  smtpUser: string
  smtpPass: string
  senderName: string
  recipientEmail: string
  emailContent: string
}

export interface OfflineConfigSavePayload extends OfflineConfig {
  confirmed?: boolean
  confirmText?: string
}

export interface UIConfig {
  theme?: string
}

export interface AutoCodeRefreshConfig {
  enabled: boolean
  intervalMinutes: number
}

export interface SettingsState {
  plantingStrategy: string
  preferredSeedId: number
  prioritize2x2Crops: boolean
  bagSeedPriority: number[]
  bagSeedFallbackStrategy: string
  bagPriorityLandTypes: string[]
  autoAcceptFriendMinLevel: number
  intervals: IntervalsConfig
  friendQuietHours: FriendQuietHoursConfig
  automation: AutomationConfig
  autoCodeRefresh: AutoCodeRefreshConfig
  ui: UIConfig
  offlineReminder: OfflineConfig
  stealDelaySeconds: number
  plantOrderRandom: boolean
  plantDelaySeconds: number
  fertilizerBuyOrganicCount: number
  fertilizerBuyOrganicThresholdHours: number
  fertilizerBuyNormalCount: number
  fertilizerBuyNormalThresholdHours: number
  fertilizerBuyCheckIntervalMinutes: number
  goldenBugKeepCount: number
  goldenBugRoundLimit: number
  mysteryAutoBuyCurrencies: number[]
}

function createDefaultOfflineReminder(): OfflineConfig {
  return {
    channel: 'smtp',
    reloginUrlMode: 'none',
    endpoint: '',
    token: '',
    title: '账号下线提醒',
    msg: '账号下线',
    offlineDeleteSec: 0,
    smtpHost: '',
    smtpPort: 465,
    smtpUser: '',
    smtpPass: '',
    senderName: '',
    recipientEmail: '',
    emailContent: '',
  }
}

function createDefaultAutoCodeRefresh(): AutoCodeRefreshConfig {
  return {
    enabled: false,
    intervalMinutes: 60,
  }
}

function normalizeOfflineReminder(input: Partial<OfflineConfig> | null | undefined): OfflineConfig {
  return {
    ...createDefaultOfflineReminder(),
    ...(input || {}),
  }
}

export const useSettingStore = defineStore('setting', () => {
  const settings = ref<SettingsState>({
    plantingStrategy: 'max_exp',
    preferredSeedId: 0,
    prioritize2x2Crops: false,
    bagSeedPriority: [],
    bagSeedFallbackStrategy: 'level',
    bagPriorityLandTypes: ['purple', 'gold', 'black', 'red', 'normal'],
    autoAcceptFriendMinLevel: 0,
    intervals: {},
    friendQuietHours: { enabled: false, start: '23:00', end: '07:00' },
    automation: {},
    autoCodeRefresh: createDefaultAutoCodeRefresh(),
    ui: {},
    offlineReminder: createDefaultOfflineReminder(),
    stealDelaySeconds: 0,
    plantOrderRandom: false,
    plantDelaySeconds: 0,
    fertilizerBuyOrganicCount: 10,
    fertilizerBuyOrganicThresholdHours: 10,
    fertilizerBuyNormalCount: 10,
    fertilizerBuyNormalThresholdHours: 10,
    fertilizerBuyCheckIntervalMinutes: 30,
    goldenBugKeepCount: 0,
    goldenBugRoundLimit: 24,
    mysteryAutoBuyCurrencies: [],
  })
  const loading = ref(false)
  let fetchRequestId = 0

  function isCurrentAccount(accountId: string) {
    const accountStore = useAccountStore()
    const currentId = String((accountStore.currentAccountId as { value?: string })?.value ?? accountStore.currentAccountId ?? '')
    return currentId === String(accountId)
  }

  function clearSettingsState() {
    settings.value = {
      plantingStrategy: 'max_exp',
      preferredSeedId: 0,
      prioritize2x2Crops: false,
      bagSeedPriority: [],
      bagSeedFallbackStrategy: 'level',
      bagPriorityLandTypes: ['purple', 'gold', 'black', 'red', 'normal'],
      autoAcceptFriendMinLevel: 0,
      intervals: {},
      friendQuietHours: { enabled: false, start: '23:00', end: '07:00' },
      automation: {},
      autoCodeRefresh: createDefaultAutoCodeRefresh(),
      ui: {},
      offlineReminder: createDefaultOfflineReminder(),
      stealDelaySeconds: 0,
      plantOrderRandom: false,
      plantDelaySeconds: 0,
      fertilizerBuyOrganicCount: 10,
      fertilizerBuyOrganicThresholdHours: 10,
      fertilizerBuyNormalCount: 10,
      fertilizerBuyNormalThresholdHours: 10,
      fertilizerBuyCheckIntervalMinutes: 30,
      goldenBugKeepCount: 0,
      goldenBugRoundLimit: 24,
      mysteryAutoBuyCurrencies: [],
    }
    loading.value = false
  }

  async function fetchSettings(accountId: string) {
    if (!accountId)
      return
    const requestedId = String(accountId)
    const requestId = ++fetchRequestId
    loading.value = true
    try {
      const { data } = await api.get('/api/settings', {
        headers: { 'x-account-id': accountId },
      })
      if (requestId !== fetchRequestId || !isCurrentAccount(requestedId))
        return
      if (data && data.ok && data.data) {
        const d = data.data
        settings.value.plantingStrategy = d.plantingStrategy || d.strategy || 'max_exp'
        settings.value.preferredSeedId = d.preferredSeedId || d.preferredSeed || 0
        settings.value.prioritize2x2Crops = d.prioritize2x2Crops === true
        settings.value.intervals = d.intervals || {}
        settings.value.friendQuietHours = d.friendQuietHours || { enabled: false, start: '23:00', end: '07:00' }
        settings.value.automation = d.automation || {}
        settings.value.autoCodeRefresh = {
          ...createDefaultAutoCodeRefresh(),
          ...(d.autoCodeRefresh || {}),
        }
        settings.value.ui = d.ui || {}
        settings.value.autoAcceptFriendMinLevel = d.autoAcceptFriendMinLevel ?? 0
        settings.value.offlineReminder = normalizeOfflineReminder(d.offlineReminder)
        settings.value.stealDelaySeconds = d.stealDelaySeconds ?? 0
        settings.value.plantOrderRandom = d.plantOrderRandom ?? false
        settings.value.plantDelaySeconds = d.plantDelaySeconds ?? 0
        settings.value.fertilizerBuyOrganicCount = d.fertilizerBuyOrganicCount ?? 10
        settings.value.fertilizerBuyOrganicThresholdHours = d.fertilizerBuyOrganicThresholdHours ?? 10
        settings.value.fertilizerBuyNormalCount = d.fertilizerBuyNormalCount ?? 10
        settings.value.fertilizerBuyNormalThresholdHours = d.fertilizerBuyNormalThresholdHours ?? 10
        settings.value.fertilizerBuyCheckIntervalMinutes = d.fertilizerBuyCheckIntervalMinutes ?? 30
        settings.value.goldenBugKeepCount = d.goldenBugKeepCount ?? 0
        settings.value.goldenBugRoundLimit = d.goldenBugRoundLimit ?? 24
        settings.value.mysteryAutoBuyCurrencies = Array.isArray(d.mysteryAutoBuyCurrencies)
          ? d.mysteryAutoBuyCurrencies
          : []
        settings.value.bagSeedPriority = d.bagSeedPriority ?? []
        settings.value.bagSeedFallbackStrategy = d.bagSeedFallbackStrategy ?? 'level'
        settings.value.bagPriorityLandTypes = (d.bagPriorityLandTypes && d.bagPriorityLandTypes.length > 0)
          ? d.bagPriorityLandTypes
          : ['purple', 'gold', 'black', 'red', 'normal']
      }
    }
    finally {
      if (requestId === fetchRequestId)
        loading.value = false
    }
  }

  async function saveSettings(accountId: string, newSettings: any) {
    if (!accountId)
      return { ok: false, error: '未选择账号' }
    loading.value = true
    try {
      const settingsPayload = {
        plantingStrategy: newSettings.plantingStrategy,
        preferredSeedId: newSettings.preferredSeedId,
        prioritize2x2Crops: newSettings.prioritize2x2Crops === true,
        bagSeedPriority: newSettings.bagSeedPriority ?? [],
        bagSeedFallbackStrategy: newSettings.bagSeedFallbackStrategy ?? 'level',
        bagPriorityLandTypes: newSettings.bagPriorityLandTypes ?? ['purple', 'gold', 'black', 'red', 'normal'],
        autoAcceptFriendMinLevel: newSettings.autoAcceptFriendMinLevel ?? 0,
        autoCodeRefresh: newSettings.autoCodeRefresh,
        intervals: newSettings.intervals,
        friendQuietHours: newSettings.friendQuietHours,
        stealDelaySeconds: newSettings.stealDelaySeconds ?? 0,
        plantOrderRandom: newSettings.plantOrderRandom ?? false,
        plantDelaySeconds: newSettings.plantDelaySeconds ?? 0,
        fertilizerBuyOrganicCount: newSettings.fertilizerBuyOrganicCount ?? 10,
        fertilizerBuyOrganicThresholdHours: newSettings.fertilizerBuyOrganicThresholdHours ?? 10,
        fertilizerBuyNormalCount: newSettings.fertilizerBuyNormalCount ?? 10,
        fertilizerBuyNormalThresholdHours: newSettings.fertilizerBuyNormalThresholdHours ?? 10,
        fertilizerBuyCheckIntervalMinutes: newSettings.fertilizerBuyCheckIntervalMinutes ?? 30,
        goldenBugKeepCount: newSettings.goldenBugKeepCount ?? 0,
        goldenBugRoundLimit: newSettings.goldenBugRoundLimit ?? 24,
        mysteryAutoBuyCurrencies: Array.isArray(newSettings.mysteryAutoBuyCurrencies)
          ? newSettings.mysteryAutoBuyCurrencies
          : [],
      }

      await api.post('/api/settings/save', settingsPayload, {
        headers: { 'x-account-id': accountId },
      })

      if (newSettings.automation) {
        await api.post('/api/automation', newSettings.automation, {
          headers: { 'x-account-id': accountId },
        })
      }

      await fetchSettings(accountId)
      return { ok: true }
    }
    finally {
      loading.value = false
    }
  }

  async function saveOfflineConfig(config: OfflineConfigSavePayload) {
    loading.value = true
    try {
      const { data } = await api.post('/api/settings/offline-reminder', config)
      if (data && data.ok) {
        settings.value.offlineReminder = normalizeOfflineReminder(config)
        return { ok: true }
      }
      return { ok: false, error: '保存失败' }
    }
    finally {
      loading.value = false
    }
  }

  async function saveAutoCodeRefresh(accountId: string, config: AutoCodeRefreshConfig) {
    if (!accountId)
      return { ok: false, error: '未选择账号' }
    loading.value = true
    try {
      const { data } = await api.post('/api/settings/auto-code-refresh', config, {
        headers: { 'x-account-id': accountId },
      })
      if (data && data.ok) {
        settings.value.autoCodeRefresh = {
          ...createDefaultAutoCodeRefresh(),
          ...(data.data?.autoCodeRefresh || config),
        }
        return { ok: true }
      }
      return { ok: false, error: data?.error || '保存失败' }
    }
    catch (e: any) {
      return { ok: false, error: e.response?.data?.error || e.message }
    }
    finally {
      loading.value = false
    }
  }

  async function runAutoCodeRefresh(accountId: string) {
    if (!accountId)
      return { ok: false, error: '未选择账号' }
    try {
      const { data } = await api.post('/api/settings/auto-code-refresh/run', {}, {
        headers: { 'x-account-id': accountId },
      })
      if (data && data.ok)
        return { ok: true }
      return { ok: false, error: data?.error || '刷新失败' }
    }
    catch (e: any) {
      return { ok: false, error: e.response?.data?.error || e.message }
    }
  }

  return {
    settings,
    loading,
    clearSettingsState,
    fetchSettings,
    saveSettings,
    saveOfflineConfig,
    saveAutoCodeRefresh,
    runAutoCodeRefresh,
  }
})
