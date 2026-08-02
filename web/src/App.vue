<script setup lang="ts">
import type { Theme } from '@/stores/app'
import { onMounted } from 'vue'
import { RouterView } from 'vue-router'
import ToastContainer from '@/components/ToastContainer.vue'
import { useAppStore } from '@/stores/app'

const appStore = useAppStore()

// 立即应用保存的主题（在组件挂载前）
const savedTheme = localStorage.getItem('ui_theme') as Theme
if (savedTheme && appStore.themes[savedTheme]) {
  appStore.applyTheme(savedTheme)
}

onMounted(() => {
  appStore.fetchTheme()
})
</script>

<template>
  <div class="h-screen w-full overflow-hidden app-root" :style="{ color: 'var(--theme-text)' }">
    <RouterView />
    <ToastContainer />
  </div>
</template>

<style>
/* Global styles */
body {
  margin: 0;
  font-family: 'DM Sans', sans-serif;
  background: var(--app-bg);
  color: var(--theme-text);
  font-feature-settings: "cv02", "cv03", "cv04", "cv11";
}

/* Color theme variables */
:root {
  --theme-bg: #f8fafc;
  --theme-text: #172033;
  --theme-primary: #3b82f6;
  --theme-secondary: #2563eb;
  --theme-gradient: linear-gradient(135deg, #60a5fa 0%, #3b82f6 100%);
  --app-bg: linear-gradient(180deg, #f6f8fb 0%, #eef3f8 100%);
  --surface-1: color-mix(in srgb, var(--theme-bg) 8%, #ffffff);
  --surface-2: color-mix(in srgb, var(--theme-bg) 22%, #ffffff);
  --surface-3: color-mix(in srgb, var(--theme-bg) 40%, #ffffff);
  --surface-border: rgba(15, 23, 42, 0.09);
  --surface-border-strong: rgba(15, 23, 42, 0.14);
  --surface-shadow: 0 16px 45px rgba(15, 23, 42, 0.08);
  --surface-shadow-soft: 0 8px 24px rgba(15, 23, 42, 0.06);
  --muted-text: #64748b;
  --input-bg: rgba(255, 255, 255, 0.84);
  --panel-glow: color-mix(in srgb, var(--theme-primary) 14%, transparent);
}

.dark {
  --app-bg: radial-gradient(circle at top left, color-mix(in srgb, var(--theme-primary) 16%, transparent) 0, transparent 28rem), linear-gradient(180deg, #0b1020 0%, color-mix(in srgb, var(--theme-bg) 74%, #020617) 100%);
  --surface-1: color-mix(in srgb, var(--theme-bg) 72%, #ffffff 9%);
  --surface-2: color-mix(in srgb, var(--theme-bg) 78%, #ffffff 6%);
  --surface-3: color-mix(in srgb, var(--theme-bg) 84%, #ffffff 4%);
  --surface-border: rgba(255, 255, 255, 0.09);
  --surface-border-strong: rgba(255, 255, 255, 0.14);
  --surface-shadow: 0 18px 55px rgba(0, 0, 0, 0.34);
  --surface-shadow-soft: 0 10px 28px rgba(0, 0, 0, 0.24);
  --muted-text: #9ca3af;
  --input-bg: rgba(15, 23, 42, 0.54);
  --panel-glow: color-mix(in srgb, var(--theme-primary) 18%, transparent);
}

.app-root {
  background: var(--app-bg);
}

/* SaaS surface system */
.bg-white {
  background-color: var(--surface-1) !important;
}

.dark .bg-gray-800,
.dark .bg-gray-900 {
  background-color: var(--surface-1) !important;
}

.bg-gray-50 {
  background-color: var(--surface-2) !important;
}

.dark .bg-gray-700 {
  background-color: var(--surface-3) !important;
}

.ui-card {
  border: 1px solid var(--surface-border);
  background: linear-gradient(180deg, color-mix(in srgb, var(--surface-1) 96%, #ffffff 4%), var(--surface-1));
  box-shadow: var(--surface-shadow-soft);
}

.ui-card-elevated {
  border: 1px solid var(--surface-border);
  background: linear-gradient(180deg, color-mix(in srgb, var(--surface-1) 92%, #ffffff 8%), var(--surface-1));
  box-shadow: var(--surface-shadow);
}

.ui-subtle-panel {
  border: 1px solid var(--surface-border);
  background: color-mix(in srgb, var(--surface-2) 86%, transparent);
}

.glass-panel {
  border: 1px solid var(--surface-border);
  background: color-mix(in srgb, var(--surface-1) 78%, transparent);
  backdrop-filter: blur(20px);
  box-shadow: var(--surface-shadow-soft);
}

.metric-card {
  position: relative;
  overflow: hidden;
}

.metric-card::before {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    linear-gradient(135deg, var(--panel-glow), transparent 42%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.12), transparent 34%);
}

.metric-card > * {
  position: relative;
}

.shadow,
.shadow-sm,
.shadow-md {
  box-shadow: var(--surface-shadow-soft) !important;
}

/* Use CSS variables for theme colors */
.btn-primary {
  background: var(--theme-gradient);
  border-color: var(--theme-primary);
}

.btn-primary:hover {
  background: var(--theme-secondary);
}

.text-primary {
  color: var(--theme-primary);
}

.bg-primary {
  background-color: var(--theme-primary);
}

.border-primary {
  border-color: var(--theme-primary);
}

.bg-gradient-primary {
  background: var(--theme-gradient);
}

/* Scrollbar styling */
::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

::-webkit-scrollbar-track {
  background: transparent;
}

::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, var(--theme-primary) 50%, #94a3b8);
  border-radius: 999px;
}

::-webkit-scrollbar-thumb:hover {
  background: var(--theme-secondary);
  opacity: 0.8;
}
</style>
