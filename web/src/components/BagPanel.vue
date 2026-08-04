<script setup lang="ts">
import { useIntervalFn } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { computed, ref, watch } from 'vue'
import ConfirmModal from '@/components/ConfirmModal.vue'
import { useAccountStore } from '@/stores/account'
import { useBagStore } from '@/stores/bag'
import { useStatusStore } from '@/stores/status'
import { useToastStore } from '@/stores/toast'
import { formatCurrencyAmountByLabel, formatGoldAmount, formatGoldBeanAmount } from '@/utils/number-format'

const accountStore = useAccountStore()
const bagStore = useBagStore()
const statusStore = useStatusStore()
const toastStore = useToastStore()

const { currentAccountId, currentAccount } = storeToRefs(accountStore)
const { items, loading: bagLoading, originalItems } = storeToRefs(bagStore)
const { status, loading: statusLoading, error: statusError, realtimeConnected, currentStatusReady } = storeToRefs(statusStore)

const imageErrors = ref<Record<string | number, boolean>>({})
const bagLoaded = ref(false)

const CATEGORY_OPTIONS = [
  { label: '全部', value: 'all' },
  { label: '果实', value: 'fruit' },
  { label: '种子', value: 'seed' },
  { label: '道具', value: 'tool' },
  { label: '其他', value: 'other' },
] as const

type CategoryValue = typeof CATEGORY_OPTIONS[number]['value']

const selectedCategory = ref<CategoryValue>('fruit')

function getItemCategory(item: any): CategoryValue {
  const itemType = Number(item?.itemType || 0)
  if (itemType === 17 || itemType === 6)
    return 'fruit'
  if (itemType === 5)
    return 'seed'
  if (itemType === 11)
    return 'tool'
  return 'other'
}

const filteredItems = computed(() => {
  if (selectedCategory.value === 'all')
    return items.value
  return items.value.filter((item: any) => getItemCategory(item) === selectedCategory.value)
})

const categoryCounts = computed(() => {
  const counts: Record<CategoryValue, number> = { all: items.value.length, fruit: 0, seed: 0, tool: 0, other: 0 }
  for (const item of items.value) {
    const cat = getItemCategory(item)
    counts[cat]++
  }
  return counts
})

const confirmModal = ref({
  show: false,
  title: '',
  message: '',
  type: 'primary' as 'primary' | 'danger',
  loading: false,
  action: '' as 'sell' | 'use' | 'batchSell',
  item: null as any,
  selectedItems: [] as any[],
})

const batchMode = ref(false)
const selectedForBatch = ref<Set<number>>(new Set())
const batchSellResult = ref<{ gold: number, goldBean: number } | null>(null)

const selectedSellableCount = computed(() => {
  return selectedForBatch.value.size
})

function getPriceClass(item: any) {
  const priceId = Number(item?.priceId || 0)
  if (priceId === 1005)
    return 'text-amber-400 dark:text-amber-300'
  if (priceId === 1002)
    return 'text-sky-400 dark:text-sky-300'
  return 'text-gray-400'
}

function canSell(item: any) {
  const itemType = Number(item?.itemType || 0)
  return itemType === 17 || itemType === 6
}

function canBatchSell(item: any) {
  return canSell(item) && Number(item.count || 0) > 0
}

function canUse(item: any) {
  const itemType = Number(item?.itemType || 0)
  return itemType === 11
}

function handleSellClick(item: any) {
  if (batchMode.value) {
    const isSelected = selectedForBatch.value.has(Number(item.id))
    if (isSelected) {
      selectedForBatch.value.delete(Number(item.id))
    }
    else {
      selectedForBatch.value.add(Number(item.id))
    }
    return
  }
  const totalPrice = (Number(item.count) || 0) * (Number(item.price) || 0)
  const priceUnit = item.priceUnit || '金'
  const messages = [
    `确定要出售全部${item.name || `物品${item.id}`}吗?`,
    `数量：${item.count || 0}`,
  ]
  if (totalPrice > 0) {
    messages.push(`售出总金币：${formatCurrencyAmountByLabel(totalPrice, priceUnit)}${priceUnit}`)
  }
  confirmModal.value = {
    show: true,
    title: '确认出售',
    message: messages.join('\n'),
    type: 'danger',
    loading: false,
    action: 'sell',
    item,
    selectedItems: [],
  }
}

function handleUseClick(item: any) {
  confirmModal.value = {
    show: true,
    title: '确认使用',
    message: `确定要使用全部 ${item.name || `物品${item.id}`} 吗?\n数量：${item.count || 0}`,
    type: 'primary',
    loading: false,
    action: 'use',
    item,
    selectedItems: [],
  }
}

async function handleConfirm() {
  const { action, item, selectedItems } = confirmModal.value
  if (!currentAccountId.value)
    return

  confirmModal.value.loading = true
  try {
    if (action === 'sell' && item) {
      const sellItems = originalItems.value
        .filter((it: any) => Number(it.id) === Number(item.id))
        .map((it: any) => ({ id: it.id, count: it.count, uid: it.uid || 0 }))

      if (sellItems.length === 0) {
        toastStore.error('未找到可出售的物品')
        return
      }

      const res = await bagStore.sellItems(currentAccountId.value, sellItems)
      if (res.ok) {
        toastStore.success(`已出售 ${item.name || `物品${item.id}`}`)
        await loadBag()
      }
      else {
        toastStore.error(`出售失败: ${res.error || '未知错误'}`)
      }
    }
    else if (action === 'batchSell' && selectedItems) {
      const itemsToSell = originalItems.value
        .filter((it: any) => selectedItems.some((si: any) => Number(si.id) === Number(it.id)))
        .map((it: any) => ({ id: it.id, count: it.count, uid: it.uid || 0 }))

      if (itemsToSell.length === 0) {
        toastStore.error('未找到可出售的物品')
        return
      }

      const res = await bagStore.sellItems(currentAccountId.value, itemsToSell)
      if (res.ok) {
        let totalGold = 0
        let totalGoldBean = 0
        for (const si of selectedItems) {
          const fi = filteredItems.value.find((f: any) => Number(f.id) === Number(si.id))
          if (fi) {
            const price = Number(fi.price) || 0
            const count = Number(fi.count) || 0
            const priceId = Number(fi.priceId) || 0
            if (priceId === 1005) {
              totalGoldBean += price * count
            }
            else {
              totalGold += price * count
            }
          }
        }
        batchSellResult.value = { gold: totalGold, goldBean: totalGoldBean }
        toastStore.success(`已批量出售 ${selectedItems.length} 种物品，获得 ${formatGoldAmount(totalGold)} 金币, ${formatGoldBeanAmount(totalGoldBean)} 金豆豆`)
        selectedForBatch.value.clear()
        batchMode.value = false
        await loadBag()
      }
      else {
        toastStore.error(`批量出售失败: ${res.error || '未知错误'}`)
      }
    }
    else if (action === 'use' && item) {
      const res = await bagStore.useItem(currentAccountId.value, Number(item.id), Number(item.count || 1))
      if (res.ok) {
        toastStore.success(`已使用 ${item.name || `物品${item.id}`}`)
        await loadBag()
      }
      else {
        toastStore.error(`使用失败: ${res.error || '未知错误'}`)
      }
    }
  }
  catch (e: any) {
    toastStore.error(`操作失败: ${e.message || '未知错误'}`)
  }
  finally {
    confirmModal.value.loading = false
    confirmModal.value.show = false
  }
}

function handleCancel() {
  confirmModal.value.show = false
}

function toggleBatchMode() {
  batchMode.value = !batchMode.value
  if (!batchMode.value) {
    selectedForBatch.value.clear()
    batchSellResult.value = null
  }
}

function selectAllSellable() {
  selectedForBatch.value.clear()
  for (const item of filteredItems.value) {
    if (canBatchSell(item)) {
      selectedForBatch.value.add(Number(item.id))
    }
  }
}

function handleBatchSellClick() {
  const sellableItems = filteredItems.value.filter((item: any) => canBatchSell(item))
  if (sellableItems.length === 0) {
    toastStore.warning('没有可批量出售的物品')
    return
  }
  const selectedList = Array.from(selectedForBatch.value)
  if (selectedList.length === 0) {
    toastStore.warning('请先选择要出售的物品')
    return
  }

  const itemsToSell = originalItems.value
    .filter((it: any) => selectedList.includes(Number(it.id)))
    .map((it: any) => ({ id: it.id, count: it.count, uid: it.uid || 0 }))

  let totalGold = 0
  let totalGoldBean = 0
  for (const it of itemsToSell) {
    const item = filteredItems.value.find((f: any) => Number(f.id) === Number(it.id))
    if (item) {
      const price = Number(item.price) || 0
      const count = Number(item.count) || 0
      const priceId = Number(item.priceId) || 0
      if (priceId === 1005) {
        totalGoldBean += price * count
      }
      else {
        totalGold += price * count
      }
    }
  }

  const messages = [
    `确定要批量出售选中的 ${selectedList.length} 种物品吗?`,
  ]
  if (totalGold > 0) {
    messages.push(`金币：${formatGoldAmount(totalGold)}`)
  }
  if (totalGoldBean > 0) {
    messages.push(`金豆豆：${formatGoldBeanAmount(totalGoldBean)}`)
  }

  confirmModal.value = {
    show: true,
    title: '批量出售',
    message: messages.join('\n'),
    type: 'danger',
    loading: false,
    action: 'batchSell',
    item: null,
    selectedItems: itemsToSell,
  }
}

async function loadBag() {
  if (!currentAccountId.value)
    return

  const acc = currentAccount.value
  if (!acc)
    return

  try {
    if (!realtimeConnected.value)
      await statusStore.fetchStatus(currentAccountId.value)

    if (acc.running)
      await bagStore.fetchBag(currentAccountId.value)
  }
  finally {
    bagLoaded.value = true
  }

  imageErrors.value = {}
}

const showInitialLoading = computed(() =>
  !bagLoaded.value && (bagLoading.value || statusLoading.value),
)

watch(currentAccountId, (newId, oldId) => {
  if (oldId !== undefined && newId !== oldId) {
    bagLoaded.value = false
    bagStore.clearBag()
    statusStore.clearAccountScopedData()
  }
  loadBag()
}, { immediate: true })

watch(() => currentAccount.value?.running, () => {
  loadBag()
})

useIntervalFn(loadBag, 60000)
</script>

<template>
  <div class="space-y-4">
    <div class="mb-4 flex items-center justify-between">
      <h2 class="flex items-center gap-2 text-2xl font-bold">
        <div class="i-carbon-inventory-management" />
        背包
      </h2>
      <div v-if="items.length" class="text-sm text-gray-500">
        共 {{ items.length }} 种物品
      </div>
    </div>

    <div v-if="showInitialLoading" class="flex justify-center py-12">
      <div class="i-svg-spinners-90-ring-with-bg text-4xl text-blue-500" />
    </div>

    <div v-else-if="!currentAccountId" class="rounded-lg bg-white p-8 text-center text-gray-500 shadow dark:bg-gray-800">
      请选择账号后查看背包
    </div>

    <div v-else-if="statusError && items.length === 0" class="border border-red-200 rounded-lg bg-red-50 p-8 text-center text-red-500 shadow dark:border-red-800 dark:bg-red-900/20">
      <div class="mb-2 text-lg font-bold">
        获取数据失败
      </div>
      <div class="text-sm">
        {{ statusError }}
      </div>
    </div>

    <div v-else-if="currentStatusReady && !status?.connection?.connected && items.length === 0" class="flex flex-col items-center justify-center gap-4 rounded-lg bg-white p-12 text-center text-gray-500 shadow dark:bg-gray-800">
      <div class="i-carbon-connection-signal-off text-4xl text-gray-400" />
      <div>
        <div class="text-lg text-gray-700 font-medium dark:text-gray-300">
          账号未登录
        </div>
        <div class="mt-1 text-sm text-gray-400">
          请先运行账号或检查网络连接
        </div>
      </div>
    </div>

    <div v-else-if="items.length === 0" class="rounded-lg bg-white p-8 text-center text-gray-500 shadow dark:bg-gray-800">
      无可展示物品
    </div>

    <div v-else>
      <div class="mb-4 flex flex-wrap items-center gap-2">
        <button
          v-for="cat in CATEGORY_OPTIONS"
          :key="cat.value"
          class="whitespace-nowrap rounded-[14px] border border-[var(--theme-border)] bg-[var(--theme-glass)] px-3.5 py-[7px] text-xs font-semibold text-[var(--theme-text)] backdrop-blur-[16px] transition-colors"
          :class="selectedCategory === cat.value
            ? '!border-[var(--theme-primary)] !bg-[var(--theme-primary)] text-white'
            : 'hover:bg-white/20 dark:hover:bg-white/10'"
          @click="selectedCategory = cat.value"
        >
          {{ cat.label }}
          <span class="ml-1 text-xs opacity-70">({{ categoryCounts[cat.value] || 0 }})</span>
        </button>

        <div class="flex-1" />

        <template v-if="selectedCategory === 'fruit' || selectedCategory === 'all'">
          <button
            class="whitespace-nowrap rounded-[14px] border border-[var(--theme-border)] bg-[var(--theme-glass)] px-3.5 py-[7px] text-xs font-semibold text-[var(--theme-text)] backdrop-blur-[16px] transition-colors"
            :class="batchMode
              ? 'bg-orange-500 text-white dark:bg-orange-600'
              : 'hover:bg-white/20 dark:hover:bg-white/10'"
            @click="toggleBatchMode"
          >
            <div v-if="batchMode" class="i-carbon-close mr-1 inline-block" />
            {{ batchMode ? '取消批量' : '批量出售' }}
          </button>
          <template v-if="batchMode">
            <button
              class="whitespace-nowrap rounded-[14px] border border-blue-500 bg-blue-500 px-3.5 py-[7px] text-xs font-semibold text-white transition-colors dark:bg-blue-600"
              @click="selectAllSellable"
            >
              全选
            </button>
            <button
              class="whitespace-nowrap rounded-[14px] border border-[var(--theme-border)] bg-[var(--theme-glass)] px-3.5 py-[7px] text-xs font-semibold text-[var(--theme-text)] backdrop-blur-[16px] transition-colors"
              :class="selectedSellableCount > 0
                ? 'bg-red-500 text-white hover:bg-red-600 dark:bg-red-600 dark:hover:bg-red-700'
                : 'opacity-60'"
              :disabled="selectedSellableCount === 0"
              @click="handleBatchSellClick"
            >
              出售 ({{ selectedSellableCount }})
            </button>
          </template>
        </template>
      </div>

      <div class="grid grid-cols-2 gap-4 lg:grid-cols-5 md:grid-cols-4 sm:grid-cols-3 xl:grid-cols-6">
        <div
          v-for="item in filteredItems"
          :key="item.id"
          class="group relative flex flex-col items-center border rounded-lg bg-white p-3 transition dark:border-gray-700 dark:bg-gray-800 hover:shadow-md"
          :class="{
            'ring-2 ring-orange-500 dark:ring-orange-400': batchMode && selectedForBatch.has(Number(item.id)),
            'opacity-50': batchMode && canBatchSell(item) && !selectedForBatch.has(Number(item.id)),
          }"
          @click="batchMode && canBatchSell(item) && handleSellClick(item)"
        >
          <div class="absolute left-2 top-2 text-xs text-gray-400 font-mono">
            #{{ item.id }}
          </div>

          <div class="absolute right-1 top-1 flex gap-1">
            <template v-if="!batchMode">
              <button
                v-if="canSell(item)"
                class="rounded bg-red-500 px-1.5 py-0.5 text-[10px] text-white opacity-70 transition dark:bg-red-600 hover:opacity-100"
                title="出售全部"
                @click.stop="handleSellClick(item)"
              >
                售
              </button>
              <button
                v-if="canUse(item)"
                class="rounded bg-green-500 px-1.5 py-0.5 text-[10px] text-white opacity-70 transition dark:bg-green-600 hover:opacity-100"
                title="使用全部"
                @click.stop="handleUseClick(item)"
              >
                用
              </button>
            </template>
            <div
              v-else-if="canBatchSell(item)"
              class="h-5 w-5 flex items-center justify-center border-2 rounded transition"
              :class="selectedForBatch.has(Number(item.id))
                ? 'border-orange-500 bg-orange-500 text-white'
                : 'border-gray-300 bg-white dark:border-gray-600 dark:bg-gray-700'"
            >
              <div v-if="selectedForBatch.has(Number(item.id))" class="i-carbon-checkmark text-xs" />
            </div>
          </div>

          <div
            class="thumb-wrap mb-2 mt-6 h-16 w-16 flex items-center justify-center rounded-full bg-gray-50 dark:bg-gray-700/50"
            :data-fallback="(item.name || '物').slice(0, 1)"
          >
            <img
              v-if="item.image && !imageErrors[item.id]"
              :src="item.image"
              :alt="item.name"
              class="max-h-full max-w-full object-contain"
              loading="lazy"
              @error="imageErrors[item.id] = true"
            >
            <div v-else class="text-2xl text-gray-400 font-bold uppercase">
              {{ (item.name || '物').slice(0, 1) }}
            </div>
          </div>

          <div class="mb-1 w-full truncate px-2 text-center text-sm font-bold" :title="item.name">
            {{ item.name || `物品${item.id}` }}
          </div>

          <div class="mb-2 flex flex-col items-center gap-0.5 text-xs text-gray-400">
            <span v-if="item.uid">UID: {{ item.uid }}</span>
            <span>
              类型: {{ item.itemType || 0 }}
              <span v-if="item.level > 0"> · Lv{{ item.level }}</span>
              <span v-if="item.price > 0" :class="getPriceClass(item)"> · {{ item.price }}{{ item.priceUnit || '金' }}</span>
            </span>
          </div>

          <div class="mt-auto font-medium" :class="item.hoursText ? 'text-blue-500' : 'text-gray-600 dark:text-gray-300'">
            {{ item.hoursText || `x${item.count || 0}` }}
          </div>
        </div>
      </div>
    </div>

    <ConfirmModal
      :show="confirmModal.show"
      :title="confirmModal.title"
      :message="confirmModal.message"
      :type="confirmModal.type"
      :loading="confirmModal.loading"
      :confirm-text="confirmModal.action === 'sell' ? '确认出售' : confirmModal.action === 'batchSell' ? '确认出售' : '确认使用'"
      @confirm="handleConfirm"
      @close="handleCancel"
      @cancel="handleCancel"
    />
  </div>
</template>

<style scoped>
.thumb-wrap.fallback img {
  display: none;
}

.thumb-wrap.fallback::after {
  content: attr(data-fallback);
  font-size: 1.5rem;
  font-weight: bold;
  color: #9ca3af;
  text-transform: uppercase;
}
</style>
