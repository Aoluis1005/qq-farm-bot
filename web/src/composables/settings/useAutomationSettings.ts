import type { Ref } from 'vue'
import { storeToRefs } from 'pinia'
import { ref } from 'vue'
import api from '@/api'
import { useSettingStore } from '@/stores/setting'

type AlertType = 'primary' | 'danger'

const allFertilizerLandTypes = ['purple', 'gold', 'black', 'red', 'normal']

const defaultAutomation = {
  farm: false,
  task: false,
  sell: false,
  friend: false,
  farm_push: false,
  land_upgrade: false,
  friend_steal: false,
  friend_help: false,
  friend_bad: false,
  friend_golden_bug: false,
  friend_help_exp_limit: false,
  friend_turbo_mode: false,
  golden_bug_clear: true,
  fertilizer_gift: false,
  fertilizer_buy_organic: false,
  fertilizer_buy_normal: false,
  fertilizer: 'none',
  skip_own_weed_bug: false,
  fertilizer_multi_season: false,
  fertilizer_land_types: [...allFertilizerLandTypes],
  fertilizer_smart_seconds: 300,
}

export function useAutomationSettings({
  currentAccountId,
  showAlert,
}: {
  currentAccountId: Ref<string | number | null | undefined>
  showAlert: (message: string, type?: AlertType) => void
}) {
  const settingStore = useSettingStore()
  const { settings } = storeToRefs(settingStore)

  const localAutomationSettings = ref({
    automation: {
      ...defaultAutomation,
      fertilizer: 'normal',
    },
    autoAcceptFriendMinLevel: 0,
    fertilizerBuyOrganicCount: 10,
    fertilizerBuyOrganicThresholdHours: 10,
    fertilizerBuyNormalCount: 10,
    fertilizerBuyNormalThresholdHours: 10,
    fertilizerBuyCheckIntervalMinutes: 30,
    goldenBugKeepCount: 0,
    goldenBugRoundLimit: 24,
  })

  const localAutoCodeRefresh = ref({
    enabled: false,
    intervalMinutes: 60,
  })

  const automationSaving = ref(false)
  const autoCodeRefreshing = ref(false)

  const fertilizerLandTypeOptions = [
    { label: '紫土地', value: 'purple' },
    { label: '金土地', value: 'gold' },
    { label: '黑土地', value: 'black' },
    { label: '红土地', value: 'red' },
    { label: '普通土地', value: 'normal' },
  ]

  const fertilizerOptions = [
    { label: '普通 + 有机', value: 'both' },
    { label: '普通 + 快成熟有机', value: 'smart' },
    { label: '快成熟有机', value: 'smart_only' },
    { label: '快成熟普通', value: 'smart_normal' },
    { label: '最终阶段普通肥', value: 'final_normal' },
    { label: '最终阶段有机肥', value: 'final_organic' },
    { label: '仅普通化肥', value: 'normal' },
    { label: '仅有机化肥', value: 'organic' },
    { label: '不施肥', value: 'none' },
  ]

  function normalizeFertilizerLandTypes(input: unknown) {
    const source = Array.isArray(input) ? input : allFertilizerLandTypes
    const normalized: string[] = []
    for (const item of source) {
      const value = String(item || '').trim().toLowerCase()
      if (!allFertilizerLandTypes.includes(value))
        continue
      if (normalized.includes(value))
        continue
      normalized.push(value)
    }
    return normalized
  }

  function syncLocalAutomationSettings() {
    if (settings.value) {
      localAutomationSettings.value.automation = settings.value.automation
        ? {
            ...defaultAutomation,
            ...settings.value.automation,
          }
        : { ...defaultAutomation }

      localAutomationSettings.value.automation.fertilizer_land_types = normalizeFertilizerLandTypes(localAutomationSettings.value.automation.fertilizer_land_types)
      if (localAutomationSettings.value.automation.fertilizer_smart_seconds === undefined) {
        localAutomationSettings.value.automation.fertilizer_smart_seconds = 300
      }
      localAutomationSettings.value.autoAcceptFriendMinLevel = settings.value.autoAcceptFriendMinLevel ?? 0
      localAutomationSettings.value.fertilizerBuyOrganicCount = settings.value.fertilizerBuyOrganicCount ?? 10
      localAutomationSettings.value.fertilizerBuyOrganicThresholdHours = settings.value.fertilizerBuyOrganicThresholdHours ?? 10
      localAutomationSettings.value.fertilizerBuyNormalCount = settings.value.fertilizerBuyNormalCount ?? 10
      localAutomationSettings.value.fertilizerBuyNormalThresholdHours = settings.value.fertilizerBuyNormalThresholdHours ?? 10
      localAutomationSettings.value.fertilizerBuyCheckIntervalMinutes = settings.value.fertilizerBuyCheckIntervalMinutes ?? 30
      localAutomationSettings.value.goldenBugKeepCount = settings.value.goldenBugKeepCount ?? 0
      localAutomationSettings.value.goldenBugRoundLimit = settings.value.goldenBugRoundLimit ?? 24
      localAutoCodeRefresh.value = {
        enabled: settings.value.autoCodeRefresh?.enabled === true,
        intervalMinutes: normalizeAutoCodeRefreshInterval(settings.value.autoCodeRefresh?.intervalMinutes),
      }
    }
  }

  function normalizeAutoCodeRefreshInterval(value: unknown) {
    const minutes = Number(value)
    if (!Number.isFinite(minutes))
      return 60
    return Math.max(1, Math.min(1440, Math.round(minutes)))
  }

  async function saveAutomationSettings() {
    if (!currentAccountId.value)
      return
    const accountId = String(currentAccountId.value)
    automationSaving.value = true
    try {
      localAutoCodeRefresh.value.intervalMinutes = normalizeAutoCodeRefreshInterval(localAutoCodeRefresh.value.intervalMinutes)
      const fullSettings = {
        ...settings.value,
        automation: localAutomationSettings.value.automation,
        autoCodeRefresh: localAutoCodeRefresh.value,
        autoAcceptFriendMinLevel: localAutomationSettings.value.autoAcceptFriendMinLevel,
        fertilizerBuyOrganicCount: localAutomationSettings.value.fertilizerBuyOrganicCount,
        fertilizerBuyOrganicThresholdHours: localAutomationSettings.value.fertilizerBuyOrganicThresholdHours,
        fertilizerBuyNormalCount: localAutomationSettings.value.fertilizerBuyNormalCount,
        fertilizerBuyNormalThresholdHours: localAutomationSettings.value.fertilizerBuyNormalThresholdHours,
        fertilizerBuyCheckIntervalMinutes: localAutomationSettings.value.fertilizerBuyCheckIntervalMinutes,
        goldenBugKeepCount: localAutomationSettings.value.goldenBugKeepCount,
        goldenBugRoundLimit: localAutomationSettings.value.goldenBugRoundLimit,
      }
      const res = await settingStore.saveSettings(accountId, fullSettings)
      if (res.ok) {
        showAlert('自动控制设置已保存', 'primary')

        // 如果启用了自动购买化肥，立即检测并购买
        if (localAutomationSettings.value.automation.fertilizer_buy_organic || localAutomationSettings.value.automation.fertilizer_buy_normal) {
          try {
            const buyRes = await api.post('/api/fertilizer/check-and-buy', {
              buyOrganic: localAutomationSettings.value.automation.fertilizer_buy_organic,
              buyNormal: localAutomationSettings.value.automation.fertilizer_buy_normal,
              organicCount: localAutomationSettings.value.fertilizerBuyOrganicCount,
              organicThresholdHours: localAutomationSettings.value.fertilizerBuyOrganicThresholdHours,
              normalCount: localAutomationSettings.value.fertilizerBuyNormalCount,
              normalThresholdHours: localAutomationSettings.value.fertilizerBuyNormalThresholdHours,
            }, {
              headers: { 'x-account-id': accountId },
            })
            if (buyRes.data?.ok) {
              const totalBought = (buyRes.data.organicBought || 0) + (buyRes.data.normalBought || 0)
              if (totalBought > 0) {
                showAlert(`已自动购买 ${totalBought} 个化肥`, 'primary')
              }
            }
          }
          catch (e) {
            console.error('检测购买化肥失败', e)
          }
        }
      }
      else {
        showAlert(`保存失败: ${res.error}`, 'danger')
      }
    }
    finally {
      automationSaving.value = false
    }
  }

  async function runAutoCodeRefreshNow() {
    if (!currentAccountId.value)
      return
    const accountId = String(currentAccountId.value)
    autoCodeRefreshing.value = true
    try {
      const res = await settingStore.runAutoCodeRefresh(accountId)
      if (res.ok)
        showAlert('已触发刷新 Code，完成后会自动重启账号', 'primary')
      else
        showAlert(`刷新失败: ${res.error}`, 'danger')
    }
    finally {
      autoCodeRefreshing.value = false
    }
  }

  return {
    localAutomationSettings,
    localAutoCodeRefresh,
    automationSaving,
    autoCodeRefreshing,
    fertilizerLandTypeOptions,
    fertilizerOptions,
    syncLocalAutomationSettings,
    saveAutomationSettings,
    runAutoCodeRefreshNow,
  }
}
