<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'
import { useSettingStore } from '@/stores/setting'
import { useToastStore } from '@/stores/toast'

const props = defineProps<{
  accountId: string
}>()

const settingStore = useSettingStore()
const toast = useToastStore()

const CURRENCIES = [
  { id: 1001, name: '金币' },
  { id: 1002, name: '点券' },
  { id: 1003, name: '钻石' },
  { id: 1005, name: '金豆豆' },
]

const enabled = ref(false)
const currencies = ref<number[]>([])
const saving = ref(false)

function syncFromStore() {
  const s = settingStore.settings
  enabled.value = s.automation?.mystery_auto_buy === true
  currencies.value = Array.isArray(s.mysteryAutoBuyCurrencies) ? [...s.mysteryAutoBuyCurrencies] : []
}

async function load() {
  if (!props.accountId)
    return
  await settingStore.fetchSettings(props.accountId)
  syncFromStore()
}

onMounted(load)
watch(() => props.accountId, load)

function isChecked(id: number) {
  return currencies.value.includes(id)
}

async function persist() {
  if (!props.accountId)
    return
  saving.value = true
  try {
    const fullSettings = {
      ...settingStore.settings,
      automation: {
        ...settingStore.settings.automation,
        mystery_auto_buy: enabled.value,
      },
      mysteryAutoBuyCurrencies: [...currencies.value],
    }
    const res = await settingStore.saveSettings(props.accountId, fullSettings)
    if (res.ok) {
      toast.success('神秘商人自动购买设置已保存')
    }
    else {
      toast.error(res.error || '保存失败')
      syncFromStore()
    }
  }
  catch (e: any) {
    toast.error(e?.message || '保存失败')
    syncFromStore()
  }
  finally {
    saving.value = false
  }
}

function onToggle(value: boolean | undefined) {
  enabled.value = value ?? false
  persist()
}

function onCurrencyToggle(id: number, checked: boolean) {
  if (checked) {
    if (!currencies.value.includes(id))
      currencies.value.push(id)
  }
  else {
    currencies.value = currencies.value.filter(c => c !== id)
  }
  persist()
}
</script>

<template>
  <article class="border border-purple-200 rounded-xl bg-white p-4 shadow-sm dark:border-purple-800 dark:bg-gray-800">
    <header class="flex items-center justify-between gap-3">
      <div class="flex items-center gap-2">
        <span class="text-base text-purple-600 font-bold dark:text-purple-300">自动购买</span>
        <span class="text-xs text-gray-400">神秘商人出现时按规则自动下单</span>
      </div>
      <BaseSwitch :model-value="enabled" @update:model-value="onToggle" />
    </header>

    <div class="mt-4 space-y-4" :class="{ 'opacity-50 pointer-events-none': !enabled }">
      <div>
        <div class="mb-2 text-sm text-gray-600 font-medium dark:text-gray-300">
          允许使用的货币
        </div>
        <div class="flex flex-wrap gap-2">
          <label
            v-for="c in CURRENCIES"
            :key="c.id"
            class="inline-flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors"
            :class="isChecked(c.id)
              ? 'border-purple-400 bg-purple-50 text-purple-700 dark:border-purple-600 dark:bg-purple-900/30 dark:text-purple-200'
              : 'border-gray-200 bg-gray-50 text-gray-600 dark:border-gray-700 dark:bg-gray-700/40 dark:text-gray-300'"
          >
            <input
              type="checkbox"
              class="h-4 w-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500"
              :checked="isChecked(c.id)"
              @change="onCurrencyToggle(c.id, ($event.target as HTMLInputElement).checked)"
            >
            <span>{{ c.name }}</span>
            <span class="text-xs text-gray-400">{{ c.id }}</span>
          </label>
        </div>
      </div>

      <p class="text-xs text-gray-400">
        开启后，每当出现神秘商人且货币类型命中上方勾选项时，会自动买下整个商品（一次买光）。
      </p>
    </div>

    <div v-if="saving" class="mt-3 text-xs text-purple-500">
      正在保存…
    </div>
  </article>
</template>
