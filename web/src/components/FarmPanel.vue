<script setup lang="ts">
import { useIntervalFn } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { computed, onUnmounted, ref, watch } from 'vue'
import ConfirmModal from '@/components/ConfirmModal.vue'
import LandCard from '@/components/LandCard.vue'
import { useAccountStore } from '@/stores/account'
import { useFarmStore } from '@/stores/farm'
import { useStatusStore } from '@/stores/status'

const farmStore = useFarmStore()
const accountStore = useAccountStore()
const statusStore = useStatusStore()
const { lands, summary, loading } = storeToRefs(farmStore)
const { currentAccountId, currentAccount } = storeToRefs(accountStore)
const { status, loading: statusLoading, realtimeConnected, currentStatusReady } = storeToRefs(statusStore)

const operating = ref(false)
const farmLoaded = ref(false)
const confirmVisible = ref(false)
type PendingLandAction = 'fertilize' | 'remove'

const confirmConfig = ref({
  title: '',
  message: '',
  opType: '',
  bulkAction: '' as 'removeAll' | '',
  landAction: '' as PendingLandAction | '',
  land: null as any | null,
  type: 'primary' as 'primary' | 'danger',
})

async function executeOperate() {
  if (!currentAccountId.value) return
  const config = confirmConfig.value
  if (!config.opType && !config.bulkAction && (!config.landAction || !config.land)) return
  confirmVisible.value = false
  operating.value = true
  try {
    if (config.opType) await farmStore.operate(currentAccountId.value, config.opType)
    else if (config.bulkAction === 'removeAll') await farmStore.removeAllPlants(currentAccountId.value)
    else if (config.landAction === 'fertilize') await farmStore.fertilizeLand(currentAccountId.value, Number(config.land.id))
    else if (config.landAction === 'remove') await farmStore.removePlant(currentAccountId.value, Number(config.land.id))
  }
  finally { operating.value = false }
}

function handleOperate(opType: string) {
  if (!currentAccountId.value) return
  const confirmMap: Record<string, string> = {
    harvest: '确定要收获所有成熟作物吗？',
    clear: '确定要执行一键务农吗？将自动浇水、除草、除虫。',
    plant: '确定要一键种植吗？(根据策略配置)',
    upgrade: '确定要升级所有可升级的土地吗？(消耗金币)',
    all: '确定要执行一键全收吗？将依次执行收获、务农、种植与升级。',
  }
  confirmConfig.value = {
    title: '确认操作',
    message: confirmMap[opType] || '确定执行此操作吗？',
    opType, bulkAction: '', landAction: '', land: null, type: 'primary',
  }
  confirmVisible.value = true
}

function handleRemoveAllPlants() {
  if (!currentAccountId.value) return
  confirmConfig.value = {
    title: '确认一键铲除',
    message: '确定要铲除全部已种植作物吗？此操作不可恢复。',
    opType: '', bulkAction: 'removeAll', landAction: '', land: null, type: 'danger',
  }
  confirmVisible.value = true
}

function getLandActionName(land: any) { return `#${land?.id ?? '-'} ${land?.plantName || '该作物'}` }

function handleLandFertilize(land: any) {
  if (!currentAccountId.value) return
  confirmConfig.value = {
    title: '确认催熟',
    message: `确定要对 ${getLandActionName(land)} 使用有机肥料催熟吗？`,
    opType: '', bulkAction: '', landAction: 'fertilize', land, type: 'primary',
  }
  confirmVisible.value = true
}

function handleLandRemove(land: any) {
  if (!currentAccountId.value) return
  confirmConfig.value = {
    title: '确认铲除',
    message: `确定要铲除 ${getLandActionName(land)} 吗？此操作不可恢复。`,
    opType: '', bulkAction: '', landAction: 'remove', land, type: 'danger',
  }
  confirmVisible.value = true
}

const operations = [
  { type: 'harvest', label: '收获', icon: 'i-carbon-wheat' },
  { type: 'clear', label: '一键务农', icon: 'i-carbon-clean' },
  { type: 'plant', label: '种植', icon: 'i-carbon-sprout' },
  { type: 'upgrade', label: '升级土地', icon: 'i-carbon-upgrade' },
  { type: 'all', label: '一键全收', icon: 'i-carbon-flash' },
]

async function refresh() {
  if (currentAccountId.value) {
    const acc = currentAccount.value
    if (!acc) return
    try {
      if (!realtimeConnected.value) await statusStore.fetchStatus(currentAccountId.value)
      if (acc.running) await farmStore.fetchLands(currentAccountId.value)
    }
    finally { farmLoaded.value = true }
  }
}

const showInitialLoading = computed(() => !farmLoaded.value && (loading.value || statusLoading.value))

watch(currentAccountId, (newId, oldId) => {
  if (oldId !== undefined && newId !== oldId) {
    farmLoaded.value = false
    farmStore.clearFarmData()
    statusStore.clearAccountScopedData()
  }
  refresh()
}, { immediate: true })

watch(() => currentAccount.value?.running, () => { refresh() })

const { pause, resume } = useIntervalFn(() => {
  if (lands.value) lands.value = lands.value.map((l: any) =>
    l.matureInSec > 0 ? { ...l, matureInSec: l.matureInSec - 1 } : l,
  )
}, 1000)

const { pause: pauseRefresh, resume: resumeRefresh } = useIntervalFn(refresh, 60000)
resume()
resumeRefresh()
onUnmounted(() => { pause(); pauseRefresh() })
</script>

<template>
  <div class="farm-panel">
    <!-- 功能按钮横排 -->
    <div class="farm-actions">
      <button
        v-for="op in operations"
        :key="op.type"
        class="act-btn"
        :class="'act-' + op.type"
        :disabled="operating"
        @click="handleOperate(op.type)"
      >
        <div :class="op.icon" class="act-icon" />
        <span>{{ op.label }}</span>
      </button>
      <button
        class="act-btn act-remove"
        :disabled="operating"
        @click="handleRemoveAllPlants"
      >
        <div class="i-carbon-trash-can act-icon" />
        <span>一键铲除</span>
      </button>
    </div>

    <!-- 统计 -->
    <div class="farm-stats">
      <div class="stat-item stat-harvest">
        <div class="stat-val">{{ summary?.harvestable || 0 }}</div>
        <div class="stat-lbl">可收</div>
      </div>
      <div class="stat-item stat-growing">
        <div class="stat-val">{{ summary?.growing || 0 }}</div>
        <div class="stat-lbl">生长</div>
      </div>
      <div class="stat-item stat-empty">
        <div class="stat-val">{{ summary?.empty || 0 }}</div>
        <div class="stat-lbl">空闲</div>
      </div>
      <div class="stat-item stat-dead">
        <div class="stat-val">{{ summary?.dead || 0 }}</div>
        <div class="stat-lbl">枯萎</div>
      </div>
    </div>

    <!-- 加载 -->
    <div v-if="showInitialLoading" class="farm-loading">
      <div class="i-svg-spinners-90-ring-with-bg text-3xl" :style="{ color: 'var(--theme-primary)' }" />
    </div>

    <!-- 未登录 -->
    <div v-else-if="!currentAccountId" class="farm-empty">
      <div class="i-carbon-user-offline text-4xl opacity-20" />
      <div class="empty-text">未登录账号</div>
    </div>

    <!-- 无数据 -->
    <div v-else-if="!lands || lands.length === 0" class="farm-empty">
      <div class="empty-text">暂无土地数据</div>
    </div>

    <!-- 未连接 -->
    <div v-else-if="currentStatusReady && !status?.connection?.connected" class="farm-empty">
      <div class="i-carbon-connection-signal-off text-4xl opacity-20" />
      <div class="empty-text">账号未登录</div>
      <div class="empty-sub">请先运行账号或检查网络连接</div>
    </div>

    <!-- 土地网格 -->
    <div v-else class="land-grid">
      <LandCard
        v-for="land in lands"
        :key="land.id"
        :land="land"
        @fertilize="handleLandFertilize"
        @remove="handleLandRemove"
      />
    </div>

    <ConfirmModal
      :show="confirmVisible"
      :title="confirmConfig.title"
      :message="confirmConfig.message"
      :type="confirmConfig.type"
      @confirm="executeOperate"
      @close="confirmVisible = false"
      @cancel="confirmVisible = false"
    />
  </div>
</template>

<style scoped>
.farm-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* ===== 功能按钮 ===== */
.farm-actions {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  scrollbar-width: none;
  -webkit-overflow-scrolling: touch;
  padding-bottom: 2px;
}
.farm-actions::-webkit-scrollbar { display: none; }

.act-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 7px 14px;
  border-radius: 14px;
  border: 1px solid var(--theme-border);
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
  font-size: 12px;
  font-weight: 600;
  font-family: inherit;
  background: var(--theme-glass);
  color: var(--theme-text);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  transition: all 0.2s;
  user-select: none;
}
.act-btn:active { transform: scale(0.94); }
.act-btn:disabled { opacity: 0.4; cursor: not-allowed; transform: none; }

.act-icon { font-size: 15px; line-height: 1; }

.act-harvest { background: color-mix(in srgb, var(--theme-accent) 8%, transparent); border-color: color-mix(in srgb, var(--theme-accent) 18%, transparent); color: var(--theme-accent); }
.act-clear { background: color-mix(in srgb, #14b8a6 8%, transparent); border-color: color-mix(in srgb, #14b8a6 18%, transparent); color: #14b8a6; }
.act-plant { background: color-mix(in srgb, var(--theme-primary) 8%, transparent); border-color: color-mix(in srgb, var(--theme-primary) 18%, transparent); color: var(--theme-primary); }
.act-upgrade { background: color-mix(in srgb, #a78bfa 8%, transparent); border-color: color-mix(in srgb, #a78bfa 18%, transparent); color: #a78bfa; }
.act-all { background: color-mix(in srgb, #fb923c 8%, transparent); border-color: color-mix(in srgb, #fb923c 18%, transparent); color: #fb923c; }
.act-remove { background: color-mix(in srgb, #ef4444 8%, transparent); border-color: color-mix(in srgb, #ef4444 18%, transparent); color: #f87171; }

/* ===== 统计 ===== */
.farm-stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}
.stat-item {
  padding: 10px 4px;
  border-radius: 14px;
  border: 1px solid var(--theme-border);
  text-align: center;
  background: var(--theme-glass);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
}
.stat-val { font-size: 20px; font-weight: 700; line-height: 1.2; }
.stat-lbl { font-size: 10px; color: var(--theme-text-secondary); margin-top: 1px; }
.stat-harvest .stat-val { color: var(--theme-accent); }
.stat-growing .stat-val { color: var(--theme-primary); }
.stat-empty .stat-val { color: var(--theme-text-secondary); opacity: 0.5; }
.stat-dead .stat-val { color: #ef4444; opacity: 0.8; }

/* ===== 土地网格 ===== */
.land-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
}
@media (max-width: 480px) { .land-grid { grid-template-columns: repeat(3, 1fr); gap: 8px; } }

/* ===== 空/加载状态 ===== */
.farm-loading, .farm-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 0;
  gap: 8px;
}
.empty-text { font-size: 14px; color: var(--theme-text-secondary); }
.empty-sub { font-size: 12px; color: var(--theme-text-secondary); opacity: 0.6; }
</style>
