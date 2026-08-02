<script setup lang="ts">
import type { CardStatusFilter, CardTypeFilter, NewCardForm } from '@/composables/useAdminCards'
import type { Card } from '@/stores/user'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'
import { formatCardDate, getCardTypeLabel, getCardValueLabel } from '@/composables/useAdminCards'

defineProps<{
  cards: Card[]
  cardsLoading: boolean
  usedCardsCount: number
  enabledCardsCount: number
  unusedTimeCardsCount: number
  cardManagementSummary: string
  cardClaimEnabled: boolean
  cardClaimLoading: boolean
  filteredCards: Card[]
  selectedCards: Set<string>
  selectedCardCount: number
  currentCardTypeLabel: string
  currentCardStatusLabel: string
  createCardLoading: boolean
}>()

defineEmits<{
  refresh: []
  create: []
  toggleClaim: [enabled: boolean | undefined]
  copySelected: []
  deleteSelected: []
  clearSelected: []
  toggleSelectAll: []
  toggleSelectCard: [code: string]
  copyCode: [code: string]
  toggleCardStatus: [card: Card]
  deleteCard: [card: Card]
}>()

const showCreateModal = defineModel<boolean>('showCreateModal', { required: true })
const newCard = defineModel<NewCardForm>('newCard', { required: true })
const selectAll = defineModel<boolean>('selectAll', { required: true })
const searchQuery = defineModel<string>('searchQuery', { required: true })
const filterStatus = defineModel<CardStatusFilter>('filterStatus', { required: true })
const cardTypeFilter = defineModel<CardTypeFilter>('cardTypeFilter', { required: true })

const durationUnitOptions = [
  { label: '小时', value: 'hour' },
  { label: '天', value: 'day' },
]

const statusFilterOptions = [
  { label: '全部状态', value: 'all' },
  { label: '未使用', value: 'unused' },
  { label: '已使用', value: 'used' },
  { label: '已启用', value: 'enabled' },
  { label: '已禁用', value: 'disabled' },
]
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between">
      <h3 class="text-lg text-gray-800 font-semibold dark:text-gray-200">
        卡密管理
      </h3>
      <div class="flex gap-2">
        <BaseButton variant="secondary" size="sm" @click="$emit('refresh')">
          刷新
        </BaseButton>
        <BaseButton variant="primary" size="sm" @click="showCreateModal = true">
          创建卡密
        </BaseButton>
      </div>
    </div>

    <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <div class="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-glass)] px-4 py-3 text-sm text-gray-700 backdrop-blur-md dark:text-gray-200">
        <div class="text-xs text-gray-500 dark:text-gray-400">
          卡密总数
        </div>
        <div class="mt-1 font-semibold">
          {{ cards.length }} 个
        </div>
      </div>
      <div class="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-glass)] px-4 py-3 text-sm text-gray-700 backdrop-blur-md dark:text-gray-200">
        <div class="text-xs text-gray-500 dark:text-gray-400">
          已使用
        </div>
        <div class="mt-1 font-semibold">
          {{ usedCardsCount }} 个
        </div>
      </div>
      <div class="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-glass)] px-4 py-3 text-sm text-gray-700 backdrop-blur-md dark:text-gray-200">
        <div class="text-xs text-gray-500 dark:text-gray-400">
          已启用
        </div>
        <div class="mt-1 font-semibold">
          {{ enabledCardsCount }} 个
        </div>
      </div>
      <div class="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-glass)] px-4 py-3 text-sm text-gray-700 backdrop-blur-md dark:text-gray-200">
        <div class="text-xs text-gray-500 dark:text-gray-400">
          可领时间卡
        </div>
        <div class="mt-1 font-semibold">
          {{ unusedTimeCardsCount }} 张
        </div>
      </div>
    </div>

    <div class="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-glass)] px-4 py-3 text-sm text-gray-600 backdrop-blur-md dark:text-gray-300">
      可以按类型、状态和关键词筛选卡密；批量创建时会自动导出文件，便于直接发放。
    </div>

    <div class="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-glass)] px-4 py-3 text-sm shadow-sm backdrop-blur-md">
      <div class="text-xs text-gray-500 dark:text-gray-400">
        当前卡密结论
      </div>
      <div class="mt-1 text-gray-900 font-medium dark:text-gray-100">
        {{ cardManagementSummary }}
      </div>
    </div>

    <div class="flex items-center justify-between rounded-lg border border-[var(--theme-border)] bg-[var(--theme-glass)] p-4 backdrop-blur-md">
      <div>
        <h4 class="text-sm text-gray-900 font-medium dark:text-white">
          卡密领取功能
        </h4>
        <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
          开启后，用户注册时可免费领取一张时间卡密
        </p>
      </div>
      <div class="flex items-center gap-3">
        <span class="text-xs text-gray-500">
          库存: <span class="font-medium" :class="unusedTimeCardsCount > 0 ? 'text-green-600' : 'text-red-600'">{{ unusedTimeCardsCount }}</span> 张
        </span>
        <BaseSwitch
          :model-value="cardClaimEnabled"
          :disabled="cardClaimLoading"
          @update:model-value="$emit('toggleClaim', $event)"
        />
      </div>
    </div>

    <div class="grid gap-3 lg:grid-cols-2">
      <div class="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-glass)] p-4 backdrop-blur-md">
        <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <div class="text-sm text-gray-900 font-semibold dark:text-gray-100">
              卡密筛选
            </div>
            <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
              先按卡密类型缩小范围，再结合关键词与状态定位库存、失效或已发放记录。
            </p>
          </div>
          <div class="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-600 dark:bg-gray-900 dark:text-gray-300">
            当前: {{ currentCardTypeLabel }} / {{ currentCardStatusLabel }}
          </div>
        </div>
        <div class="flex flex-wrap gap-2">
          <button
            class="rounded-lg px-3 py-1.5 text-sm font-medium transition-colors"
            :class="cardTypeFilter === 'all'
              ? 'text-white'
              : 'bg-gray-50 text-gray-600 hover:bg-gray-100 dark:bg-gray-900/50 dark:text-gray-300 dark:hover:bg-gray-700'"
            :style="cardTypeFilter === 'all' ? { backgroundColor: 'var(--theme-primary)' } : {}"
            @click="cardTypeFilter = 'all'"
          >
            全部
          </button>
          <button
            class="rounded-lg px-3 py-1.5 text-sm font-medium transition-colors"
            :class="cardTypeFilter === 'time'
              ? 'text-white'
              : 'bg-gray-50 text-gray-600 hover:bg-gray-100 dark:bg-gray-900/50 dark:text-gray-300 dark:hover:bg-gray-700'"
            :style="cardTypeFilter === 'time' ? { backgroundColor: 'var(--theme-primary)' } : {}"
            @click="cardTypeFilter = 'time'"
          >
            时间卡密
          </button>
          <button
            class="rounded-lg px-3 py-1.5 text-sm font-medium transition-colors"
            :class="cardTypeFilter === 'quota'
              ? 'text-white'
              : 'bg-gray-50 text-gray-600 hover:bg-gray-100 dark:bg-gray-900/50 dark:text-gray-300 dark:hover:bg-gray-700'"
            :style="cardTypeFilter === 'quota' ? { backgroundColor: 'var(--theme-primary)' } : {}"
            @click="cardTypeFilter = 'quota'"
          >
            配额卡密
          </button>
        </div>
      </div>

      <div class="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-glass)] p-4 backdrop-blur-md">
        <div class="mb-3 text-sm text-gray-900 font-semibold dark:text-gray-100">
          关键词与状态
        </div>
        <div class="space-y-3">
          <BaseInput
            v-model="searchQuery"
            label="关键词"
            type="text"
            placeholder="搜索卡密、描述或使用者"
          />
          <div>
            <BaseSelect
              v-model="filterStatus"
              label="状态"
              :options="statusFilterOptions"
            />
          </div>
          <div class="rounded-xl bg-gray-50 px-3 py-2 text-xs text-gray-500 dark:bg-gray-900/40 dark:text-gray-400">
            已命中 {{ filteredCards.length }} 条记录，可继续通过关键词快速缩小范围。
          </div>
        </div>
      </div>
    </div>

    <div v-if="selectedCards.size > 0" class="flex flex-wrap items-center gap-2 rounded-lg p-3" style="background-color: rgba(var(--theme-primary-rgb, 59, 130, 246), 0.1);">
      <span style="color: var(--theme-primary);">
        已选择 {{ selectedCardCount }} 个卡密
      </span>
      <BaseButton variant="secondary" size="sm" @click="$emit('copySelected')">
        一键复制
      </BaseButton>
      <BaseButton variant="danger" size="sm" @click="$emit('deleteSelected')">
        批量删除
      </BaseButton>
      <button
        class="ml-auto text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700"
        @click="$emit('clearSelected')"
      >
        清除选择
      </button>
    </div>

    <div v-if="cardsLoading" class="py-8 text-center text-gray-500">
      <div i-svg-spinners-90-ring-with-bg class="mb-2 inline-block text-2xl" />
      <div>加载中...</div>
    </div>

    <div v-else class="overflow-hidden rounded-lg border border-[var(--theme-border)] bg-[var(--theme-glass)] shadow backdrop-blur-md">
      <div class="overflow-x-auto resp-table">
        <table class="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
          <thead class="bg-gray-50 dark:bg-gray-700">
            <tr>
              <th class="px-3 py-2 text-left">
                <input
                  v-model="selectAll"
                  type="checkbox"
                  class="border-gray-300 rounded"
                  @change="$emit('toggleSelectAll')"
                >
              </th>
              <th class="px-4 py-2 text-left text-xs text-gray-500 font-medium dark:text-gray-300">
                卡密
              </th>
              <th class="px-4 py-2 text-left text-xs text-gray-500 font-medium dark:text-gray-300">
                描述
              </th>
              <th class="px-4 py-2 text-left text-xs text-gray-500 font-medium dark:text-gray-300">
                类型
              </th>
              <th class="px-4 py-2 text-left text-xs text-gray-500 font-medium dark:text-gray-300">
                数值
              </th>
              <th class="px-4 py-2 text-left text-xs text-gray-500 font-medium dark:text-gray-300">
                状态
              </th>
              <th class="px-4 py-2 text-left text-xs text-gray-500 font-medium dark:text-gray-300">
                使用者
              </th>
              <th class="px-4 py-2 text-left text-xs text-gray-500 font-medium dark:text-gray-300">
                生成时间
              </th>
              <th class="px-4 py-2 text-left text-xs text-gray-500 font-medium dark:text-gray-300">
                使用时间
              </th>
              <th class="px-4 py-2 text-right text-xs text-gray-500 font-medium dark:text-gray-300">
                操作
              </th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
            <tr v-for="card in filteredCards" :key="card.code" class="hover:bg-gray-50 dark:hover:bg-gray-700/50">
              <td class="px-3 py-2">
                <input
                  :checked="selectedCards.has(card.code)"
                  type="checkbox"
                  class="border-gray-300 rounded"
                  @change="$emit('toggleSelectCard', card.code)"
                >
              </td>
              <td class="whitespace-nowrap px-4 py-2">
                <code class="rounded bg-gray-100 px-2 py-0.5 text-xs dark:bg-gray-700">{{ card.code }}</code>
              </td>
              <td class="whitespace-nowrap px-4 py-2 text-sm text-gray-900 dark:text-white">
                {{ card.description }}
              </td>
              <td class="whitespace-nowrap px-4 py-2">
                <span
                  class="inline-flex rounded-full px-2 py-0.5 text-xs"
                  :class="card.type === 'quota' ? 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200' : 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'"
                >
                  {{ getCardTypeLabel(card) }}
                </span>
              </td>
              <td class="whitespace-nowrap px-4 py-2 text-sm text-gray-900 dark:text-white">
                {{ getCardValueLabel(card) }}
              </td>
              <td class="whitespace-nowrap px-4 py-2">
                <span
                  class="inline-flex rounded-full px-2 py-0.5 text-xs"
                  :class="card.enabled ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'"
                >
                  {{ card.enabled ? '启用' : '禁用' }}
                </span>
              </td>
              <td class="whitespace-nowrap px-4 py-2 text-sm text-gray-500 dark:text-gray-400">
                {{ card.usedBy || '-' }}
              </td>
              <td class="whitespace-nowrap px-4 py-2 text-sm text-gray-500 dark:text-gray-400">
                {{ formatCardDate(card.createdAt) }}
              </td>
              <td class="whitespace-nowrap px-4 py-2 text-sm text-gray-500 dark:text-gray-400">
                {{ formatCardDate(card.usedAt) }}
              </td>
              <td class="whitespace-nowrap px-4 py-2 text-right text-sm">
                <button class="mr-2 hover:opacity-80" style="color: var(--theme-primary);" @click="$emit('copyCode', card.code)">
                  复制
                </button>
                <button class="mr-2 hover:opacity-80" style="color: var(--theme-primary);" @click="$emit('toggleCardStatus', card)">
                  {{ card.enabled ? '禁用' : '启用' }}
                </button>
                <button class="text-red-600 dark:text-red-400 hover:text-red-900" @click="$emit('deleteCard', card)">
                  删除
                </button>
              </td>
            </tr>
            <tr v-if="filteredCards.length === 0">
              <td colspan="10" class="px-4 py-4 text-center text-gray-500 dark:text-gray-400">
                暂无卡密
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div
      v-if="showCreateModal"
      class="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black bg-opacity-50 p-3 sm:items-center sm:p-4"
      @click.self="showCreateModal = false"
    >
      <div class="my-auto max-h-[calc(100dvh-1.5rem)] max-w-lg w-full overflow-y-auto rounded-2xl bg-white p-4 shadow-xl dark:bg-gray-800 sm:max-h-[calc(100dvh-2rem)] sm:p-5" @click.stop>
        <h2 class="mb-4 text-lg text-gray-900 font-bold dark:text-white">
          创建卡密
        </h2>
        <div class="space-y-4">
          <div class="grid gap-3 md:grid-cols-3">
            <div class="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-glass)] px-4 py-3 text-sm text-gray-700 backdrop-blur-md dark:text-gray-200">
              <div class="text-xs text-gray-500 dark:text-gray-400">
                卡密类型
              </div>
              <div class="mt-1 font-semibold">
                {{ newCard.type === 'quota' ? '额度卡' : '时间卡' }}
              </div>
            </div>
            <div class="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-glass)] px-4 py-3 text-sm text-gray-700 backdrop-blur-md dark:text-gray-200">
              <div class="text-xs text-gray-500 dark:text-gray-400">
                生效数值
              </div>
              <div class="mt-1 font-semibold">
                {{ newCard.type === 'quota' ? `+${newCard.days || 0} 额度` : (newCard.days === -1 ? '永久' : `${newCard.days || 0} ${newCard.durationUnit === 'hour' ? '小时' : '天'}`) }}
              </div>
            </div>
            <div class="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-glass)] px-4 py-3 text-sm text-gray-700 backdrop-blur-md dark:text-gray-200">
              <div class="text-xs text-gray-500 dark:text-gray-400">
                生成数量
              </div>
              <div class="mt-1 font-semibold">
                {{ newCard.count || 1 }} 个
              </div>
            </div>
          </div>

          <div class="border border-gray-200 rounded-xl p-4 space-y-3 dark:border-gray-700">
            <div class="text-sm text-gray-900 font-semibold dark:text-gray-100">
              基本信息
            </div>
            <BaseInput
              v-model="newCard.description"
              label="描述"
              type="text"
              placeholder="例如：月卡-2024"
            />
            <div>
              <label class="mb-2 block text-sm text-gray-700 font-medium dark:text-gray-300">
                卡密类型
              </label>
              <div class="grid gap-3 md:grid-cols-2">
                <label class="flex cursor-pointer items-center gap-2 border border-gray-200 rounded-xl px-3 py-3 text-sm text-gray-700 dark:border-gray-700 dark:text-gray-300">
                  <input
                    v-model="newCard.type"
                    type="radio"
                    value="time"
                    class="text-blue-600 focus:ring-blue-500"
                  >
                  <span>时间卡（增加使用时长）</span>
                </label>
                <label class="flex cursor-pointer items-center gap-2 border border-gray-200 rounded-xl px-3 py-3 text-sm text-gray-700 dark:border-gray-700 dark:text-gray-300">
                  <input
                    v-model="newCard.type"
                    type="radio"
                    value="quota"
                    class="text-orange-600 focus:ring-orange-500"
                  >
                  <span>额度卡（增加账号额度）</span>
                </label>
              </div>
            </div>
          </div>

          <div class="grid gap-3 md:grid-cols-2">
            <div class="border border-gray-200 rounded-xl p-4 dark:border-gray-700">
              <BaseInput
                v-model.number="newCard.days"
                :label="newCard.type === 'quota' ? '额度数量' : '时长数值'"
                type="number"
                :placeholder="newCard.type === 'quota' ? '可添加的账号数量' : '时长数值'"
              />
              <div v-if="newCard.type === 'time'" class="mt-3">
                <BaseSelect
                  v-model="newCard.durationUnit"
                  label="时长单位"
                  :options="durationUnitOptions"
                  :disabled="newCard.days === -1"
                />
                <p class="mt-2 text-xs text-gray-500 dark:text-gray-400">
                  输入 `-1` 表示永久，其他数字会按所选单位生成时间卡。
                </p>
              </div>
              <p v-else class="mt-2 text-xs text-gray-500 dark:text-gray-400">
                用户兑换后可新增的农场账号额度数量。
              </p>
            </div>
            <div class="border border-gray-200 rounded-xl p-4 dark:border-gray-700">
              <BaseInput
                v-model.number="newCard.count"
                label="数量"
                type="number"
                min="1"
                max="100"
                placeholder="数量"
              />
              <p class="mt-2 text-xs text-gray-500 dark:text-gray-400">
                支持 1-100 个批量创建，创建完成后会自动导出文本文件。
              </p>
            </div>
          </div>
        </div>
        <div class="mt-5 flex justify-end space-x-3">
          <BaseButton variant="secondary" size="sm" @click="showCreateModal = false">
            取消
          </BaseButton>
          <BaseButton variant="primary" size="sm" :loading="createCardLoading" @click="$emit('create')">
            创建
          </BaseButton>
        </div>
      </div>
    </div>
  </div>
</template>
<style scoped>
@media (max-width: 640px) {
  .resp-table table,
  .resp-table thead,
  .resp-table tbody,
  .resp-table tr,
  .resp-table td {
    display: block;
    width: 100%;
  }
  .resp-table thead { display: none; }
  .resp-table tr {
    margin-bottom: 12px;
    border: 1px solid var(--theme-border);
    border-radius: 12px;
    overflow: hidden;
    background: var(--theme-glass);
  }
  .resp-table td {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    padding: 8px 12px !important;
    text-align: right;
    white-space: normal !important;
    border: none;
    min-width: 0;
  }
  .resp-table td:not(:last-child) {
    border-bottom: 1px solid var(--theme-border);
  }
  .resp-table td[colspan]::before { content: none !important; }
  .resp-table td::before {
    content: '';
    font-weight: 600;
    color: var(--theme-text);
    opacity: 0.65;
    text-align: left;
    flex: 0 0 auto;
  }
  .resp-table tbody tr td:nth-of-type(1)::before { content: "选择"; }
  .resp-table tbody tr td:nth-of-type(2)::before { content: "卡密"; }
  .resp-table tbody tr td:nth-of-type(3)::before { content: "描述"; }
  .resp-table tbody tr td:nth-of-type(4)::before { content: "类型"; }
  .resp-table tbody tr td:nth-of-type(5)::before { content: "数值"; }
  .resp-table tbody tr td:nth-of-type(6)::before { content: "状态"; }
  .resp-table tbody tr td:nth-of-type(7)::before { content: "使用者"; }
  .resp-table tbody tr td:nth-of-type(8)::before { content: "生成时间"; }
  .resp-table tbody tr td:nth-of-type(9)::before { content: "使用时间"; }
  .resp-table tbody tr td:nth-of-type(10)::before { content: "操作"; }
}
</style>

