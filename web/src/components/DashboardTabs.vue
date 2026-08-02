<script setup lang="ts">
import { ref } from 'vue'

export interface DashboardTab {
  key: string
  label: string
  icon: string
}

const props = defineProps<{
  tabs: DashboardTab[]
  activeTab: string
}>()

const emit = defineEmits<{
  (e: 'update:activeTab', key: string): void
}>()

const scrollContainer = ref<HTMLElement | null>(null)

function selectTab(key: string) {
  emit('update:activeTab', key)
  // 滚动到选中 tab 居中
  if (scrollContainer.value) {
    const container = scrollContainer.value
    const activeEl = container.querySelector(`[data-tab-key="${key}"]`) as HTMLElement | null
    if (activeEl) {
      const containerRect = container.getBoundingClientRect()
      const elRect = activeEl.getBoundingClientRect()
      const scrollLeft = container.scrollLeft + elRect.left - containerRect.left - containerRect.width / 2 + elRect.width / 2
      container.scrollTo({ left: scrollLeft, behavior: 'smooth' })
    }
  }
}
</script>

<template>
  <div class="dashboard-tabs-wrapper">
    <!-- 环境光晕 -->
    <div class="tabs-ambient" aria-hidden="true" />

    <div
      ref="scrollContainer"
      class="dashboard-tabs"
    >
      <button
        v-for="tab in tabs"
        :key="tab.key"
        :data-tab-key="tab.key"
        class="tab-item"
        :class="{ 'tab-item--active': activeTab === tab.key }"
        @click="selectTab(tab.key)"
      >
        <span class="tab-icon" :class="tab.icon" />
        <span class="tab-label">{{ tab.label }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.dashboard-tabs-wrapper {
  position: relative;
  margin-bottom: 16px;
  z-index: 1;
}

/* 环境光晕 */
.tabs-ambient {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 80%;
  height: 100%;
  background: radial-gradient(ellipse, color-mix(in srgb, var(--theme-primary) 10%, transparent) 0%, transparent 70%);
  pointer-events: none;
  filter: blur(20px);
}

.dashboard-tabs {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  scrollbar-width: none;
  -webkit-overflow-scrolling: touch;
  padding: 4px;
  border-radius: 16px;
  position: relative;
  background: var(--theme-glass);
  backdrop-filter: blur(20px) saturate(160%);
  -webkit-backdrop-filter: blur(20px) saturate(160%);
  border: 1px solid var(--theme-border);
  box-shadow: 0 4px 16px color-mix(in srgb, var(--theme-primary) 6%, transparent), 0 1px 2px rgba(0,0,0,0.03);
}

.dashboard-tabs::-webkit-scrollbar {
  display: none;
}

.tab-item {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 8px 14px;
  border: none;
  border-radius: 12px;
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
  background: transparent;
  color: color-mix(in srgb, var(--theme-text) 55%, transparent);
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  -webkit-tap-highlight-color: transparent;
  position: relative;
  user-select: none;
}

.tab-item:active {
  transform: scale(0.95);
}

.tab-icon {
  font-size: 16px;
  transition: all 0.3s ease;
}

.tab-label {
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.01em;
  transition: all 0.3s ease;
}

/* Hover 效果（仅非触屏设备） */
@media (hover: hover) {
  .tab-item:hover:not(.tab-item--active) {
    color: color-mix(in srgb, var(--theme-text) 80%, transparent);
    background: color-mix(in srgb, var(--theme-text) 4%, transparent);
  }
}

/* 激活状态 — 光感 */
.tab-item--active {
  color: var(--theme-primary);
  background: color-mix(in srgb, var(--theme-primary) 10%, transparent);
  box-shadow: 0 0 16px color-mix(in srgb, var(--theme-primary) 12%, transparent), 0 1px 3px color-mix(in srgb, var(--theme-primary) 8%, transparent);
}

.tab-item--active .tab-icon {
  filter: drop-shadow(0 0 4px color-mix(in srgb, var(--theme-primary) 50%, transparent));
}

/* 移动端适配 */
@media (max-width: 480px) {
  .dashboard-tabs-wrapper {
    margin-left: -12px;
    margin-right: -12px;
  }

  .dashboard-tabs {
    gap: 4px;
    padding: 4px 8px;
    border-radius: 14px;
  }

  .tab-item {
    padding: 7px 11px;
  }

  .tab-icon {
    font-size: 15px;
  }

  .tab-label {
    font-size: 12px;
  }
}

/* 无障碍动效 */
@media (prefers-reduced-motion: reduce) {
  .tab-item {
    transition: none !important;
  }
}
</style>
