<script setup lang="ts">
import type { FriendTabKey } from './FriendsTabs.vue'

defineProps<{
  activeTab: FriendTabKey
  friendsCount: number
  filteredFriendsCount: number
  blacklistCount: number
  interactRecordsCount: number
  filteredInteractRecordsCount: number
}>()

const searchKeyword = defineModel<string>('searchKeyword', { required: true })
</script>

<template>
  <div class="mb-4 flex flex-col gap-3">
    <h2 class="text-2xl font-bold">好友</h2>
    <div v-if="activeTab === 'friends'" class="relative">
      <div class="i-carbon-search absolute left-4 top-1/2 text-gray-400 -translate-y-1/2" />
      <input
        v-model="searchKeyword"
        type="text"
        placeholder="搜索好友..."
        class="w-full rounded-full border border-white/40 bg-[var(--theme-glass)] py-2.5 pl-11 pr-4 text-sm text-gray-700 backdrop-blur-md placeholder-gray-400 focus:border-[var(--theme-primary)] focus:outline-none dark:border-white/10 dark:text-gray-100 dark:placeholder-gray-500"
      >
    </div>
    <div class="flex flex-wrap gap-3 text-sm text-gray-500 dark:text-gray-400">
      <span v-if="activeTab === 'friends' && friendsCount">共 {{ filteredFriendsCount }}/{{ friendsCount }} 名好友</span>
      <span v-if="activeTab === 'blacklist'">共 {{ blacklistCount }} 人</span>
      <span v-if="activeTab === 'visitors' && interactRecordsCount">共 {{ filteredInteractRecordsCount }}/{{ interactRecordsCount }} 条记录</span>
    </div>
  </div>
</template>
