<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import MysteryMerchantBanner from '@/components/shop/MysteryMerchantBanner.vue'
import FloatingDock from '@/components/FloatingDock.vue'
import Sidebar from '@/components/Sidebar.vue'
import TopAccountMenu from '@/components/TopAccountMenu.vue'
import { useAppStore } from '@/stores/app'
import { useAccountStore } from '@/stores/account'

const appStore = useAppStore()
const accountStore = useAccountStore()

// 右滑呼出侧边栏（触屏）
const touchStartX = ref(0)
const touchStartY = ref(0)
function onTouchStart(e: TouchEvent) {
  touchStartX.value = e.touches?.[0]?.clientX ?? 0
  touchStartY.value = e.touches?.[0]?.clientY ?? 0
}
function onTouchMove(e: TouchEvent) {
  const x = e.touches?.[0]?.clientX ?? 0
  const y = e.touches?.[0]?.clientY ?? 0
  const dx = x - touchStartX.value
  const dy = Math.abs(y - touchStartY.value)
  if (dx > 80 && dx > dy * 2) {
    if (!appStore.sidebarOpen) appStore.openSidebar()
  }
}

onMounted(() => {
  appStore.fetchLoginPageConfig()
  accountStore.fetchAccounts()
  document.addEventListener('touchstart', onTouchStart as any, { passive: true })
  document.addEventListener('touchmove', onTouchMove as any, { passive: true })
})

onUnmounted(() => {
  document.removeEventListener('touchstart', onTouchStart as any)
  document.removeEventListener('touchmove', onTouchMove as any)
})

onMounted(() => {
  appStore.fetchLoginPageConfig()
  accountStore.fetchAccounts()
})

onUnmounted(() => {})
</script>

<template>
  <div class="w-screen flex overflow-hidden bg-gray-50 dark:bg-gray-900" style="height: 100dvh;">>
    <Sidebar />
    <main class="relative h-full min-h-0 min-w-0 flex flex-1 flex-col overflow-hidden">
      <!-- 顶部栏：左侧移动端菜单按钮 + 右上角账号切换 -->
      <header class="glass-bar z-30 flex h-14 shrink-0 items-center justify-between gap-2 border-b border-gray-200/50 px-2 sm:px-3 dark:border-gray-700/50">
        <button
          class="flex h-10 w-10 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100/70 lg:hidden dark:text-gray-400 dark:hover:bg-gray-700/50"
          title="打开菜单"
          @click="appStore.toggleSidebar"
        >
          <div class="i-carbon-menu text-xl" />
        </button>
        <div class="ml-auto">
          <TopAccountMenu />
        </div>
      </header>

      <div class="min-h-0 flex flex-1 flex-col overflow-hidden">
        <MysteryMerchantBanner />
        <div class="custom-scrollbar min-h-0 flex flex-1 flex-col overflow-y-auto p-3 pb-[calc(5rem+env(safe-area-inset-bottom))] md:p-6 sm:p-4 md:pb-[calc(5.5rem+env(safe-area-inset-bottom))] sm:pb-[calc(5rem+env(safe-area-inset-bottom))]">
          <RouterView v-slot="{ Component, route }">
            <component :is="Component" :key="route.path" />
          </RouterView>
        </div>
      </div>
      <FloatingDock />
    </main>
  </div>
</template>

<style scoped>
.glass-bar {
  background: color-mix(in srgb, var(--surface-1) 82%, transparent);
  backdrop-filter: blur(16px) saturate(160%);
  -webkit-backdrop-filter: blur(16px) saturate(160%);
}
.modal-fade-enter-active { animation: modal-in 0.4s ease-out; }
.modal-fade-leave-active { animation: modal-out 0.3s ease-in; }
@keyframes modal-in { 0% { opacity: 0; transform: scale(0.9); } 100% { opacity: 1; transform: scale(1); } }
@keyframes modal-out { 0% { opacity: 0; transform: scale(0.9); } 100% { opacity: 1; transform: scale(1); } }
.slide-fade-enter-active,.slide-fade-leave-active { transition: all 0.2s ease-out; }
.slide-fade-enter-from { opacity: 0; transform: translateY(10px); }
.slide-fade-leave-to { opacity: 0; transform: translateY(-10px); }
.custom-scrollbar::-webkit-scrollbar { width: 6px; height: 6px; }
.custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
.custom-scrollbar::-webkit-scrollbar-thumb { background-color: rgba(156,163,175,0.3); border-radius: 3px; }
.custom-scrollbar:hover::-webkit-scrollbar-thumb { background-color: rgba(156,163,175,0.5); }
.custom-scrollbar { -webkit-overflow-scrolling: touch; overscroll-behavior: contain; }
</style>
