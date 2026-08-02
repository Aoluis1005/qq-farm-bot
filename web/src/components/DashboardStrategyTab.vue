<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { onMounted } from 'vue'
import { useAccountStore } from '@/stores/account'
import { useSettingStore } from '@/stores/setting'

const accountStore = useAccountStore()
const settingStore = useSettingStore()
const { currentAccountId } = storeToRefs(accountStore)
const { settings, loading: settingsLoading } = storeToRefs(settingStore)

onMounted(async () => {
  if (currentAccountId.value) {
    await settingStore.fetchSettings(String(currentAccountId.value))
  }
})

const strategyLabels: Record<string, string> = {
  max_exp: '最大经验',
  max_gold: '最大金币',
  balance: '均衡',
  quick: '快速成熟',
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <div v-if="settingsLoading" class="flex flex-col items-center gap-3 py-16 text-center">
      <div class="i-svg-spinners-90-ring-with-bg text-2xl" :style="{ color: 'var(--theme-primary)' }" />
      <div class="text-sm" :style="{ color: 'var(--theme-text)', opacity: 0.4 }">加载策略设置...</div>
    </div>

    <div v-else class="flex flex-col gap-3">
      <!-- 种植策略 -->
      <div
        class="rounded-2xl p-5"
        :style="{
          background: 'var(--theme-glass)',
          border: '1px solid var(--theme-border)',
          backdropFilter: 'blur(16px)',
        }"
      >
        <div class="text-sm font-semibold mb-4" :style="{ color: 'var(--theme-text)' }">🎯 种植策略</div>

        <div class="flex flex-col gap-2">
          <div class="flex items-center justify-between rounded-xl px-3 py-2.5" :style="{ background: 'color-mix(in srgb, var(--theme-primary) 5%, transparent)' }">
            <span class="text-xs" :style="{ color: 'color-mix(in srgb, var(--theme-text) 55%, transparent)' }">策略模式</span>
            <span class="text-xs font-semibold" :style="{ color: 'var(--theme-primary)' }">{{ strategyLabels[settings?.plantingStrategy || ''] || settings?.plantingStrategy || '未设置' }}</span>
          </div>
          <div class="flex items-center justify-between rounded-xl px-3 py-2.5" :style="{ background: 'color-mix(in srgb, var(--theme-primary) 5%, transparent)' }">
            <span class="text-xs" :style="{ color: 'color-mix(in srgb, var(--theme-text) 55%, transparent)' }">优先种子 ID</span>
            <span class="text-xs font-semibold" :style="{ color: 'var(--theme-text)' }">{{ settings?.preferredSeedId || '自动' }}</span>
          </div>
          <div class="flex items-center justify-between rounded-xl px-3 py-2.5" :style="{ background: 'color-mix(in srgb, var(--theme-primary) 5%, transparent)' }">
            <span class="text-xs" :style="{ color: 'color-mix(in srgb, var(--theme-text) 55%, transparent)' }">备用策略</span>
            <span class="text-xs font-semibold" :style="{ color: 'var(--theme-text)' }">{{ strategyLabels[settings?.bagSeedFallbackStrategy || ''] || settings?.bagSeedFallbackStrategy || '自动' }}</span>
          </div>
          <div class="flex items-center justify-between rounded-xl px-3 py-2.5" :style="{ background: 'color-mix(in srgb, var(--theme-primary) 5%, transparent)' }">
            <span class="text-xs" :style="{ color: 'color-mix(in srgb, var(--theme-text) 55%, transparent)' }">优先 2x2 作物</span>
            <span class="text-xs font-semibold" :style="{ color: settings?.prioritize2x2Crops ? 'var(--theme-primary)' : 'color-mix(in srgb, var(--theme-text) 40%, transparent)' }">{{ settings?.prioritize2x2Crops ? '✅ 是' : '❌ 否' }}</span>
          </div>
        </div>
      </div>

      <!-- 化肥策略 -->
      <div
        class="rounded-2xl p-5"
        :style="{
          background: 'var(--theme-glass)',
          border: '1px solid var(--theme-border)',
          backdropFilter: 'blur(16px)',
        }"
      >
        <div class="text-sm font-semibold mb-4" :style="{ color: 'var(--theme-text)' }">🧪 化肥配置</div>
        <div class="grid grid-cols-2 gap-3">
          <div class="rounded-xl p-3 text-center" :style="{ background: 'color-mix(in srgb, var(--theme-primary) 6%, transparent)' }">
            <div class="text-xs font-semibold" :style="{ color: 'var(--theme-primary)' }">普通化肥</div>
            <div class="text-lg font-bold mt-1" :style="{ color: 'var(--theme-text)' }">{{ settings?.fertilizerBuyNormalCount || 0 }}</div>
            <div class="text-[10px] mt-0.5" :style="{ color: 'color-mix(in srgb, var(--theme-text) 40%, transparent)' }">每次购买</div>
          </div>
          <div class="rounded-xl p-3 text-center" style="background:color-mix(in srgb, #f59e0b 10%, transparent);">
            <div class="text-xs font-semibold" style="color:#d97706">有机化肥</div>
            <div class="text-lg font-bold mt-1" :style="{ color: 'var(--theme-text)' }">{{ settings?.fertilizerBuyOrganicCount || 0 }}</div>
            <div class="text-[10px] mt-0.5" :style="{ color: 'color-mix(in srgb, var(--theme-text) 40%, transparent)' }">每次购买</div>
          </div>
        </div>
      </div>

      <router-link
        to="/settings"
        class="flex items-center justify-center gap-1 rounded-2xl py-3 text-sm font-semibold transition-all"
        :style="{ background: 'color-mix(in srgb, var(--theme-primary) 8%, transparent)', color: 'var(--theme-primary)' }"
      >
        🔧 前往设置页配置完整选项
      </router-link>
    </div>
  </div>
</template>
