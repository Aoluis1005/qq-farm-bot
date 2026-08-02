import type { Ref } from 'vue'
import { storeToRefs } from 'pinia'
import { computed, ref, watchEffect } from 'vue'
import api from '@/api'
import { useFarmStore } from '@/stores/farm'
import { useSettingStore } from '@/stores/setting'

interface BagSeedItem {
  seedId: number
  name: string
  count: number
  requiredLevel: number
  plantSize: number
}

interface AutomationSettingsSnapshot {
  automation: Record<string, unknown>
}

type AlertType = 'primary' | 'danger'

const analyticsSortByMap: Record<string, string> = {
  max_exp: 'exp',
  max_fert_exp: 'fert',
  max_profit: 'profit',
  max_fert_profit: 'fert_profit',
}

export function useStrategySettings({
  currentAccountId,
  getAutomationSettings,
  showAlert,
}: {
  currentAccountId: Ref<string | number | null | undefined>
  getAutomationSettings: () => AutomationSettingsSnapshot
  showAlert: (message: string, type?: AlertType) => void
}) {
  const settingStore = useSettingStore()
  const farmStore = useFarmStore()
  const { settings, loading: settingsLoading } = storeToRefs(settingStore)
  const { seeds } = storeToRefs(farmStore)

  const strategySaving = ref(false)

  const localStrategySettings = ref({
    plantingStrategy: 'max_exp',
    preferredSeedId: 0,
    prioritize2x2Crops: false,
    bagSeedPriority: [] as number[],
    bagSeedFallbackStrategy: 'level',
    bagPriorityLandTypes: ['purple', 'gold', 'black', 'red', 'normal'] as string[],
    stealDelaySeconds: 0,
    plantOrderRandom: false,
    plantDelaySeconds: 0,
    intervals: { farmMin: 2, farmMax: 5, helpMin: 10, helpMax: 15, stealMin: 10, stealMax: 15 },
    friendQuietHours: { enabled: false, start: '23:00', end: '07:00' },
  })

  const plantingStrategyOptions = [
    { label: '优先种植种子', value: 'preferred' },
    { label: '最高等级作物', value: 'level' },
    { label: '最大经验/时', value: 'max_exp' },
    { label: '最大普通肥经验/时', value: 'max_fert_exp' },
    { label: '最大净利润/时', value: 'max_profit' },
    { label: '最大普通肥净利润/时', value: 'max_fert_profit' },
    { label: '背包种子优先', value: 'bag_priority' },
  ]

  const bagFallbackStrategyOptions = [
    { label: '最高等级作物', value: 'level' },
    { label: '最大经验/时', value: 'max_exp' },
    { label: '最大普通肥经验/时', value: 'max_fert_exp' },
    { label: '最大净利润/时', value: 'max_profit' },
    { label: '最大普通肥净利润/时', value: 'max_fert_profit' },
    { label: '优先种植种子', value: 'preferred' },
  ]

  const bagSeeds = ref<BagSeedItem[]>([])
  const bagSeedsLoading = ref(false)
  const bagSeedsError = ref<string | null>(null)
  const draggingBagSeedId = ref<number | null>(null)
  let bagSeedsRequestId = 0
  let strategyPreviewRequestId = 0

  const sortedBagSeeds = computed(() => {
    const priority = localStrategySettings.value.bagSeedPriority || []
    const seedMap = new Map(bagSeeds.value.map(seed => [Number(seed.seedId), seed]))
    const orderedSeeds: BagSeedItem[] = []
    const seen = new Set<number>()

    for (const rawSeedId of priority) {
      const seedId = Number(rawSeedId)
      if (!seedId || seen.has(seedId))
        continue
      const seed = seedMap.get(seedId)
      if (!seed)
        continue
      seen.add(seedId)
      orderedSeeds.push(seed)
    }

    return orderedSeeds
  })

  async function fetchBagSeeds() {
    const accountId = currentAccountId.value
    if (!accountId)
      return
    const requestedId = String(accountId)
    const requestId = ++bagSeedsRequestId
    bagSeedsLoading.value = true
    bagSeedsError.value = null
    try {
      const res = await api.get('/api/bag/seeds', {
        headers: { 'x-account-id': accountId },
      })
      if (requestId !== bagSeedsRequestId || String(currentAccountId.value || '') !== requestedId)
        return
      if (res.data.ok) {
        bagSeeds.value = res.data.data || []
        if (!localStrategySettings.value.bagSeedPriority || localStrategySettings.value.bagSeedPriority.length === 0)
          localStrategySettings.value.bagSeedPriority = bagSeeds.value.map(seed => Number(seed.seedId)).filter(seedId => seedId > 0)
      }
    }
    catch (e: any) {
      if (requestId === bagSeedsRequestId && String(currentAccountId.value || '') === requestedId)
        bagSeedsError.value = e.message || '加载失败'
    }
    finally {
      if (requestId === bagSeedsRequestId)
        bagSeedsLoading.value = false
    }
  }

  function resetBagSeedPriority() {
    localStrategySettings.value.bagSeedPriority = bagSeeds.value.map(seed => Number(seed.seedId)).filter(seedId => seedId > 0)
  }

  function getCurrentBagSeedOrder() {
    return sortedBagSeeds.value.map(seed => Number(seed.seedId)).filter(seedId => seedId > 0)
  }

  function moveBagSeed(seedId: number, direction: -1 | 1) {
    const nextOrder = getCurrentBagSeedOrder()
    const index = nextOrder.indexOf(seedId)
    const targetIndex = index + direction
    if (index < 0 || targetIndex < 0 || targetIndex >= nextOrder.length)
      return

    const temp = nextOrder[index]!
    nextOrder[index] = nextOrder[targetIndex]!
    nextOrder[targetIndex] = temp
    localStrategySettings.value.bagSeedPriority = nextOrder
  }

  function removeBagSeedPriority(seedId: number) {
    localStrategySettings.value.bagSeedPriority = getCurrentBagSeedOrder()
      .filter(itemSeedId => itemSeedId !== Number(seedId))
  }

  function startBagSeedDrag(seedId: number, event: DragEvent) {
    draggingBagSeedId.value = seedId
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData('text/plain', String(seedId))
    }
  }

  function dragOverBagSeed(_seedId: number, event: DragEvent) {
    if (draggingBagSeedId.value === null)
      return
    event.preventDefault()
    if (event.dataTransfer)
      event.dataTransfer.dropEffect = 'move'
  }

  function dropBagSeed(seedId: number, event: DragEvent) {
    event.preventDefault()
    const sourceSeedId = draggingBagSeedId.value ?? Number(event.dataTransfer?.getData('text/plain') || '')
    if (!sourceSeedId || sourceSeedId === seedId) {
      draggingBagSeedId.value = null
      return
    }

    const nextOrder = getCurrentBagSeedOrder()
    const sourceIndex = nextOrder.indexOf(sourceSeedId)
    const targetIndex = nextOrder.indexOf(seedId)

    if (sourceIndex < 0 || targetIndex < 0) {
      draggingBagSeedId.value = null
      return
    }

    const [moved] = nextOrder.splice(sourceIndex, 1)
    const newTargetIndex = sourceIndex < targetIndex ? targetIndex - 1 : targetIndex
    nextOrder.splice(newTargetIndex, 0, moved!)

    localStrategySettings.value.bagSeedPriority = nextOrder
    draggingBagSeedId.value = null
  }

  watchEffect(() => {
    if (localStrategySettings.value.plantingStrategy === 'bag_priority' && currentAccountId.value) {
      fetchBagSeeds()
    }
  })

  const preferredSeedOptions = computed(() => {
    const options: { label: string, value: number, disabled?: boolean }[] = [{ label: '自动选择', value: 0, disabled: false }]
    if (seeds.value) {
      options.push(...seeds.value.map(seed => ({
        label: `${seed.requiredLevel}级 ${seed.name} (${seed.price}金)`,
        value: seed.seedId,
        disabled: seed.locked || seed.soldOut,
      })))
    }
    return options
  })

  const strategyPreviewLabel = ref<string | null>(null)

  watchEffect(async () => {
    const requestId = ++strategyPreviewRequestId
    let strategy = localStrategySettings.value.plantingStrategy
    if (strategy === 'preferred') {
      strategyPreviewLabel.value = null
      return
    }
    if (strategy === 'bag_priority') {
      strategy = localStrategySettings.value.bagSeedFallbackStrategy || 'level'
      if (strategy === 'preferred') {
        const preferredId = localStrategySettings.value.preferredSeedId
        if (preferredId > 0 && seeds.value) {
          const seed = seeds.value.find(s => s.seedId === preferredId)
          strategyPreviewLabel.value = seed ? `${seed.requiredLevel}级 ${seed.name}` : '未选择优先种子'
        }
        else {
          strategyPreviewLabel.value = '未选择优先种子'
        }
        return
      }
    }
    if (!seeds.value || seeds.value.length === 0) {
      strategyPreviewLabel.value = null
      return
    }
    const available = seeds.value.filter(s => !s.locked && !s.soldOut)
    if (available.length === 0) {
      strategyPreviewLabel.value = '暂无可用种子'
      return
    }
    if (strategy === 'level') {
      const best = [...available].sort((a, b) => b.requiredLevel - a.requiredLevel)[0]
      strategyPreviewLabel.value = best ? `${best.requiredLevel}级 ${best.name}` : null
      return
    }
    const sortBy = analyticsSortByMap[strategy]
    if (sortBy) {
      try {
        const accountId = currentAccountId.value
        if (!accountId) {
          strategyPreviewLabel.value = null
          return
        }
        const requestedId = String(accountId)
        const res = await api.get(`/api/analytics?sort=${sortBy}`, {
          headers: { 'x-account-id': accountId },
        })
        if (requestId !== strategyPreviewRequestId || String(currentAccountId.value || '') !== requestedId)
          return
        const rankings: any[] = res.data.ok ? (res.data.data || []) : []
        const availableIds = new Set(available.map(s => s.seedId))
        const match = rankings.find(r => availableIds.has(Number(r.seedId)))
        if (match) {
          const seed = available.find(s => s.seedId === Number(match.seedId))
          strategyPreviewLabel.value = seed ? `${seed.requiredLevel}级 ${seed.name}` : null
        }
        else {
          strategyPreviewLabel.value = '暂无匹配种子'
        }
      }
      catch {
        if (requestId === strategyPreviewRequestId)
          strategyPreviewLabel.value = null
      }
    }
  })

  function syncLocalStrategySettings() {
    if (settings.value) {
      localStrategySettings.value = JSON.parse(JSON.stringify({
        plantingStrategy: settings.value.plantingStrategy,
        preferredSeedId: settings.value.preferredSeedId,
        prioritize2x2Crops: settings.value.prioritize2x2Crops === true,
        bagSeedPriority: settings.value.bagSeedPriority ?? [],
        bagSeedFallbackStrategy: settings.value.bagSeedFallbackStrategy ?? 'level',
        bagPriorityLandTypes: (settings.value.bagPriorityLandTypes && settings.value.bagPriorityLandTypes.length > 0)
          ? settings.value.bagPriorityLandTypes
          : ['purple', 'gold', 'black', 'red', 'normal'],
        stealDelaySeconds: settings.value.stealDelaySeconds ?? 0,
        plantOrderRandom: !!settings.value.plantOrderRandom,
        plantDelaySeconds: settings.value.plantDelaySeconds ?? 0,
        intervals: settings.value.intervals,
        friendQuietHours: settings.value.friendQuietHours,
      }))
    }
  }

  async function loadStrategyData() {
    if (currentAccountId.value) {
      const accountId = String(currentAccountId.value)
      await settingStore.fetchSettings(accountId)
      syncLocalStrategySettings()
      await farmStore.fetchSeeds(accountId)
    }
  }

  async function saveStrategySettings() {
    if (!currentAccountId.value)
      return
    strategySaving.value = true
    try {
      const fullSettings = {
        ...settings.value,
        ...localStrategySettings.value,
        automation: getAutomationSettings().automation,
      }
      const res = await settingStore.saveSettings(String(currentAccountId.value), fullSettings)
      if (res.ok) {
        showAlert('策略设置已保存', 'primary')
      }
      else {
        showAlert(`保存失败: ${res.error}`, 'danger')
      }
    }
    finally {
      strategySaving.value = false
    }
  }

  function resetStrategyState() {
    bagSeeds.value = []
    bagSeedsError.value = null
    bagSeedsLoading.value = false
    draggingBagSeedId.value = null
    strategyPreviewLabel.value = null
  }

  return {
    settings,
    settingsLoading,
    strategySaving,
    localStrategySettings,
    plantingStrategyOptions,
    bagFallbackStrategyOptions,
    bagSeeds,
    bagSeedsLoading,
    bagSeedsError,
    sortedBagSeeds,
    preferredSeedOptions,
    strategyPreviewLabel,
    resetBagSeedPriority,
    moveBagSeed,
    removeBagSeedPriority,
    startBagSeedDrag,
    dragOverBagSeed,
    dropBagSeed,
    syncLocalStrategySettings,
    loadStrategyData,
    saveStrategySettings,
    resetStrategyState,
    fetchBagSeeds,
  }
}
