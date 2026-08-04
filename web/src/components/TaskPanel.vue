<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed, watch } from 'vue'
import DailyOverview from '@/components/DailyOverview.vue'
import { useAccountStore } from '@/stores/account'
import { useStatusStore } from '@/stores/status'

const statusStore = useStatusStore()
const accountStore = useAccountStore()
const { status, dailyGifts, realtimeConnected, currentStatusReady } = storeToRefs(statusStore)
const { currentAccountId, currentAccount } = storeToRefs(accountStore)

const growth = computed(() => dailyGifts.value?.growth || null)

async function refresh() {
  if (currentAccountId.value) {
    const acc = currentAccount.value
    if (!acc) return
    if (!realtimeConnected.value) {
      await statusStore.fetchStatus(currentAccountId.value)
    }
    if (acc.running) {
      statusStore.fetchDailyGifts(currentAccountId.value)
    }
  }
}

watch(currentAccountId, (newId, oldId) => {
  if (oldId !== undefined && newId !== oldId)
    statusStore.clearAccountScopedData()
  refresh()
}, { immediate: true })

watch(() => currentAccount.value?.running, () => { refresh() })

function formatTaskProgress(task: any) {
  if (!task) return '未开始'
  const rawCurrent = task.progress ?? task.current
  const rawTarget = task.totalProgress ?? task.target
  const current = Number.isFinite(rawCurrent) ? rawCurrent : (rawCurrent ? Number(rawCurrent) || 0 : 0)
  const target = Number.isFinite(rawTarget) ? rawTarget : (rawTarget ? Number(rawTarget) || 0 : 0)
  if (!current && !target) return '未开始'
  if (target && current >= target) return '已完成'
  return `进度：${current}/${target}`
}
</script>

<template>
  <div class="task-panel">
    <DailyOverview :daily-gifts="dailyGifts" />

    <!-- 成长任务 -->
    <div class="glass-card">
      <div class="card-header">
        <span class="h-icon">🌱</span>
        <span>成长任务</span>
        <span
          v-if="growth"
          class="h-badge"
          :class="growth.doneToday ? 'badge-done' : 'badge-progress'"
        >
          {{ growth.doneToday ? '今日已完成' : `${growth.completedCount}/${growth.totalCount}` }}
        </span>
      </div>

      <div v-if="!currentAccountId" class="empty-state">
        <span class="empty-icon">👤</span>
        <span>未登录账号</span>
        <span class="empty-sub">请先添加农场账号</span>
      </div>

      <div v-else-if="growth && growth.tasks && growth.tasks.length" class="task-list">
        <div v-for="(task, idx) in growth.tasks" :key="idx" class="task-row">
          <span class="task-label">{{ task.desc || task.name }}</span>
          <span class="task-progress">{{ formatTaskProgress(task) }}</span>
        </div>
      </div>

      <div v-else-if="currentStatusReady && !status?.connection?.connected" class="empty-state">
        <span class="empty-icon">📡</span>
        <span>账号未登录</span>
        <span class="empty-sub">请先运行账号或检查网络连接</span>
      </div>

      <div v-else class="empty-state">
        <span class="empty-icon">📋</span>
        <span>暂无任务详情</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.task-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.glass-card {
  border-radius: 16px;
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  background: var(--theme-glass);
  border: 1px solid var(--theme-border);
  overflow: hidden;
}

.card-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--theme-border);
  font-size: 14px;
  font-weight: 600;
}

.h-icon { font-size: 18px; line-height: 1; }

.h-badge {
  margin-left: auto;
  padding: 2px 10px;
  border-radius: 12px;
  font-size: 11px;
  font-weight: 600;
}
.badge-done {
  background: color-mix(in srgb, var(--theme-primary) 12%, transparent);
  color: var(--theme-primary);
}
.badge-progress {
  background: color-mix(in srgb, #3b82f6 12%, transparent);
  color: #3b82f6;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 32px 16px;
  color: var(--theme-text-secondary);
  font-size: 13px;
}
.empty-icon { font-size: 28px; opacity: 0.3; }
.empty-sub { font-size: 11px; opacity: 0.6; }

.task-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
}
.task-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px;
  font-size: 13px;
  border-radius: 14px;
  border: 1px solid var(--theme-border);
  background: var(--theme-glass);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}
.task-label { color: var(--theme-text); }
.task-progress { color: var(--theme-text-secondary); font-size: 12px; }
</style>
