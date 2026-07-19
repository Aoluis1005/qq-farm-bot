<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { menuRoutes } from '@/router/menu'
import { useUserStore } from '@/stores/user'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()

const primaryNames = ['dashboard', 'personal', 'friends', 'activity']
const primaryItems = computed(() => menuRoutes.filter(item => primaryNames.includes(item.name)))

const secondaryItems = computed(() => {
  return menuRoutes.filter(item => {
    if (primaryNames.includes(item.name)) return false
    if (item.adminOnly && !userStore.isAdmin) return false
    return true
  })
})

const activeInSecondary = computed(() => {
  return secondaryItems.value.some(item =>
    item.path === '' ? route.path === '/' : route.path.startsWith(`/${item.path}`),
  )
})

const showMorePanel = ref(false)

// 用户手动收起/展开：收起后 dock 整体让出底部，避免遮挡页面二级菜单/底部按钮
const collapsed = ref(false)

// 弹窗/确认页/抽屉打开时，dock 自动让位，避免遮挡其底部按钮
// （覆盖全屏遮罩、居中确认页、底部抽屉等非全屏弹窗的确认页）
const modalOpen = ref(false)
const dockEl = ref<HTMLElement | null>(null)
let modalObserver: MutationObserver | null = null
let modalScanTimer: number | null = null

// 检测是否存在"浮层"：只要有一个固定定位节点（排除 dock 自身与纯提示）
// ① 覆盖接近全屏（全屏遮罩）或 ② 底部贴近视口底部（bottom-sheet/底部确认页）即认为有弹层
function scanOverlayOpen(): boolean {
  const els = document.querySelectorAll('*')
  const vw = window.innerWidth
  const vh = window.innerHeight
  for (const el of Array.from(els)) {
    const node = el as HTMLElement
    if (node === dockEl.value) continue
    const cs = getComputedStyle(node)
    if (cs.position !== 'fixed') continue
    const rect = node.getBoundingClientRect()
    // 全屏遮罩
    const coversScreen = rect.width >= vw - 4 && rect.height >= vh - 4 && rect.top <= 2 && rect.left <= 2
    // 底部弹层：底部落在视口底部 140px 内（含非全屏确认页/抽屉）
    const bottomNear = rect.bottom >= vh - 140 && rect.top < vh - 10 && rect.width >= 120
    if (coversScreen || bottomNear) return true
  }
  return false
}

function scheduleModalScan() {
  if (modalScanTimer !== null) return
  modalScanTimer = window.setTimeout(() => {
    modalScanTimer = null
    modalOpen.value = scanOverlayOpen()
  }, 120)
}

function isActive(path: string): boolean {
  if (path === '') return route.path === '/' || route.path === ''
  return route.path.startsWith(`/${path}`)
}

function goTo(path: string) {
  router.push(path === '' ? '/' : `/${path}`)
  showMorePanel.value = false
}

function toggleMorePanel() { showMorePanel.value = !showMorePanel.value }
function closeMorePanel() { showMorePanel.value = false }

// 用户收起/展开 dock（点击把手或收起态小药丸）
function toggleCollapse() { collapsed.value = !collapsed.value }

// 打开"更多"二级面板时，dock 本体自动收起，避免两层浮层叠加遮挡按钮
watch(showMorePanel, (open) => {
  if (open) collapsed.value = true
})

onMounted(() => {
  // 监听全局 DOM 变动，检测弹窗/确认页/抽屉的打开与关闭
  if (typeof MutationObserver !== 'undefined') {
    modalObserver = new MutationObserver(scheduleModalScan)
    modalObserver.observe(document.body, { childList: true, subtree: true })
    modalOpen.value = scanOverlayOpen()
  }
})

onUnmounted(() => {
  if (modalObserver) modalObserver.disconnect()
  if (modalScanTimer !== null) clearTimeout(modalScanTimer)
})
</script>

<template>
  <div class="ambient-glow" :class="{ 'ambient-glow--hidden': collapsed }" />
  <div
    ref="dockEl"
    class="floating-nav-wrapper"
    :class="{ 'dock-collapsed': collapsed, 'dock-modal-open': modalOpen }"
  >
    <Transition name="more-panel">
      <div v-if="showMorePanel" class="more-panel">
        <div class="more-panel-header">
          <span class="more-panel-title">更多功能</span>
          <button class="more-panel-close" @click="closeMorePanel">
            <span class="i-carbon-close" />
          </button>
        </div>
        <div class="more-panel-grid">
          <button
            v-for="item in secondaryItems"
            :key="item.path"
            class="more-panel-item"
            :class="{ 'more-panel-item--active': isActive(item.path) }"
            @click="goTo(item.path)"
          >
            <span class="more-panel-item-icon" :class="item.icon" />
            <span class="more-panel-item-label">{{ item.label }}</span>
          </button>
        </div>
      </div>
    </Transition>
    <Transition name="more-overlay">
      <div v-if="showMorePanel" class="more-overlay" @click="closeMorePanel" />
    </Transition>
    <Transition name="dock-collapse">
      <nav v-if="!collapsed" class="floating-nav" role="navigation" aria-label="主导航">
        <router-link
          v-for="item in primaryItems"
          :key="item.path"
          :to="item.path === '' ? '/' : `/${item.path}`"
          class="nav-item"
          :class="{ 'nav-item--active': isActive(item.path) }"
          @click="closeMorePanel"
        >
          <span class="nav-item-icon" :class="item.icon" />
          <span class="nav-item-label">{{ item.label }}</span>
        </router-link>
        <button
          class="nav-item"
          :class="{ 'nav-item--active': showMorePanel || activeInSecondary }"
          @click="toggleMorePanel"
        >
          <span class="nav-item-icon i-carbon-overflow-menu-horizontal" />
          <span class="nav-item-label">更多</span>
        </button>
      </nav>
    </Transition>
    <!-- 收起态：仅保留一个可点击的小药丸，不遮挡页面；展开态在 nav 上沿显示把手 -->
    <button
      v-if="collapsed && !modalOpen"
      class="dock-collapsed-pill"
      aria-label="展开导航栏"
      @click="toggleCollapse"
    >
      <span class="i-carbon-chevron-up" />
    </button>
    <button
      v-else-if="!collapsed && !modalOpen"
      class="dock-handle"
      aria-label="收起导航栏"
      @click="toggleCollapse"
    >
      <span class="dock-handle-bar" />
    </button>
  </div>
</template>

<style scoped>
.floating-nav-wrapper {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 1000;
  display: flex;
  justify-content: center;
  padding-bottom: env(safe-area-inset-bottom, 0px);
  pointer-events: none;
  transition: transform 0.35s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.35s ease;
}

/* 用户收起：整体下移并禁用交互，完全让出底部给页面内容 */
.floating-nav-wrapper.dock-collapsed {
  transform: translateY(calc(100% + 60px));
  opacity: 0;
  pointer-events: none;
}

/* 弹窗/确认页/抽屉打开时：dock 完全让位（不挡弹层内底部按钮），连把手/药丸也不显示 */
.floating-nav-wrapper.dock-modal-open {
  transform: translateY(calc(100% + 60px));
  opacity: 0;
  pointer-events: none;
}

/* 收起态小药丸：仅这一小块可点，其余区域不拦截点击 */
.dock-collapsed-pill {
  pointer-events: auto;
  position: fixed;
  bottom: calc(env(safe-area-inset-bottom, 0px) + 10px);
  left: 50%;
  transform: translateX(-50%);
  width: 44px;
  height: 22px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(30, 30, 40, 0.65);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  color: rgba(255, 255, 255, 0.6);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
  transition: all 0.2s ease;
  z-index: 1000;
}
.dock-collapsed-pill:hover { color: #fff; background: rgba(30, 30, 40, 0.8); }
.dock-collapsed-pill .i-carbon-chevron-up { font-size: 14px; }

/* 展开态把手：固定在底部 nav 上方的小横条，点击收起 */
.dock-handle {
  pointer-events: auto;
  position: fixed;
  bottom: calc(env(safe-area-inset-bottom, 0px) + 96px);
  left: 50%;
  transform: translateX(-50%);
  width: 48px;
  height: 18px;
  border-radius: 12px 12px 0 0;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-bottom: none;
  background: rgba(30, 30, 40, 0.5);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  transition: all 0.2s ease;
}
.dock-handle:hover { background: rgba(30, 30, 40, 0.7); }
.dock-handle-bar {
  width: 22px;
  height: 3px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.35);
  transition: all 0.2s ease;
}
.dock-handle:hover .dock-handle-bar { background: rgba(255, 255, 255, 0.6); }

.dock-collapse-enter-active, .dock-collapse-leave-active {
  transition: opacity 0.3s ease, transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}
.dock-collapse-enter-from, .dock-collapse-leave-to {
  opacity: 0;
  transform: translateY(20px) scale(0.95);
}

.ambient-glow {
  position: fixed;
  bottom: -60px;
  left: 50%;
  transform: translateX(-50%);
  width: 360px;
  height: 140px;
  background: radial-gradient(ellipse, color-mix(in srgb, var(--theme-primary) 22%, transparent), transparent 70%);
  pointer-events: none;
  z-index: 999;
  filter: blur(36px);
  transition: opacity 0.35s ease;
}
.ambient-glow--hidden {
  opacity: 0;
}

.floating-nav {
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  margin-bottom: 24px;
  border-radius: 28px;
  width: max-content;
  max-width: calc(100% - 48px);
  overflow-x: auto;
  scrollbar-width: none;
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  background: rgba(30, 30, 40, 0.65);
  border: 1px solid rgba(255, 255, 255, 0.12);
  box-shadow:
    0 8px 32px rgba(0, 0, 0, 0.4),
    0 0 0 0.5px rgba(255, 255, 255, 0.05) inset;
  animation: nav-slide-up 0.5s cubic-bezier(0.16, 1, 0.3, 1) both;
}
.floating-nav::-webkit-scrollbar { display: none; }

@keyframes nav-slide-up {
  from { opacity: 0; transform: translateY(20px) scale(0.95); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

.nav-item {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 64px;
  height: 56px;
  border-radius: 20px;
  cursor: pointer;
  transition: all 0.3s ease;
  text-decoration: none;
  color: rgba(255, 255, 255, 0.5);
  background: transparent;
  border: none;
  -webkit-tap-highlight-color: transparent;
  flex-shrink: 0;
}
.nav-item-icon { font-size: 24px; line-height: 1; transition: all 0.3s ease; }
.nav-item-label { font-size: 10px; margin-top: 2px; transition: all 0.3s ease; }

@media (hover: hover) {
  .nav-item:hover:not(.nav-item--active) {
    color: rgba(255, 255, 255, 0.8);
    background: rgba(255, 255, 255, 0.05);
  }
}
.nav-item:active { transform: scale(0.94); }

.nav-item--active {
  color: #fff;
  background: rgba(255, 255, 255, 0.1);
  box-shadow: 0 0 20px color-mix(in srgb, var(--theme-primary) 18%, transparent);
}
.nav-item--active .nav-item-icon {
  filter: drop-shadow(0 0 6px color-mix(in srgb, var(--theme-primary) 60%, transparent));
}
.nav-item--active::before {
  content: '';
  position: absolute;
  top: 0;
  left: 50%;
  transform: translateX(-50%);
  width: 20px;
  height: 2px;
  border-radius: 2px;
  background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--theme-primary) 80%, #fff), transparent);
  animation: glow-pulse 2s ease-in-out infinite alternate;
}
@keyframes glow-pulse {
  from { opacity: 0.5; width: 16px; }
  to { opacity: 1; width: 24px; }
}

.more-overlay {
  position: fixed;
  inset: 0;
  z-index: 998;
  background: rgba(0, 0, 0, 0.35);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  pointer-events: auto;
}
.more-panel {
  pointer-events: auto;
  position: absolute;
  bottom: calc(100% + 16px);
  left: 50%;
  transform: translateX(-50%);
  width: min(360px, calc(100vw - 32px));
  padding: 16px;
  border-radius: 24px;
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  background: rgba(30, 30, 40, 0.75);
  border: 1px solid rgba(255, 255, 255, 0.12);
  box-shadow:
    0 8px 32px rgba(0, 0, 0, 0.5),
    0 0 0 0.5px rgba(255, 255, 255, 0.05) inset;
  z-index: 1001;
}
.more-panel-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
.more-panel-title { font-size: 14px; font-weight: 600; color: rgba(255, 255, 255, 0.8); }
.more-panel-close {
  width: 28px; height: 28px; display: flex; align-items: center; justify-content: center;
  border-radius: 8px; border: none; background: transparent;
  color: rgba(255, 255, 255, 0.5); cursor: pointer; font-size: 16px; transition: all 0.2s;
}
.more-panel-close:hover { color: #fff; background: rgba(255, 255, 255, 0.1); }
.more-panel-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.more-panel-item {
  display: flex; flex-direction: column; align-items: center; gap: 6px;
  padding: 14px 8px; border-radius: 16px; border: 1px solid transparent;
  background: transparent; color: rgba(255, 255, 255, 0.6);
  cursor: pointer; transition: all 0.3s ease;
}
.more-panel-item:hover { color: #fff; background: rgba(255, 255, 255, 0.06); transform: translateY(-2px); }
.more-panel-item--active { color: #fff; background: rgba(255, 255, 255, 0.1); box-shadow: 0 0 16px color-mix(in srgb, var(--theme-primary) 15%, transparent); }
.more-panel-item-icon { font-size: 26px; line-height: 1; transition: transform 0.3s ease; }
.more-panel-item:hover .more-panel-item-icon { transform: scale(1.1); }
.more-panel-item--active .more-panel-item-icon { filter: drop-shadow(0 0 6px color-mix(in srgb, var(--theme-primary) 50%, transparent)); }
.more-panel-item-label { font-size: 12px; font-weight: 500; white-space: nowrap; }

.more-panel-enter-active, .more-panel-leave-active { transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1); }
.more-panel-enter-from, .more-panel-leave-to { opacity: 0; transform: translateX(-50%) translateY(20px) scale(0.95); }
.more-overlay-enter-active, .more-overlay-leave-active { transition: opacity 0.3s ease; }
.more-overlay-enter-from, .more-overlay-leave-to { opacity: 0; }

@media (prefers-color-scheme: light) {
  .floating-nav {
    background: rgba(255, 255, 255, 0.65);
    border: 1px solid rgba(0, 0, 0, 0.06);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12), 0 0 0 0.5px rgba(0, 0, 0, 0.03) inset;
  }
  .nav-item { color: rgba(0, 0, 0, 0.5); }
  .nav-item--active {
    color: #000;
    background: rgba(0, 0, 0, 0.05);
    box-shadow: 0 0 20px color-mix(in srgb, var(--theme-primary) 15%, transparent);
  }
  .nav-item--active::before {
    background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--theme-primary) 70%, #000), transparent);
  }
  @media (hover: hover) {
    .nav-item:hover:not(.nav-item--active) { color: rgba(0, 0, 0, 0.8); background: rgba(0, 0, 0, 0.03); }
  }
  .more-panel {
    background: rgba(255, 255, 255, 0.75);
    border: 1px solid rgba(0, 0, 0, 0.06);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15), 0 0 0 0.5px rgba(0, 0, 0, 0.03) inset;
  }
  .more-panel-title { color: rgba(0, 0, 0, 0.7); }
  .more-panel-close { color: rgba(0, 0, 0, 0.4); }
  .more-panel-close:hover { color: #000; background: rgba(0, 0, 0, 0.05); }
  .more-panel-item { color: rgba(0, 0, 0, 0.5); }
  .more-panel-item:hover { color: #000; background: rgba(0, 0, 0, 0.03); }
  .more-panel-item--active { color: #000; background: rgba(0, 0, 0, 0.05); }
}

@media (max-width: 640px) {
  .floating-nav { gap: 4px; padding: 6px 8px; margin-bottom: 16px; border-radius: 24px; }
  .nav-item { width: 56px; height: 50px; border-radius: 18px; }
  .nav-item-icon { font-size: 22px; }
  .more-panel { width: calc(100vw - 24px); padding: 14px; }
  .more-panel-grid { gap: 6px; }
  .more-panel-item { padding: 12px 6px; }
}

@media (prefers-reduced-motion: reduce) {
  .floating-nav, .nav-item, .nav-item-icon, .nav-item--active::before, .more-panel, .more-panel-item {
    animation: none !important;
    transition: opacity 0.15s ease !important;
  }
}
</style>
