<script setup lang="ts">
export type AdminTabKey = 'card' | 'user' | 'log' | 'system'

export interface AdminTabItem {
  key: AdminTabKey
  label: string
  icon: string
}

defineProps<{
  tabs: readonly AdminTabItem[]
}>()

const activeTab = defineModel<AdminTabKey>('activeTab', { required: true })
</script>

<template>
  <div class="min-w-0 max-w-full border border-gray-200 rounded-lg bg-white shadow dark:border-gray-700 dark:bg-gray-800">
    <div class="border-b border-gray-200 dark:border-gray-700">
      <nav class="flex flex-wrap gap-1 p-2">
        <button
          v-for="tab in tabs"
          :key="tab.key"
          class="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all"
          :class="activeTab === tab.key
            ? 'text-white shadow-sm'
            : 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700'"
          :style="activeTab === tab.key ? { backgroundColor: 'var(--theme-primary)' } : {}"
          @click="activeTab = tab.key"
        >
          <div :class="tab.icon" />
          {{ tab.label }}
        </button>
      </nav>
    </div>

    <div class="p-4">
      <slot />
    </div>
  </div>
</template>
