<script setup lang="ts">
import BagSeedPriorityPanel from '@/components/settings/BagSeedPriorityPanel.vue'
import StrategyTimingPanel from '@/components/settings/StrategyTimingPanel.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'

interface SelectOption<T = string | number> {
  label: string
  value: T
  disabled?: boolean
}

interface BagSeedItem {
  seedId: number
  name: string
  count: number
  requiredLevel: number
  plantSize: number
}

interface StrategySettings {
  plantingStrategy: string
  preferredSeedId: number
  prioritize2x2Crops: boolean
  bagSeedPriority: number[]
  bagSeedFallbackStrategy: string
  bagPriorityLandTypes: string[]
  stealDelaySeconds: number
  plantOrderRandom: boolean
  plantDelaySeconds: number
  intervals: {
    farmMin: number
    farmMax: number
    helpMin: number
    helpMax: number
    stealMin: number
    stealMax: number
  }
  friendQuietHours: {
    enabled: boolean
    start: string
    end: string
  }
}

withDefaults(defineProps<{
  currentAccountName: string | null
  currentAccountId: string | number | null | undefined
  loading: boolean
  saving: boolean
  plantingStrategyOptions: SelectOption[]
  preferredSeedOptions: SelectOption<number>[]
  bagFallbackStrategyOptions: SelectOption[]
  strategyPreviewLabel: string | null
  bagSeeds: BagSeedItem[]
  sortedBagSeeds: BagSeedItem[]
  bagSeedsLoading: boolean
  bagSeedsError: string | null
  title?: string
  saveLabel?: string
}>(), {
  title: '策略设置',
  saveLabel: '保存策略设置',
})

const emit = defineEmits<{
  resetBagSeedPriority: []
  moveBagSeed: [seedId: number, direction: -1 | 1]
  removeBagSeed: [seedId: number]
  startBagSeedDrag: [seedId: number, event: DragEvent]
  dragOverBagSeed: [seedId: number, event: DragEvent]
  dropBagSeed: [seedId: number, event: DragEvent]
  save: []
}>()

const settings = defineModel<StrategySettings>('settings', { required: true })

const bagPriorityLandTypeOptions = [
  { label: '紫土地', value: 'purple' },
  { label: '金土地', value: 'gold' },
  { label: '黑土地', value: 'black' },
  { label: '红土地', value: 'red' },
  { label: '普通地', value: 'normal' },
]
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between">
      <h3 class="flex items-center gap-2 text-lg text-gray-900 font-bold dark:text-gray-100 max-sm:text-base">
        <div class="i-fas-cog text-lg" />
        {{ title }}
        <span v-if="currentAccountName" class="ml-2 text-sm text-gray-500 font-normal dark:text-gray-400">
          ({{ currentAccountName }})
        </span>
      </h3>
    </div>

    <div v-if="loading" class="py-4 text-center text-gray-500">
      <div class="i-svg-spinners-ring-resize mx-auto mb-2 text-2xl" />
      <p>加载中...</p>
    </div>

    <div v-else-if="!currentAccountId" class="py-8 text-center text-gray-500">
      <div class="i-carbon-settings-adjust mx-auto mb-2 text-3xl text-gray-400" />
      <p>请先选择账号</p>
    </div>

    <div v-else class="space-y-4">
      <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
        <BaseSelect
          v-model="settings.plantingStrategy"
          label="种植策略"
          :options="plantingStrategyOptions"
        />
        <BaseSelect
          v-if="settings.plantingStrategy === 'preferred'"
          v-model="settings.preferredSeedId"
          label="优先种植种子"
          :options="preferredSeedOptions"
        />
        <BaseSelect
          v-else-if="settings.plantingStrategy === 'bag_priority' && settings.bagSeedFallbackStrategy === 'preferred'"
          v-model="settings.preferredSeedId"
          label="优先种植种子"
          :options="preferredSeedOptions"
        />
        <div v-else class="flex flex-col gap-1.5">
          <label class="text-sm text-gray-700 font-medium dark:text-gray-300">
            {{ settings.plantingStrategy === 'bag_priority' ? '第二优先策略预览' : '策略选种预览' }}
          </label>
          <div
            class="w-full flex items-center justify-between border border-gray-200 rounded-lg bg-gray-50 px-3 py-2 text-gray-500 dark:border-gray-600 dark:bg-gray-800/50 dark:text-gray-400"
          >
            <span class="truncate">{{ strategyPreviewLabel ?? '加载中...' }}</span>
            <div class="i-carbon-chevron-down shrink-0 text-lg text-gray-400" />
          </div>
        </div>
      </div>

      <div class="border border-emerald-200 rounded-lg bg-emerald-50/70 p-3 dark:border-emerald-800/50 dark:bg-emerald-900/20">
        <BaseSwitch
          v-model="settings.prioritize2x2Crops"
          label="优先种植 2×2 作物"
        />
        <p class="mt-2 text-xs text-emerald-700/90 leading-5 dark:text-emerald-300/90">
          开启后会根据背包中的四格种子预留完整 2×2 区域；预留区收获后暂不补种普通作物，四块全部空闲时自动种植。四格种子不会从商城购买。
        </p>
      </div>

      <div v-if="settings.plantingStrategy === 'bag_priority'" class="space-y-3">
        <BaseSelect
          v-model="settings.bagSeedFallbackStrategy"
          label="第二优先策略"
          :options="bagFallbackStrategyOptions"
        />

        <div class="border border-violet-200 rounded-lg bg-violet-50/70 p-3 dark:border-violet-800/50 dark:bg-violet-900/20">
          <div class="mb-2 text-sm text-violet-800 font-medium dark:text-violet-300">
            背包种子优先地块
          </div>
          <div class="grid grid-cols-2 gap-2 md:grid-cols-5">
            <label
              v-for="option in bagPriorityLandTypeOptions"
              :key="option.value"
              class="flex cursor-pointer items-center gap-1.5 rounded bg-white px-2 py-1 text-xs text-gray-700 dark:bg-gray-800 dark:text-gray-300"
            >
              <input
                v-model="settings.bagPriorityLandTypes"
                :value="option.value"
                type="checkbox"
                class="h-3.5 w-3.5"
              >
              <span>{{ option.label }}</span>
            </label>
          </div>
          <p class="mt-2 text-xs text-violet-700/90 leading-5 dark:text-violet-300/90">
            仅在勾选的品质地块上按背包种子优先级种植；未勾选地块、以及背包种子用完后剩余的空地，都会按上方"第二优先策略"种植。默认全选表示不限制。
          </p>
        </div>

        <BagSeedPriorityPanel
          :seeds="bagSeeds"
          :sorted-seeds="sortedBagSeeds"
          :loading="bagSeedsLoading"
          :error="bagSeedsError"
          @reset="emit('resetBagSeedPriority')"
          @move="(seedId, direction) => emit('moveBagSeed', seedId, direction)"
          @remove="seedId => emit('removeBagSeed', seedId)"
          @drag-start="(seedId, event) => emit('startBagSeedDrag', seedId, event)"
          @drag-over="(seedId, event) => emit('dragOverBagSeed', seedId, event)"
          @drop="(seedId, event) => emit('dropBagSeed', seedId, event)"
        />
      </div>

      <StrategyTimingPanel v-model:settings="settings" />

      <div class="flex justify-end gap-2 border-t pt-3 dark:border-gray-700">
        <BaseButton
          variant="primary"
          size="sm"
          :loading="saving"
          @click="emit('save')"
        >
          {{ saveLabel }}
        </BaseButton>
      </div>
    </div>
  </div>
</template>
