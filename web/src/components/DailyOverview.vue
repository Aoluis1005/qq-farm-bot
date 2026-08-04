<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  dailyGifts: any
}>()

const GIFT_ICONS: Record<string, string> = {
  task_claim: 'i-carbon-task-complete',
  email_rewards: 'i-carbon-email',
  mall_free_gifts: 'i-carbon-shopping-bag',
  daily_share: 'i-carbon-share',
  vip_daily_gift: 'i-carbon-star',
  month_card_gift: 'i-carbon-calendar',
}

function getGiftIcon(key: string) { return GIFT_ICONS[key] || 'i-carbon-gift' }

const hasDailyData = computed(() => !!props.dailyGifts)
const gifts = computed(() => props.dailyGifts?.gifts || [])

function formatTime(timestamp: number) {
  if (!timestamp) return '未领取'
  const d = new Date(timestamp)
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
}

function getGiftStatusText(gift: any) {
  if (!gift) return '未知'
  if (gift.key === 'vip_daily_gift' && gift.hasGift === false) return '未开通'
  if (gift.key === 'month_card_gift' && gift.hasCard === false) return '未开通'
  if (gift.doneToday) return '今日已完成'
  if (gift.enabled) return '等待执行'
  return '未开启'
}

function formatGiftSubText(gift: any) {
  if (!gift) return ''
  if (gift.key === 'vip_daily_gift' && gift.hasGift === false) return '未开通QQ会员或无每日礼包'
  if (gift.key === 'month_card_gift' && gift.hasCard === false) return '未购买月卡或已过期'
  const ts = Number(gift.lastAt || 0)
  if (!ts) return ''
  if (gift.doneToday) return `完成时间 ${formatTime(ts)}`
  if (gift.enabled) return `上次执行 ${formatTime(ts)}`
  return `上次检测 ${formatTime(ts)}`
}

function formatGiftProgress(gift: any) {
  if (!gift) return ''
  const total = Number(gift.totalCount || 0)
  const current = Number(gift.completedCount || 0)
  if (!total) return ''
  return `进度：${current}/${total}`
}
</script>

<template>
  <div class="glass-card">
    <div class="card-header">
      <span class="h-icon">🎁</span>
      <span>每日礼包 & 任务</span>
    </div>

    <div v-if="!hasDailyData" class="empty-state">
      <span>请登录账号后查看</span>
    </div>
    <div v-else-if="!gifts.length" class="empty-state">
      <span>暂无每日礼包与任务数据</span>
    </div>
    <div v-else class="daily-grid">
      <div
        v-for="gift in gifts"
        :key="gift.key"
        class="daily-item"
        :class="{ 'item-done': gift.doneToday, 'item-waiting': !gift.doneToday && gift.enabled, 'item-off': !gift.doneToday && !gift.enabled }"
      >
        <div class="item-icon-wrap">
          <div class="item-icon" :class="[getGiftIcon(gift.key)]" />
        </div>
        <div class="item-body">
          <span class="item-label">{{ gift.label }}</span>
          <span class="item-status" :class="gift.doneToday ? 'status-done' : (gift.enabled ? 'status-wait' : 'status-off')">
            {{ getGiftStatusText(gift) }}
          </span>
        </div>
        <div class="item-right">
          <span v-if="formatGiftProgress(gift)" class="item-progress">{{ formatGiftProgress(gift) }}</span>
          <span v-if="formatGiftSubText(gift)" class="item-sub">{{ formatGiftSubText(gift) }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
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

.empty-state {
  padding: 32px 16px;
  text-align: center;
  color: var(--theme-text-secondary);
  font-size: 13px;
}

.daily-grid {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
}

.daily-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px;
  border-radius: 14px;
  border: 1px solid var(--theme-border);
  background: var(--theme-glass);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  transition: all 0.2s;
}

.item-done { border-color: color-mix(in srgb, var(--theme-primary) 20%, transparent); }
.item-waiting { border-color: color-mix(in srgb, #3b82f6 20%, transparent); }
.item-off { opacity: 0.7; }

.item-icon-wrap {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.item-done .item-icon-wrap { background: color-mix(in srgb, var(--theme-primary) 12%, transparent); }
.item-waiting .item-icon-wrap { background: color-mix(in srgb, #3b82f6 12%, transparent); }
.item-off .item-icon-wrap { background: color-mix(in srgb, var(--theme-bg) 40%, transparent); }

.item-icon { font-size: 16px; }
.item-done .item-icon { color: var(--theme-primary); }
.item-waiting .item-icon { color: #3b82f6; }
.item-off .item-icon { color: var(--theme-text-secondary); opacity: 0.5; }

.item-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.item-label { font-size: 13px; font-weight: 600; }
.item-status { font-size: 11px; }
.status-done { color: var(--theme-primary); }
.status-wait { color: #3b82f6; }
.status-off { color: var(--theme-text-secondary); opacity: 0.6; }

.item-right {
  text-align: right;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.item-progress { font-size: 12px; font-weight: 600; color: var(--theme-text); }
.item-sub { font-size: 10px; color: var(--theme-text-secondary); }
</style>
