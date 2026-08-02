<script setup lang="ts">
import type { Theme } from '@/stores/app'
import { useAppStore } from '@/stores/app'

const appStore = useAppStore()
</script>

<template>
  <div class="relative flex items-center gap-1">
    <!-- 主题切换按钮：一键明暗切换 -->
    <button
      class="flex h-8 w-16 items-center justify-between rounded-full px-1.5 transition-all duration-300"
      :style="{
        background: appStore.isDark
          ? 'linear-gradient(135deg, #1e293b, #334155)'
          : 'linear-gradient(135deg, #fef3c7, #fde68a)',
        boxShadow: appStore.isDark
          ? 'inset 0 1px 2px rgba(0,0,0,0.4)'
          : 'inset 0 1px 2px rgba(0,0,0,0.08)',
      }"
      :title="appStore.isDark ? '切换到浅色模式' : '切换到深色模式'"
      @click="appStore.toggleDark()"
    >
      <!-- 滑块 -->
      <div
        class="flex h-6 w-6 transform items-center justify-center rounded-full shadow-md transition-all duration-300"
        :class="appStore.isDark ? 'translate-x-[18px] bg-slate-700' : 'translate-x-0 bg-white'"
      >
        <div
          :class="appStore.isDark ? 'i-carbon-moon text-yellow-300' : 'i-carbon-sun text-amber-500'"
          class="text-sm"
        />
      </div>
    </button>

    <!-- Teleport 模式选择面板（仅当展开时） -->
    <teleport to="body">
      <!-- 遮罩 -->
      <div
        v-if="appStore.showThemePanel"
        class="fixed inset-0 z-[99] bg-black/20 backdrop-blur-sm"
        @click="appStore.toggleThemePanel()"
      />

      <Transition name="panel">
        <div
          v-if="appStore.showThemePanel"
          class="fixed z-[100] w-64 rounded-2xl p-5 shadow-2xl"
          :style="{
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            background: 'var(--theme-glass)',
            backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
            border: '1px solid var(--theme-border)',
          }"
        >
          <h3
            class="mb-4 text-center text-sm font-bold"
            :style="{ color: 'var(--theme-text)' }"
          >
            选择主题
          </h3>

          <!-- 两套主题卡片 -->
          <div class="flex flex-col gap-3">
            <button
              v-for="(t, key) in appStore.themes"
              :key="key"
              class="group relative flex items-center gap-4 rounded-xl p-4 transition-all duration-300"
              :class="{
                'scale-[1.02]': appStore.currentTheme === key,
              }"
              :style="{
                background: appStore.currentTheme === key
                  ? 'color-mix(in srgb, ' + t.primary + ' 12%, transparent)'
                  : 'color-mix(in srgb, var(--theme-text) 4%, transparent)',
                border: '1px solid ' + (appStore.currentTheme === key ? t.primary : 'var(--theme-border)'),
              }"
              @click="appStore.applyTheme(key as Theme); appStore.toggleThemePanel()"
            >
              <!-- 预览圆 -->
              <div
                class="flex h-12 w-12 flex-none items-center justify-center rounded-2xl"
                :style="{ background: t.gradient }"
              >
                <div :class="t.icon" class="text-lg text-white" />
              </div>

              <!-- 文字 -->
              <div class="flex flex-col items-start text-left">
                <span
                  class="text-sm font-bold"
                  :style="{ color: 'var(--theme-text)' }"
                >
                  {{ t.name }}
                </span>
                <span
                  class="text-xs opacity-60"
                  :style="{ color: 'var(--theme-text)' }"
                >
                  {{ t.isDark ? '深邃 · 光感夜幕' : '温暖 · 日光田野' }}
                </span>
              </div>

              <!-- 选中标记 -->
              <div
                v-if="appStore.currentTheme === key"
                class="ml-auto flex h-6 w-6 items-center justify-center rounded-full"
                :style="{ background: t.primary }"
              >
                <div class="i-carbon-checkmark text-xs text-white" />
              </div>
            </button>
          </div>

          <div class="mt-4 border-t pt-3 text-center" :style="{ borderColor: 'var(--theme-border)' }">
            <button
              class="text-xs opacity-60 transition-opacity hover:opacity-100"
              :style="{ color: 'var(--theme-text)' }"
              @click="appStore.toggleThemePanel()"
            >
              关闭
            </button>
          </div>
        </div>
      </Transition>
    </teleport>
  </div>
</template>

<style scoped>
.panel-enter-active {
  animation: panel-in 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}
.panel-leave-active {
  animation: panel-out 0.2s ease-in;
}
@keyframes panel-in {
  0% { opacity: 0; transform: translate(-50%, -48%) scale(0.92); }
  100% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
}
@keyframes panel-out {
  0% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
  100% { opacity: 0; transform: translate(-50%, -48%) scale(0.92); }
}
</style>
