<script setup lang="ts">
export type FriendTabKey = 'friends' | 'add' | 'blacklist' | 'visitors' | 'delete'

export interface FriendTabItem {
  key: FriendTabKey
  label: string
  icon: string
}

defineProps<{
  tabs: readonly FriendTabItem[]
  blacklistCount: number
}>()

const activeTab = defineModel<FriendTabKey>('activeTab', { required: true })
</script>

<template>
  <div class="mb-4 flex flex-wrap gap-2">
    <button
      v-for="tab in tabs"
      :key="tab.key"
      class="flex items-center gap-1.5 whitespace-nowrap rounded-[14px] border border-[var(--theme-border)] bg-[var(--theme-glass)] px-3.5 py-[7px] text-xs font-semibold text-[var(--theme-text)] backdrop-blur-[16px] transition-colors"
      :class="activeTab === tab.key
        ? '!border-[var(--theme-primary)] !bg-[var(--theme-primary)] text-white shadow-sm'
        : 'hover:bg-white/20 dark:hover:bg-white/10'"
      @click="activeTab = tab.key"
    >
      <div :class="tab.icon" />
      {{ tab.label }}
      <span
        v-if="tab.key === 'blacklist' && blacklistCount > 0"
        class="rounded-full bg-red-500 px-1.5 py-0.5 text-xs text-white"
      >
        {{ blacklistCount }}
      </span>
    </button>
  </div>
</template>
