<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import api from '@/api'
import ConfirmModal from '@/components/ConfirmModal.vue'
import AutomationSettingsTab from '@/components/settings/AutomationSettingsTab.vue'
import StrategySettingsTab from '@/components/settings/StrategySettingsTab.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'

interface BagSeedItem {
  seedId: number
  name: string
  count: number
  requiredLevel: number
  plantSize: number
}

const props = defineProps<{
  currentAccountId: string | number | null | undefined
  currentAccountName: string | null
  plantingStrategyOptions: { label: string, value: string }[]
  preferredSeedOptions: { label: string, value: number }[]
  bagFallbackStrategyOptions: { label: string, value: string }[]
  bagSeeds: BagSeedItem[]
  bagSeedsLoading: boolean
  bagSeedsError: string | null
  fertilizerLandTypeOptions: { label: string, value: string }[]
  fertilizerOptions: { label: string, value: string | number }[]
}>()

const emit = defineEmits<{
  notify: [message: string, type?: 'primary' | 'danger']
}>()

const activeSection = ref<'strategy' | 'automation'>('strategy')
const loading = ref(false)
const saving = ref(false)
const importing = ref(false)
const resetting = ref(false)
const showResetConfirm = ref(false)
const exists = ref(false)
const enabled = ref(true)
const updatedAt = ref(0)
let draggedSeedId: number | null = null

const strategySettings = ref(createStrategySettings())
const automationSettings = ref(createAutomationSettings())
const autoCodeRefresh = ref({ enabled: false, intervalMinutes: 60 })

function createStrategySettings() {
  return {
    plantingStrategy: 'max_exp',
    preferredSeedId: 0,
    prioritize2x2Crops: false,
    bagSeedPriority: [] as number[],
    bagSeedFallbackStrategy: 'level',
    bagPriorityLandTypes: ['purple', 'gold', 'black', 'red', 'normal'] as string[],
    stealDelaySeconds: 1,
    plantOrderRandom: true,
    plantDelaySeconds: 2,
    intervals: { farmMin: 2, farmMax: 5, helpMin: 30, helpMax: 35, stealMin: 25, stealMax: 30 },
    friendQuietHours: { enabled: false, start: '23:00', end: '07:00' },
  }
}

function createAutomationSettings() {
  return {
    automation: {
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
      fertilizer_land_types: ['purple', 'gold', 'black', 'red', 'normal'],
      fertilizer_smart_seconds: 300,
    },
    autoAcceptFriendMinLevel: 0,
    fertilizerBuyOrganicCount: 1,
    fertilizerBuyOrganicThresholdHours: 10,
    fertilizerBuyNormalCount: 1,
    fertilizerBuyNormalThresholdHours: 10,
    fertilizerBuyCheckIntervalMinutes: 60,
    goldenBugKeepCount: 0,
    goldenBugRoundLimit: 24,
  }
}

function applyPlan(data: any) {
  const config = data?.config || {}
  exists.value = data?.exists === true
  enabled.value = data?.enabled !== false
  updatedAt.value = Number(data?.updatedAt) || 0
  strategySettings.value = {
    ...createStrategySettings(),
    ...config,
    intervals: { ...createStrategySettings().intervals, ...(config.intervals || {}) },
    friendQuietHours: { ...createStrategySettings().friendQuietHours, ...(config.friendQuietHours || {}) },
    bagSeedPriority: Array.isArray(config.bagSeedPriority) ? [...config.bagSeedPriority] : [],
    bagPriorityLandTypes: (Array.isArray(config.bagPriorityLandTypes) && config.bagPriorityLandTypes.length > 0)
      ? [...config.bagPriorityLandTypes]
      : ['purple', 'gold', 'black', 'red', 'normal'],
  }
  const automationDefaults = createAutomationSettings()
  automationSettings.value = {
    ...automationDefaults,
    ...config,
    automation: { ...automationDefaults.automation, ...(config.automation || {}) },
  }
  autoCodeRefresh.value = {
    enabled: config.autoCodeRefresh?.enabled === true,
    intervalMinutes: Number(config.autoCodeRefresh?.intervalMinutes) || 60,
  }
}

const sortedBagSeeds = computed(() => {
  const byId = new Map(props.bagSeeds.map(seed => [seed.seedId, seed]))
  return strategySettings.value.bagSeedPriority
    .map(id => byId.get(id))
    .filter((seed): seed is BagSeedItem => !!seed)
})

const strategyPreviewLabel = computed(() => {
  const option = props.plantingStrategyOptions.find(item => item.value === strategySettings.value.plantingStrategy)
  return option?.label || '默认策略'
})

const updatedAtLabel = computed(() => {
  if (!updatedAt.value)
    return '尚未保存'
  return new Date(updatedAt.value).toLocaleString('zh-CN', { hour12: false })
})

function buildConfig() {
  return {
    ...strategySettings.value,
    ...automationSettings.value,
    autoCodeRefresh: autoCodeRefresh.value,
  }
}

async function fetchPlan() {
  loading.value = true
  try {
    const { data } = await api.get('/api/settings/default-plan')
    if (data?.ok)
      applyPlan(data.data)
  }
  catch (error: any) {
    emit('notify', error.response?.data?.error || '默认方案加载失败', 'danger')
  }
  finally {
    loading.value = false
  }
}

async function savePlan() {
  saving.value = true
  try {
    const { data } = await api.put('/api/settings/default-plan', {
      enabled: enabled.value,
      config: buildConfig(),
    })
    if (!data?.ok)
      throw new Error(data?.error || '保存失败')
    applyPlan(data.data)
    emit('notify', '默认方案已保存')
  }
  catch (error: any) {
    emit('notify', error.response?.data?.error || error.message || '默认方案保存失败', 'danger')
  }
  finally {
    saving.value = false
  }
}

async function importCurrentAccount() {
  if (!props.currentAccountId)
    return
  importing.value = true
  try {
    const { data } = await api.post('/api/settings/default-plan/import', {}, {
      headers: { 'x-account-id': String(props.currentAccountId) },
    })
    if (!data?.ok)
      throw new Error(data?.error || '导入失败')
    applyPlan(data.data)
    emit('notify', `已从 ${props.currentAccountName || '当前账号'} 导入默认方案`)
  }
  catch (error: any) {
    emit('notify', error.response?.data?.error || error.message || '导入默认方案失败', 'danger')
  }
  finally {
    importing.value = false
  }
}

async function resetPlan() {
  resetting.value = true
  try {
    const { data } = await api.post('/api/settings/default-plan/reset')
    if (!data?.ok)
      throw new Error(data?.error || '恢复失败')
    applyPlan(data.data)
    showResetConfirm.value = false
    emit('notify', '默认方案已恢复为系统默认')
  }
  catch (error: any) {
    emit('notify', error.response?.data?.error || error.message || '恢复系统默认失败', 'danger')
  }
  finally {
    resetting.value = false
  }
}

function resetBagSeedPriority() {
  strategySettings.value.bagSeedPriority = props.bagSeeds.map(seed => seed.seedId)
}

function moveBagSeed(seedId: number, direction: -1 | 1) {
  const list = strategySettings.value.bagSeedPriority
  const index = list.indexOf(seedId)
  const target = index + direction
  if (index < 0 || target < 0 || target >= list.length) {
    return
  }
  const current = list[index]!
  list[index] = list[target]!
  list[target] = current
}

function removeBagSeedPriority(seedId: number) {
  strategySettings.value.bagSeedPriority = strategySettings.value.bagSeedPriority.filter(id => id !== seedId)
}

function startBagSeedDrag(seedId: number) {
  draggedSeedId = seedId
}

function dropBagSeed(seedId: number) {
  if (!draggedSeedId || draggedSeedId === seedId)
    return
  const list = strategySettings.value.bagSeedPriority
  const from = list.indexOf(draggedSeedId)
  const to = list.indexOf(seedId)
  if (from < 0 || to < 0)
    return
  const [moved] = list.splice(from, 1)
  if (moved !== undefined)
    list.splice(to, 0, moved)
  draggedSeedId = null
}

onMounted(fetchPlan)
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-col gap-3 border-b border-gray-200 pb-4 lg:flex-row lg:items-center lg:justify-between dark:border-gray-700">
      <div class="min-w-0">
        <div class="flex flex-wrap items-center gap-3">
          <h3 class="flex items-center gap-2 text-lg text-gray-900 font-bold dark:text-gray-100">
            <span class="i-carbon-settings-adjust" />
            默认方案
          </h3>
          <BaseSwitch v-model="enabled" label="新账号自动应用" />
        </div>
        <div class="mt-1 text-xs text-gray-500 dark:text-gray-400">
          {{ exists ? `最后保存：${updatedAtLabel}` : '尚未保存默认方案' }}
        </div>
      </div>

      <div class="flex flex-wrap gap-2">
        <BaseButton
          variant="outline"
          size="sm"
          :loading="importing"
          :disabled="!currentAccountId || loading"
          :title="currentAccountId ? `从 ${currentAccountName || '当前账号'} 导入` : '请先选择账号'"
          @click="importCurrentAccount"
        >
          <span class="i-carbon-document-import mr-1.5" />
          从当前账号导入
        </BaseButton>
        <BaseButton variant="ghost" size="sm" :disabled="loading" @click="showResetConfirm = true">
          <span class="i-carbon-reset mr-1.5" />
          恢复系统默认
        </BaseButton>
      </div>
    </div>

    <div class="inline-flex border border-gray-200 rounded-lg bg-gray-50 p-1 dark:border-gray-700 dark:bg-gray-900/30">
      <button
        data-testid="default-plan-strategy-section"
        class="flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors"
        :class="activeSection === 'strategy' ? 'text-white' : 'text-gray-600 dark:text-gray-300'"
        :style="activeSection === 'strategy' ? { background: 'var(--theme-primary)' } : {}"
        @click="activeSection = 'strategy'"
      >
        <span class="i-fas-cogs" />
        策略设置
      </button>
      <button
        data-testid="default-plan-automation-section"
        class="flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors"
        :class="activeSection === 'automation' ? 'text-white' : 'text-gray-600 dark:text-gray-300'"
        :style="activeSection === 'automation' ? { background: 'var(--theme-primary)' } : {}"
        @click="activeSection = 'automation'"
      >
        <span class="i-carbon-toggle-on" />
        自动控制
      </button>
    </div>

    <div v-if="loading" class="py-10 text-center text-gray-500">
      <span class="i-svg-spinners-ring-resize mb-2 inline-block text-2xl" />
      <div>加载中...</div>
    </div>

    <StrategySettingsTab
      v-else-if="activeSection === 'strategy'"
      v-model:settings="strategySettings"
      current-account-id="default-plan"
      :current-account-name="null"
      :loading="false"
      :saving="saving"
      title="默认策略"
      save-label="保存默认方案"
      :planting-strategy-options="plantingStrategyOptions"
      :preferred-seed-options="preferredSeedOptions"
      :bag-fallback-strategy-options="bagFallbackStrategyOptions"
      :strategy-preview-label="strategyPreviewLabel"
      :bag-seeds="bagSeeds"
      :sorted-bag-seeds="sortedBagSeeds"
      :bag-seeds-loading="bagSeedsLoading"
      :bag-seeds-error="bagSeedsError"
      @reset-bag-seed-priority="resetBagSeedPriority"
      @move-bag-seed="moveBagSeed"
      @remove-bag-seed="removeBagSeedPriority"
      @start-bag-seed-drag="startBagSeedDrag"
      @drag-over-bag-seed="() => {}"
      @drop-bag-seed="dropBagSeed"
      @save="savePlan"
    />

    <AutomationSettingsTab
      v-else
      v-model:settings="automationSettings"
      v-model:auto-code-refresh="autoCodeRefresh"
      current-account-id="default-plan"
      :current-account-name="null"
      :loading="false"
      :saving="saving"
      :auto-code-refreshing="false"
      :show-run-auto-code-refresh="false"
      title="默认自动控制"
      save-label="保存默认方案"
      :fertilizer-land-type-options="fertilizerLandTypeOptions"
      :fertilizer-options="fertilizerOptions"
      @save="savePlan"
    />

    <ConfirmModal
      :show="showResetConfirm"
      :loading="resetting"
      title="恢复系统默认"
      message="确定要用系统默认设置覆盖当前默认方案吗？"
      confirm-text="确认恢复"
      @close="!resetting && (showResetConfirm = false)"
      @cancel="!resetting && (showResetConfirm = false)"
      @confirm="resetPlan"
    />
  </div>
</template>
