<script setup lang="ts">
import { onMounted } from 'vue'
import MysteryMerchantBanner from '@/components/shop/MysteryMerchantBanner.vue'
import FloatingDock from '@/components/FloatingDock.vue'
import { useAccountStore } from '@/stores/account'

const accountStore = useAccountStore()

onMounted(() => {
  accountStore.fetchAccounts()
})
</script>

<template>
  <div class="w-full flex overflow-hidden bg-gray-50 dark:bg-gray-900" style="height: 100dvh;">
      <main class="relative h-full min-h-0 min-w-0 flex flex-1 flex-col overflow-hidden">
      <div class="min-h-0 flex flex-1 flex-col overflow-hidden">
        <MysteryMerchantBanner />
        <div class="custom-scrollbar min-h-0 flex flex-1 flex-col overflow-y-auto overflow-x-hidden p-3 pb-[calc(5rem+env(safe-area-inset-bottom))] md:p-6 sm:p-4 md:pb-[calc(5.5rem+env(safe-area-inset-bottom))] sm:pb-[calc(5rem+env(safe-area-inset-bottom))]">
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
