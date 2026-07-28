<script setup lang="ts">
import { onMounted, computed } from 'vue'
import { useAccountStore } from '@/stores/account'
import { useStatusStore } from '@/stores/status'
import { useIllustratedStore } from '@/stores/illustrated'
import { storeToRefs } from 'pinia'

const props = defineProps<{ show: boolean }>()
const emit = defineEmits<{ close: [] }>()

const statusStore = useStatusStore()
const accountStore = useAccountStore()

const { status } = storeToRefs(statusStore)

// 图鉴数据：作物收获统计
const illustratedStore = useIllustratedStore()
const { items: illustratedItems, loading } = storeToRefs(illustratedStore)

const sortedItems = computed(() =>
  [...illustratedItems.value]
    .filter((i: any) => (i.harvestCount || 0) > 0)
    .sort((a: any, b: any) => (b.harvestCount || 0) - (a.harvestCount || 0))
)

const totalHarvestCount = computed(() =>
  sortedItems.value.reduce((s: number, i: any) => s + (i.harvestCount || 0), 0)
)

// 角色编号: gid
const roleId = computed(() => status.value?.status?.gid || "")

async function fetchIllustratedData() {
  const accId = String(accountStore.currentAccountId || "").trim()
  if (accId) {
    await illustratedStore.fetchList(accId, false, 1);
    console.log("[Career] items after fetch:", illustratedItems.value.length);
  }
}

onMounted(() => {
  if (props.show) fetchIllustratedData()
})

// 格式化收获数
function fmtHarvest(n: number) {
  if (n >= 10000) return (n / 10000).toFixed(1) + '万'
  return String(n)
}
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="show" class="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm" @click.self="emit('close')">
        <div class="relative mx-4 w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl dark:bg-gray-800" @click.stop>
          <!-- 关闭按钮 -->
          <button class="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700" @click="emit('close')">
            <div class="i-carbon-close text-lg" />
          </button>

          <!-- 标题 -->
          <h2 class="mb-4 text-center text-lg font-bold text-gray-800 dark:text-gray-100">生涯统计</h2>

          <!-- 玩家信息 -->
          <div class="mb-4 text-center">
            <div class="text-xl font-bold text-gray-900 dark:text-gray-100">{{ status?.status?.name || '未知' }}</div>
            <div class="mt-1 text-xs text-gray-400">
              Lv.{{ status?.status?.level || 0 }} · 经验 {{ status?.levelProgress?.current || 0 }}/{{ status?.levelProgress?.needed || '?' }}
            </div>
            <div class="mt-0.5 text-xs text-gray-400">
              角色编号: {{ roleId }}
            </div>
          </div>

          <!-- 生涯摘要 -->
          <div class="mb-4 flex gap-3">
            <div class="flex flex-1 flex-col items-center rounded-xl bg-blue-50 py-3 dark:bg-blue-900/20">
              <div class="text-lg font-bold text-blue-600 dark:text-blue-400">{{ totalHarvestCount >= 10000 ? (totalHarvestCount / 10000).toFixed(1) + '万' : totalHarvestCount }}</div>
              <div class="mt-0.5 text-xs text-gray-500">历史累计收获</div>
            </div>
            <div class="flex flex-1 flex-col items-center rounded-xl bg-orange-50 py-3 dark:bg-orange-900/20">
              <div class="text-lg font-bold text-orange-600 dark:text-orange-400">0</div>
              <div class="mt-0.5 text-xs text-gray-500">累计摘取好友作物</div>
            </div>
          </div>

          <!-- 加载 -->
          <div v-if="loading" class="py-6 text-center text-sm text-gray-400">加载中...</div>

          <!-- 作物收获排行 -->
          <div v-else-if="illustratedItems.length > 0">
            <div class="mb-2 text-xs font-semibold text-gray-500">作物收获排行</div>
            <div class="flex flex-col gap-1.5">
              <div
                v-for="item in sortedItems.slice(0, 30)"
                :key="item.seedId"
                class="flex items-center rounded-lg bg-gray-50 px-3 py-2 dark:bg-gray-700/50"
              >
                <div class="flex-1 text-sm font-medium text-gray-700 dark:text-gray-200">
                  #{{ item.seedId }}
                </div>
                <div class="text-sm font-bold text-gray-900 dark:text-gray-100">
                  {{ fmtHarvest(item.harvestCount || 0) }}
                </div>
              </div>
            </div>
            <div v-if="illustratedItems.length > 30" class="mt-2 text-center text-xs text-gray-400">
              还有 {{ illustratedItems.length - 30 }} 种作物...
            </div>
          </div>

          <div v-else class="py-6 text-center text-sm text-gray-400">
            暂无数据
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.fade-enter-active, .fade-leave-active { transition: opacity 0.2s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
