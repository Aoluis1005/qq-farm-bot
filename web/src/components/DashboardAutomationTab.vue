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
</script>

<template>
  <div class="flex flex-col gap-3">
    <div v-if="settingsLoading" class="flex flex-col items-center gap-3 py-16 text-center">
      <div class="i-svg-spinners-90-ring-with-bg text-2xl" :style="{ color: 'var(--theme-primary)' }" />
      <div class="text-sm" :style="{ color: 'var(--theme-text)', opacity: 0.4 }">加载设置...</div>
    </div>

    <div v-else class="flex flex-col gap-3">
      <!-- 自动控制状态 -->
      <div
        class="rounded-2xl p-5"
        :style="{
          background: 'var(--theme-glass)',
          border: '1px solid var(--theme-border)',
          backdropFilter: 'blur(16px)',
        }"
      >
        <div class="flex items-center justify-between mb-4">
          <div class="text-sm font-semibold" :style="{ color: 'var(--theme-text)' }">⚙️ 自动控制</div>
          <span
            v-if="settings?.automation?.farm"
            class="rounded-full px-3 py-1 text-xs font-semibold"
            style="background:color-mix(in srgb, #22c55e 15%, transparent); color:#16a34a;"
          >已开启</span>
          <span
            v-else
            class="rounded-full px-3 py-1 text-xs font-semibold"
            :style="{ background: 'color-mix(in srgb, var(--theme-text) 10%, transparent)', color: 'color-mix(in srgb, var(--theme-text) 50%, transparent)' }"
          >已关闭</span>
        </div>

        <div class="grid grid-cols-3 gap-3 mb-4">
          <div class="rounded-xl p-3 text-center" :style="{ background: 'color-mix(in srgb, var(--theme-primary) 6%, transparent)' }">
            <div class="text-xs font-semibold" :style="{ color: 'var(--theme-primary)' }">农场</div>
            <div class="text-lg font-bold mt-1" :style="{ color: 'var(--theme-text)' }">{{ settings?.intervals?.farm || '-' }}</div>
            <div class="text-[10px] mt-0.5" :style="{ color: 'color-mix(in srgb, var(--theme-text) 40%, transparent)' }">分钟</div>
          </div>
          <div class="rounded-xl p-3 text-center" style="background:color-mix(in srgb, #f59e0b 10%, transparent);">
            <div class="text-xs font-semibold" style="color:#d97706">帮助</div>
            <div class="text-lg font-bold mt-1" :style="{ color: 'var(--theme-text)' }">{{ settings?.intervals?.friend || '-' }}</div>
            <div class="text-[10px] mt-0.5" :style="{ color: 'color-mix(in srgb, var(--theme-text) 40%, transparent)' }">分钟</div>
          </div>
          <div class="rounded-xl p-3 text-center" style="background:color-mix(in srgb, #3b82f6 10%, transparent);">
            <div class="text-xs font-semibold" style="color:#2563eb">偷菜</div>
            <div class="text-lg font-bold mt-1" :style="{ color: 'var(--theme-text)' }">{{ settings?.intervals?.stealMin || '-' }}-{{ settings?.intervals?.stealMax || '-' }}</div>
            <div class="text-[10px] mt-0.5" :style="{ color: 'color-mix(in srgb, var(--theme-text) 40%, transparent)' }">分钟</div>
          </div>
        </div>

        <div class="flex flex-col gap-2" v-if="settings?.automation">
          <div class="flex items-center justify-between rounded-xl px-3 py-2" :style="{ background: 'color-mix(in srgb, var(--theme-primary) 4%, transparent)' }">
            <span class="text-xs" :style="{ color: 'color-mix(in srgb, var(--theme-text) 60%, transparent)' }">自动好友帮助</span>
            <span class="text-xs font-semibold" :style="{ color: settings?.automation?.friend_help ? 'var(--theme-primary)' : 'color-mix(in srgb, var(--theme-text) 40%, transparent)' }">{{ settings?.automation?.friend_help ? '✅ 开启' : '❌ 关闭' }}</span>
          </div>
          <div class="flex items-center justify-between rounded-xl px-3 py-2" :style="{ background: 'color-mix(in srgb, var(--theme-primary) 4%, transparent)' }">
            <span class="text-xs" :style="{ color: 'color-mix(in srgb, var(--theme-text) 60%, transparent)' }">自动偷菜</span>
            <span class="text-xs font-semibold" :style="{ color: settings?.automation?.friend_steal ? 'var(--theme-primary)' : 'color-mix(in srgb, var(--theme-text) 40%, transparent)' }">{{ settings?.automation?.friend_steal ? '✅ 开启' : '❌ 关闭' }}</span>
          </div>
          <div class="flex items-center justify-between rounded-xl px-3 py-2" :style="{ background: 'color-mix(in srgb, var(--theme-primary) 4%, transparent)' }">
            <span class="text-xs" :style="{ color: 'color-mix(in srgb, var(--theme-text) 60%, transparent)' }">自动出售</span>
            <span class="text-xs font-semibold" :style="{ color: settings?.automation?.sell ? 'var(--theme-primary)' : 'color-mix(in srgb, var(--theme-text) 40%, transparent)' }">{{ settings?.automation?.sell ? '✅ 开启' : '❌ 关闭' }}</span>
          </div>
        </div>

        <router-link
          to="/settings"
          class="mt-4 flex items-center justify-center gap-1 rounded-xl py-2.5 text-xs font-semibold transition-all"
          :style="{ background: 'color-mix(in srgb, var(--theme-primary) 8%, transparent)', color: 'var(--theme-primary)' }"
        >
          🔧 前往设置页配置完整选项
        </router-link>
      </div>
    </div>
  </div>
</template>
