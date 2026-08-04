<script setup lang="ts">
import AccountModal from '@/components/AccountModal.vue'
import ConfirmModal from '@/components/ConfirmModal.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import { getPlatformClass, getPlatformLabel } from '@/stores/account'

defineProps<{
  accounts: any[]
  accountsLoading: boolean
  currentAccountId: string | number | null | undefined
  userIsAdmin: boolean
  stoppedAccountsCount: number
  isAddAccountDisabled: boolean
  addAccountDisabledReason: string
  isAccountOpsDisabled: boolean
  showModal: boolean
  editingAccount: any
  showDeleteConfirm: boolean
  deleteLoading: boolean
  accountToDelete: any
  showClearStoppedConfirm: boolean
  clearStoppedLoading: boolean
  refreshWxCodesLoading: boolean
  defaultPlanApplyingId: string
}>()

const emit = defineEmits<{
  add: []
  clearStopped: []
  refreshWxCodes: []
  select: [account: any]
  toggle: [account: any]
  settings: [account: any]
  applyDefaultPlan: [account: any]
  edit: [account: any]
  delete: [account: any]
  saved: []
  closeModal: []
  closeDeleteConfirm: []
  confirmDelete: []
  closeClearStoppedConfirm: []
  confirmClearStopped: []
}>()

function accountAvatar(acc: any) {
  const direct = String(acc?.avatar || acc?.avatarUrl || acc?.avatar_url || '').trim()
  if (direct)
    return direct
  const qq = String(acc?.uin || acc?.qq || '').trim()
  if (/^\d+$/.test(qq))
    return `https://q1.qlogo.cn/g?b=qq&nk=${qq}&s=100`
  return ''
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <h3 class="text-lg text-gray-900 font-bold dark:text-gray-100 max-sm:text-base">
        账号管理
      </h3>
      <div class="flex flex-wrap gap-2">
        <BaseButton
          variant="outline"
          size="sm"
          :loading="refreshWxCodesLoading"
          :disabled="accountsLoading || accounts.length === 0"
          @click="emit('refreshWxCodes')"
        >
          <div class="i-carbon-renew mr-2" />
          <span class="hidden sm:inline">{{ userIsAdmin ? '刷新全部微信Code' : '刷新我的微信Code' }}</span>
          <span class="sm:hidden">刷新Code</span>
        </BaseButton>
        <BaseButton
          v-if="userIsAdmin"
          variant="secondary"
          size="sm"
          :disabled="stoppedAccountsCount === 0"
          @click="emit('clearStopped')"
        >
          <div class="i-carbon-trash-can mr-2" />
          <span class="hidden sm:inline">一键清理</span>
          <span class="sm:hidden">清理</span>
          ({{ stoppedAccountsCount }})
        </BaseButton>
        <BaseButton
          variant="primary"
          size="sm"
          :disabled="isAddAccountDisabled"
          :title="addAccountDisabledReason"
          @click="emit('add')"
        >
          <div class="i-carbon-add mr-2" />
          添加账号
        </BaseButton>
      </div>
    </div>

    <div v-if="accountsLoading && accounts.length === 0" class="py-8 text-center text-gray-500">
      <div i-svg-spinners-90-ring-with-bg class="mb-2 inline-block text-2xl" />
      <div>加载中...</div>
    </div>

    <div v-else-if="accounts.length === 0" class="rounded-lg bg-white py-12 text-center shadow dark:bg-gray-800">
      <div i-carbon-user-avatar class="mb-4 inline-block text-4xl text-gray-400" />
      <p class="mb-4 text-gray-500">
        暂无账号
      </p>
      <BaseButton
        variant="text"
        size="sm"
        :disabled="isAddAccountDisabled"
        :title="addAccountDisabledReason"
        @click="emit('add')"
      >
        立即添加
      </BaseButton>
    </div>

    <div v-else class="grid grid-cols-1 gap-4 lg:grid-cols-3 sm:grid-cols-2 xl:grid-cols-4">
      <div
        v-for="acc in accounts"
        :key="acc.id"
        class="cursor-pointer border rounded-lg bg-white p-3 shadow transition-all duration-200 dark:bg-gray-800 sm:p-4"
        :class="String(currentAccountId) === String(acc.id)
          ? 'ring-2'
          : 'border-transparent'"
        :style="String(currentAccountId) === String(acc.id)
          ? { borderColor: 'var(--theme-primary)', backgroundColor: 'rgba(var(--theme-primary-rgb, 59, 130, 246), 0.1)' }
          : {}"
        @click="emit('select', acc)"
      >
        <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <div class="min-w-0 flex flex-1 items-center gap-3">
            <div class="h-10 w-10 flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-gray-100 sm:h-12 sm:w-12 dark:bg-gray-700">
              <img v-if="accountAvatar(acc)" :src="accountAvatar(acc)" class="h-full w-full object-cover">
              <div v-else class="i-carbon-user text-xl text-gray-400 sm:text-2xl" />
            </div>
            <div class="min-w-0 flex-1">
              <h4 class="truncate text-base font-bold sm:text-lg">
                {{ acc.name || acc.nick || acc.id }}
              </h4>
              <div class="mt-0.5 flex flex-wrap items-center gap-1.5">
                <span
                  v-if="acc.platform"
                  class="rounded px-1.5 py-0.5 text-[10px] font-medium leading-tight"
                  :class="getPlatformClass(acc.platform)"
                >
                  {{ getPlatformLabel(acc.platform) }}
                </span>
                <span class="truncate text-xs text-gray-500 sm:text-sm">
                  {{ acc.uin || '未绑定' }}
                </span>
              </div>
            </div>
          </div>
          <div class="flex items-center justify-end gap-2 sm:flex-col sm:items-end">
            <span class="flex items-center gap-1 text-xs text-gray-500 sm:hidden">
              <div class="h-2 w-2 rounded-full" :class="acc.running ? 'bg-green-500' : 'bg-gray-300'" />
              {{ acc.running ? '运行中' : '已停止' }}
            </span>
            <BaseButton
              variant="secondary"
              size="sm"
              class="border rounded-full shadow-sm transition-all duration-500 ease-in-out sm:w-20 active:scale-95"
              :class="acc.running ? 'border-red-200 bg-red-50 text-red-600 hover:bg-red-100 focus:ring-red-500 active:border-red-300 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400 dark:hover:bg-red-900/30 dark:focus:ring-red-500 dark:active:border-red-700' : 'border-green-200 bg-green-50 text-green-600 hover:bg-green-100 focus:ring-green-500 active:border-green-300 dark:border-green-800 dark:bg-green-900/20 dark:text-green-400 dark:hover:bg-green-900/30 dark:focus:ring-green-500 dark:active:border-green-700'"
              :disabled="!acc.running && isAccountOpsDisabled"
              :title="!acc.running && isAccountOpsDisabled ? '账号已到期，无法启动账号' : ''"
              @click="emit('toggle', acc)"
            >
              <div :class="acc.running ? 'i-carbon-stop-filled' : 'i-carbon-play-filled'" class="mr-1" />
              {{ acc.running ? '停止' : '启动' }}
            </BaseButton>
          </div>
        </div>

        <div class="mt-3 flex items-center justify-between border-t border-gray-100 pt-3 sm:mt-4 dark:border-gray-700 sm:pt-4">
          <div class="hidden items-center gap-2 text-sm text-gray-500 sm:flex">
            <span class="flex items-center gap-1">
              <div class="h-2 w-2 rounded-full" :class="acc.running ? 'bg-green-500' : 'bg-gray-300'" />
              {{ acc.running ? '运行中' : '已停止' }}
            </span>
          </div>

          <div class="flex flex-1 justify-end gap-1 sm:flex-initial sm:gap-2">
            <BaseButton
              :data-testid="`apply-default-plan-${acc.id}`"
              variant="ghost"
              class="min-h-[36px] min-w-[36px] !p-2"
              :loading="defaultPlanApplyingId === String(acc.id)"
              :disabled="!!defaultPlanApplyingId"
              title="应用默认方案"
              @click="emit('applyDefaultPlan', acc)"
            >
              <div v-if="defaultPlanApplyingId !== String(acc.id)" i-carbon-document-import />
            </BaseButton>
            <BaseButton
              variant="ghost"
              class="min-h-[36px] min-w-[36px] !p-2"
              title="设置"
              @click="emit('settings', acc)"
            >
              <div i-carbon-settings />
            </BaseButton>
            <BaseButton
              variant="ghost"
              class="min-h-[36px] min-w-[36px] !p-2"
              title="编辑"
              @click="emit('edit', acc)"
            >
              <div i-carbon-edit />
            </BaseButton>
            <BaseButton
              variant="ghost"
              class="min-h-[36px] min-w-[36px] text-red-500 !p-2 dark:text-red-400 hover:text-red-600 dark:hover:text-red-300"
              title="删除"
              @click="emit('delete', acc)"
            >
              <div i-carbon-trash-can />
            </BaseButton>
          </div>
        </div>
      </div>
    </div>

  <Teleport to="body">
    <AccountModal
      :show="showModal"
      :edit-data="editingAccount"
      @close="emit('closeModal')"
      @saved="emit('saved')"
    />

    <ConfirmModal
      :show="showDeleteConfirm"
      :loading="deleteLoading"
      title="删除账号"
      :message="accountToDelete ? `确定要删除账号 ${accountToDelete.name || accountToDelete.id} 吗?` : ''"
      confirm-text="删除"
      type="danger"
      @close="!deleteLoading && emit('closeDeleteConfirm')"
      @cancel="!deleteLoading && emit('closeDeleteConfirm')"
      @confirm="emit('confirmDelete')"
    />

    <ConfirmModal
      :show="showClearStoppedConfirm"
      :loading="clearStoppedLoading"
      title="一键清理已停止账号"
      :message="`确定要清理 ${stoppedAccountsCount} 个已停止的账号吗？此操作不可恢复！`"
      confirm-text="确认清理"
      type="danger"
      @close="!clearStoppedLoading && emit('closeClearStoppedConfirm')"
      @cancel="!clearStoppedLoading && emit('closeClearStoppedConfirm')"
      @confirm="emit('confirmClearStopped')"
    />
  </Teleport>
  </div>
</template>
