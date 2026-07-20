<script setup lang="ts">
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'

interface AutomationSettings {
  automation: {
    farm: boolean
    task: boolean
    sell: boolean
    friend: boolean
    farm_push: boolean
    land_upgrade: boolean
    friend_steal: boolean
    friend_help: boolean
    friend_bad: boolean
    friend_golden_bug: boolean
    friend_help_exp_limit: boolean
    friend_turbo_mode: boolean
    golden_bug_clear: boolean
    fertilizer_gift: boolean
    fertilizer_buy_organic: boolean
    fertilizer_buy_normal: boolean
    fertilizer: string
    skip_own_weed_bug: boolean
    fertilizer_multi_season: boolean
    fertilizer_land_types: string[]
    fertilizer_smart_seconds: number
  }
  autoAcceptFriendMinLevel: number
  fertilizerBuyOrganicCount: number
  fertilizerBuyOrganicThresholdHours: number
  fertilizerBuyNormalCount: number
  fertilizerBuyNormalThresholdHours: number
  fertilizerBuyCheckIntervalMinutes: number
  goldenBugKeepCount: number
  goldenBugRoundLimit: number
}

interface AutoCodeRefreshConfig {
  enabled: boolean
  intervalMinutes: number
}

withDefaults(defineProps<{
  currentAccountName: string | null
  currentAccountId: string | number | null | undefined
  loading: boolean
  saving: boolean
  autoCodeRefreshing: boolean
  fertilizerLandTypeOptions: { label: string, value: string }[]
  fertilizerOptions: { label: string, value: string | number }[]
  title?: string
  saveLabel?: string
  showRunAutoCodeRefresh?: boolean
}>(), {
  title: '自动控制',
  saveLabel: '保存自动控制',
  showRunAutoCodeRefresh: true,
})

const emit = defineEmits<{
  save: []
  runAutoCodeRefresh: []
}>()

const settings = defineModel<AutomationSettings>('settings', { required: true })
const autoCodeRefresh = defineModel<AutoCodeRefreshConfig>('autoCodeRefresh', { required: true })

function isFastMatureFertilizerMode(mode: string) {
  return mode === 'smart' || mode === 'smart_only' || mode === 'smart_normal'
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between">
      <h3 class="text-lg text-gray-900 font-bold dark:text-gray-100">
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
      <div class="grid grid-cols-2 gap-3 md:grid-cols-3">
        <BaseSwitch v-model="settings.automation.farm" label="自动种植收获" />
        <BaseSwitch v-model="settings.automation.task" label="自动做任务" />
        <BaseSwitch v-model="settings.automation.sell" label="自动卖果实" />
        <BaseSwitch v-model="settings.automation.friend" label="自动好友互动" />
        <BaseSwitch v-model="settings.automation.farm_push" label="推送触发巡田" />
        <BaseSwitch v-model="settings.automation.land_upgrade" label="自动升级土地" />
        <BaseSwitch v-model="settings.automation.fertilizer_gift" label="自动填充化肥" />
        <BaseSwitch v-model="settings.automation.fertilizer_buy_organic" label="自动购买有机化肥" />
        <BaseSwitch v-model="settings.automation.fertilizer_buy_normal" label="自动购买无机化肥" />
        <BaseSwitch v-model="settings.automation.skip_own_weed_bug" label="不除自己草虫" />
        <BaseSwitch v-model="settings.automation.golden_bug_clear" label="自动清除黄金虫" />
      </div>

      <div class="border border-gray-200 rounded bg-gray-50/70 p-3 dark:border-gray-700 dark:bg-gray-900/20">
        <div class="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div class="min-w-0 space-y-2">
            <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
              <span class="inline-flex items-center gap-1.5 text-sm text-gray-900 font-medium dark:text-gray-100">
                <span class="i-carbon-renew text-base text-gray-500 dark:text-gray-400" />
                自动刷新获取 Code
              </span>
              <BaseSwitch
                v-model="autoCodeRefresh.enabled"
                label="启用"
              />
            </div>
            <p class="text-xs text-gray-500 dark:text-gray-400">
              <span class="text-amber-700 font-semibold dark:text-amber-300">仅微信账号可用。</span>
              到点后自动获取新 Code 并重启当前账号；QQ 账号和缺少 wxid 的手动填码账号会跳过。
            </p>
          </div>

          <div class="flex flex-col gap-2 sm:flex-row sm:items-end">
            <BaseInput
              v-model.number="autoCodeRefresh.intervalMinutes"
              class="sm:w-36"
              label="间隔(分钟)"
              type="number"
              min="1"
              max="1440"
              placeholder="60"
            />
            <BaseButton
              v-if="showRunAutoCodeRefresh"
              variant="secondary"
              size="sm"
              class="h-9 whitespace-nowrap"
              :loading="autoCodeRefreshing"
              :disabled="saving"
              @click="emit('runAutoCodeRefresh')"
            >
              <span class="i-carbon-renew mr-1" />
              立即刷新
            </BaseButton>
          </div>
        </div>
      </div>

      <div v-if="settings.automation.fertilizer_buy_organic || settings.automation.fertilizer_buy_normal" class="rounded bg-green-50 p-3 text-sm space-y-3 dark:bg-green-900/20">
        <div v-if="settings.automation.fertilizer_buy_organic" class="space-y-2">
          <div class="text-green-700 font-medium dark:text-green-400">
            有机化肥设置
          </div>
          <div class="flex flex-wrap gap-4">
            <BaseInput
              v-model.number="settings.fertilizerBuyOrganicCount"
              label="购买数量"
              type="number"
              min="1"
              max="10000"
            />
            <BaseInput
              v-model.number="settings.fertilizerBuyOrganicThresholdHours"
              label="触发阈值 (小时)"
              type="number"
              min="1"
              max="990"
            />
          </div>
        </div>
        <div v-if="settings.automation.fertilizer_buy_normal" class="space-y-2">
          <div class="text-green-700 font-medium dark:text-green-400">
            无机化肥设置
          </div>
          <div class="flex flex-wrap gap-4">
            <BaseInput
              v-model.number="settings.fertilizerBuyNormalCount"
              label="购买数量"
              type="number"
              min="1"
              max="10000"
            />
            <BaseInput
              v-model.number="settings.fertilizerBuyNormalThresholdHours"
              label="触发阈值 (小时)"
              type="number"
              min="1"
              max="990"
            />
          </div>
        </div>
        <div class="flex flex-wrap gap-4">
          <BaseInput
            v-model.number="settings.fertilizerBuyCheckIntervalMinutes"
            label="检测间隔 (分钟)"
            type="number"
            min="1"
            max="1440"
          />
        </div>
        <p class="text-xs text-gray-500 dark:text-gray-400">
          系统会按照设定的检测间隔定时检测化肥容器剩余量，当低于触发阈值时自动购买。保存设置后会立即检测一次。同时开启两种化肥购买时，优先购买有机化肥。
        </p>
      </div>

      <div v-if="settings.automation.friend" class="flex flex-wrap gap-4 rounded bg-blue-50 p-3 text-sm dark:bg-blue-900/20">
        <BaseSwitch v-model="settings.automation.friend_steal" label="自动偷菜" />
        <BaseSwitch v-model="settings.automation.friend_help" label="自动帮忙" />
        <BaseSwitch v-model="settings.automation.friend_bad" label="自动捣乱" />
        <BaseSwitch v-model="settings.automation.friend_golden_bug" label="自动放黄金虫" />
        <BaseSwitch v-model="settings.automation.friend_help_exp_limit" label="经验满只帮护主犬" />
        <BaseSwitch v-model="settings.automation.friend_turbo_mode" label="极速务农（只帮护主犬）" />
      </div>

      <div v-if="settings.automation.friend && settings.automation.friend_golden_bug" class="grid grid-cols-1 gap-3 rounded bg-amber-50 p-3 text-sm md:grid-cols-2 dark:bg-amber-900/20">
        <BaseInput
          v-model.number="settings.goldenBugKeepCount"
          label="黄金虫保留数量"
          type="number"
          min="0"
          max="9999"
        />
        <BaseInput
          v-model.number="settings.goldenBugRoundLimit"
          label="黄金虫单轮上限"
          type="number"
          min="1"
          max="100"
        />
      </div>

      <div v-if="settings.automation.friend" class="rounded bg-sky-50 p-3 text-sm dark:bg-sky-900/20">
        <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
          <BaseInput
            v-model.number="settings.autoAcceptFriendMinLevel"
            label="自动通过好友最低等级"
            type="number"
            min="0"
            max="200"
          />
        </div>
        <p class="mt-2 text-xs text-gray-500 dark:text-gray-400">
          设为 `0` 表示不限制等级；启用好友相关自动化后，系统会按这里的最低等级自动通过好友申请。
        </p>
      </div>

      <div class="space-y-3">
        <div class="border border-amber-200 rounded bg-amber-50/60 p-3 dark:border-amber-800/60 dark:bg-amber-900/10">
          <div class="mb-2 text-sm text-amber-800 font-medium dark:text-amber-300">
            施肥范围
          </div>
          <div class="grid grid-cols-2 gap-2 md:grid-cols-4">
            <label
              v-for="option in fertilizerLandTypeOptions"
              :key="option.value"
              class="flex cursor-pointer items-center gap-1.5 rounded bg-white px-2 py-1 text-xs text-gray-700 dark:bg-gray-800 dark:text-gray-300"
            >
              <input
                v-model="settings.automation.fertilizer_land_types"
                :value="option.value"
                type="checkbox"
                class="h-3.5 w-3.5"
              >
              <span>{{ option.label }}</span>
            </label>
          </div>
          <p class="mt-2 text-xs text-gray-500 dark:text-gray-400">
            施肥前会优先按土地类型过滤，仅对命中范围的地块执行施肥策略。
          </p>
        </div>

        <div class="flex items-center gap-4">
          <BaseSelect
            v-model="settings.automation.fertilizer"
            label="施肥策略"
            :options="fertilizerOptions"
            class="flex-1"
          />
        </div>

        <div class="flex items-center gap-4">
          <BaseSwitch
            v-model="settings.automation.fertilizer_multi_season"
            label="多季补肥"
          />
        </div>

        <div v-if="isFastMatureFertilizerMode(settings.automation.fertilizer)" class="rounded bg-amber-50 p-3 text-sm dark:bg-amber-900/20">
          <div class="mb-2 text-sm text-gray-900 font-medium dark:text-gray-100">
            快成熟判定秒数
          </div>
          <div class="flex flex-wrap items-end gap-4">
            <BaseInput
              v-model.number="settings.automation.fertilizer_smart_seconds"
              label="秒数"
              type="number"
              min="30"
              max="3600"
              class="w-40"
            />
            <span class="pb-2 text-xs text-gray-500 dark:text-gray-400">
              距离成熟时间 ≤ 此秒数时施肥（默认300秒=5分钟）
            </span>
          </div>
        </div>
      </div>

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
