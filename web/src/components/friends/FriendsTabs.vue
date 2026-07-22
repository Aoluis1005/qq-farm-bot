<script setup lang="ts">
export type FriendTabKey = 'friends' | 'blacklist' | 'visitors' | 'delete'

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
  <div class="mb-4 flex border-b border-gray-200 dark:border-gray-700">
    <button
      v-for="tab in tabs"
      :key="tab.key"
      class="flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors"
      :class="activeTab === tab.key
        ? 'border-b-2'
        : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'"
      :style="{ borderColor: activeTab === tab.key ? 'var(--theme-primary)' : 'transparent', color: activeTab === tab.key ? 'var(--theme-primary)' : undefined }"
      @click="activeTab = tab.key"
    >
      <div :class="tab.icon" />
      {{ tab.label }}
      <span
        v-if="tab.key === 'blacklist' && blacklistCount > 0"
        class="rounded-full bg-red-100 px-1.5 py-0.5 text-xs text-red-600 dark:bg-red-900/30 dark:text-red-400"
      >
        {{ blacklistCount }}
      </span>
    </button>
  </div>
</template>
