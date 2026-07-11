<script setup lang="ts">
import type { UserCard } from '@/stores/user'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import { formatTimeDuration } from '@/stores/user'

interface UserInfo {
  username: string
  role: string
  card: UserCard | null
  accountLimit: number
}

interface EditForm {
  newUsername: string
  password: string
  accountLimit: number
  expiresAt: string
  isPermanent: boolean
}

defineProps<{
  users: UserInfo[]
  filteredUsers: UserInfo[]
  usersLoading: boolean
  currentUsername: string
  activeUsersCount: number
  expiredUsersCount: number
  adminUsersCount: number
  userManagementSummary: string
  renewUserLoading: boolean
  editLoading: boolean
}>()

defineEmits<{
  clearExpired: []
  refresh: []
  openRenewUser: [user: UserInfo]
  openEditUser: [user: UserInfo]
  toggleUserStatus: [user: UserInfo]
  deleteUser: [user: UserInfo]
  renewUser: []
  editUser: []
}>()

const showRenewUserModal = defineModel<boolean>('showRenewUserModal', { required: true })
const userSearchQuery = defineModel<string>('userSearchQuery', { required: true })
const pendingRenewUser = defineModel<UserInfo | null>('pendingRenewUser', { required: true })
const renewUserCardCode = defineModel<string>('renewUserCardCode', { required: true })
const showEditModal = defineModel<boolean>('showEditModal', { required: true })
const editForm = defineModel<EditForm>('editForm', { required: true })

function closeRenewUserModal() {
  showRenewUserModal.value = false
  pendingRenewUser.value = null
  renewUserCardCode.value = ''
}

function isExpired(card: UserCard | null) {
  if (!card?.expiresAt)
    return false
  return Date.now() > card.expiresAt
}

function formatUserCardDate(timestamp: number | null) {
  if (!timestamp)
    return '-'
  return new Date(timestamp).toLocaleString('zh-CN')
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between">
      <h3 class="text-lg text-gray-900 font-bold dark:text-gray-100">
        用户管理
      </h3>
      <div class="flex items-center gap-2">
        <BaseButton variant="danger" size="sm" @click="$emit('clearExpired')">
          清理到期用户
        </BaseButton>
        <BaseButton variant="primary" size="sm" @click="$emit('refresh')">
          刷新
        </BaseButton>
      </div>
    </div>

    <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <div class="rounded-2xl bg-gray-50 px-4 py-3 text-sm text-gray-700 dark:bg-gray-900/40 dark:text-gray-200">
        <div class="text-xs text-gray-500 dark:text-gray-400">
          用户总数
        </div>
        <div class="mt-1 font-semibold">
          {{ users.length }} 人
        </div>
      </div>
      <div class="rounded-2xl bg-gray-50 px-4 py-3 text-sm text-gray-700 dark:bg-gray-900/40 dark:text-gray-200">
        <div class="text-xs text-gray-500 dark:text-gray-400">
          正常用户
        </div>
        <div class="mt-1 font-semibold">
          {{ activeUsersCount }} 人
        </div>
      </div>
      <div class="rounded-2xl bg-gray-50 px-4 py-3 text-sm text-gray-700 dark:bg-gray-900/40 dark:text-gray-200">
        <div class="text-xs text-gray-500 dark:text-gray-400">
          管理员
        </div>
        <div class="mt-1 font-semibold">
          {{ adminUsersCount }} 人
        </div>
      </div>
      <div class="rounded-2xl bg-gray-50 px-4 py-3 text-sm text-gray-700 dark:bg-gray-900/40 dark:text-gray-200">
        <div class="text-xs text-gray-500 dark:text-gray-400">
          已过期
        </div>
        <div class="mt-1 font-semibold">
          {{ expiredUsersCount }} 人
        </div>
      </div>
      <div class="rounded-2xl bg-gray-50 px-4 py-3 text-sm text-gray-700 dark:bg-gray-900/40 dark:text-gray-200">
        <div class="text-xs text-gray-500 dark:text-gray-400">
          当前账号
        </div>
        <div class="mt-1 font-semibold">
          {{ currentUsername || '未登录' }}
        </div>
      </div>
    </div>

    <div class="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
      到期用户清理会直接删除已过期账号，并强制这些账号的当前登录失效。执行前请确认这些用户已经不再需要保留。
    </div>

    <div class="border border-gray-200 rounded-2xl bg-white px-4 py-3 text-sm shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <div class="text-xs text-gray-500 dark:text-gray-400">
        当前用户结论
      </div>
      <div class="mt-1 text-gray-900 font-medium dark:text-gray-100">
        {{ userManagementSummary }}
      </div>
    </div>

    <div class="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
      <div class="w-full sm:max-w-sm">
        <BaseInput
          v-model="userSearchQuery"
          label="搜索用户"
          type="search"
          placeholder="输入用户名"
          clearable
        />
      </div>
      <div class="text-xs text-gray-500 dark:text-gray-400">
        {{ userSearchQuery.trim() ? `找到 ${filteredUsers.length} 个用户` : `共 ${users.length} 个用户` }}
      </div>
    </div>

    <div v-if="usersLoading" class="py-8 text-center text-gray-500">
      <div i-svg-spinners-90-ring-with-bg class="mb-2 inline-block text-2xl" />
      <div>加载中...</div>
    </div>

    <div v-else class="overflow-hidden border border-gray-200 rounded-lg dark:border-gray-700">
      <div class="overflow-x-auto">
        <table class="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
          <thead class="bg-gray-50 dark:bg-gray-700">
            <tr>
              <th class="px-3 py-2 text-left text-xs text-gray-500 font-medium uppercase dark:text-gray-300">
                用户名
              </th>
              <th class="px-3 py-2 text-left text-xs text-gray-500 font-medium uppercase dark:text-gray-300">
                角色
              </th>
              <th class="px-3 py-2 text-left text-xs text-gray-500 font-medium uppercase dark:text-gray-300">
                额度
              </th>
              <th class="px-3 py-2 text-left text-xs text-gray-500 font-medium uppercase dark:text-gray-300">
                时长
              </th>
              <th class="px-3 py-2 text-left text-xs text-gray-500 font-medium uppercase dark:text-gray-300">
                过期时间
              </th>
              <th class="px-3 py-2 text-left text-xs text-gray-500 font-medium uppercase dark:text-gray-300">
                状态
              </th>
              <th class="px-3 py-2 text-right text-xs text-gray-500 font-medium uppercase dark:text-gray-300">
                操作
              </th>
            </tr>
          </thead>
          <tbody class="bg-white divide-y divide-gray-200 dark:bg-gray-800 dark:divide-gray-700">
            <tr v-for="user in filteredUsers" :key="user.username">
              <td class="whitespace-nowrap px-3 py-2 text-sm text-gray-900 font-medium dark:text-white">
                {{ user.username }}
              </td>
              <td class="whitespace-nowrap px-3 py-2 text-sm text-gray-900 dark:text-white">
                <span
                  class="inline-flex rounded-full px-2 text-xs font-semibold leading-5"
                  :class="user.role === 'admin' ? 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200' : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200'"
                >
                  {{ user.role === 'admin' ? '管理员' : '用户' }}
                </span>
              </td>
              <td class="whitespace-nowrap px-3 py-2 text-sm text-gray-900 dark:text-white">
                <span
                  class="inline-flex rounded-full px-2 text-xs font-semibold leading-5"
                  :class="user.role === 'admin' ? 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200' : 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200'"
                >
                  {{ user.role === 'admin' ? '无限制' : `${user.accountLimit || 2}个` }}
                </span>
              </td>
              <td class="whitespace-nowrap px-3 py-2 text-sm text-gray-900 dark:text-white">
                {{ user.card ? formatTimeDuration(user.card) : '无' }}
              </td>
              <td class="whitespace-nowrap px-3 py-2 text-sm" :class="isExpired(user.card) ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-white'">
                {{ formatUserCardDate(user.card?.expiresAt || null) }}
              </td>
              <td class="whitespace-nowrap px-3 py-2">
                <span
                  v-if="user.card"
                  class="inline-flex rounded-full px-2 text-xs font-semibold leading-5"
                  :class="user.card.enabled === false ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200' : (isExpired(user.card) ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200' : 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200')"
                >
                  {{ user.card.enabled === false ? '封禁' : (isExpired(user.card) ? '已过期' : '正常') }}
                </span>
                <span v-else class="text-gray-500 dark:text-gray-400">-</span>
              </td>
              <td class="whitespace-nowrap px-3 py-2 text-right text-sm font-medium">
                <button
                  v-if="user.role !== 'admin'"
                  class="mr-3 text-emerald-600 dark:text-emerald-400 hover:text-emerald-900 dark:hover:text-emerald-300"
                  @click="$emit('openRenewUser', user)"
                >
                  续费
                </button>
                <button
                  class="mr-3 text-blue-600 dark:text-blue-400 hover:text-blue-900 dark:hover:text-blue-300"
                  @click="$emit('openEditUser', user)"
                >
                  编辑
                </button>
                <button
                  v-if="user.card"
                  class="mr-3 text-yellow-600 dark:text-yellow-400 hover:text-yellow-900 dark:hover:text-yellow-300"
                  @click="$emit('toggleUserStatus', user)"
                >
                  {{ user.card.enabled === false ? '解封' : '封禁' }}
                </button>
                <button
                  v-if="user.username !== currentUsername"
                  class="text-red-600 dark:text-red-400 hover:text-red-900 dark:hover:text-red-300"
                  @click="$emit('deleteUser', user)"
                >
                  删除
                </button>
              </td>
            </tr>
            <tr v-if="filteredUsers.length === 0">
              <td colspan="7" class="px-3 py-8 text-center text-gray-500 dark:text-gray-400">
                <div class="i-carbon-user-multiple mx-auto mb-2 text-3xl text-gray-300" />
                <div class="text-sm">
                  {{ userSearchQuery.trim() ? '没有找到匹配的用户' : '暂无用户' }}
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div
      v-if="showRenewUserModal"
      class="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black bg-opacity-50 p-3 sm:items-center sm:p-4"
      @click.self="!renewUserLoading && closeRenewUserModal()"
    >
      <div class="my-auto max-h-[calc(100dvh-1.5rem)] max-w-md w-full overflow-y-auto rounded-2xl bg-white p-4 shadow-xl sm:max-h-[calc(100dvh-2rem)] dark:bg-gray-800 sm:p-5" @click.stop>
        <h2 class="mb-4 text-lg text-gray-900 font-bold dark:text-white">
          用户续费：{{ pendingRenewUser?.username }}
        </h2>

        <div class="space-y-4">
          <div class="rounded-2xl bg-gray-50 px-4 py-3 text-sm text-gray-600 dark:bg-gray-900/40 dark:text-gray-300">
            请输入用于续费的卡密。提交后会立即更新该用户的到期时间与账号额度，并写入后台审计日志。
          </div>

          <BaseInput
            v-model="renewUserCardCode"
            label="续费卡密"
            type="text"
            placeholder="输入卡密编码"
          />
        </div>

        <div class="mt-5 flex justify-end space-x-3">
          <BaseButton
            variant="secondary"
            size="sm"
            :disabled="renewUserLoading"
            @click="closeRenewUserModal"
          >
            取消
          </BaseButton>
          <BaseButton
            variant="primary"
            size="sm"
            :loading="renewUserLoading"
            @click="$emit('renewUser')"
          >
            下一步
          </BaseButton>
        </div>
      </div>
    </div>

    <div
      v-if="showEditModal"
      class="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black bg-opacity-50 p-3 sm:items-center sm:p-4"
      @click.self="showEditModal = false"
    >
      <div class="my-auto max-h-[calc(100dvh-1.5rem)] max-w-lg w-full overflow-y-auto rounded-2xl bg-white p-4 shadow-xl sm:max-h-[calc(100dvh-2rem)] dark:bg-gray-800 sm:p-5" @click.stop>
        <h2 class="mb-4 text-lg text-gray-900 font-bold dark:text-white">
          编辑用户
        </h2>
        <div class="space-y-4">
          <div class="rounded-2xl bg-gray-50 px-4 py-3 text-sm text-gray-600 dark:bg-gray-900/40 dark:text-gray-300">
            建议先确认该用户是否需要改名，再决定是否重置密码或调整时长与额度，避免一次修改过多导致排查困难。
          </div>

          <div class="border border-gray-200 rounded-xl p-4 space-y-3 dark:border-gray-700">
            <div class="text-sm text-gray-900 font-semibold dark:text-gray-100">
              基本信息
            </div>
            <div>
              <label class="mb-1 block text-sm text-gray-700 font-medium dark:text-gray-300">
                用户名
              </label>
              <BaseInput
                v-model="editForm.newUsername"
                placeholder="输入新用户名（留空则不修改）"
              />
              <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                用户名只能包含字母、数字和下划线，长度 3-32 位。
              </p>
            </div>
            <div>
              <label class="mb-1 block text-sm text-gray-700 font-medium dark:text-gray-300">
                新密码
              </label>
              <BaseInput
                v-model="editForm.password"
                type="password"
                placeholder="输入新密码（留空则不修改）"
              />
              <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                密码长度至少 6 位，建议覆盖字母、数字与特殊符号中的至少两类。
              </p>
            </div>
          </div>

          <div class="grid gap-3 md:grid-cols-2">
            <div class="border border-gray-200 rounded-xl p-4 dark:border-gray-700">
              <div class="text-sm text-gray-900 font-semibold dark:text-gray-100">
                账号额度
              </div>
              <BaseInput
                v-model.number="editForm.accountLimit"
                type="number"
                min="1"
                label="可添加账号数"
                placeholder="可添加的账号数量"
              />
              <p class="mt-2 text-xs text-gray-500 dark:text-gray-400">
                普通用户最多可添加的农场账号数量。
              </p>
            </div>
            <div class="border border-gray-200 rounded-xl p-4 dark:border-gray-700">
              <div class="text-sm text-gray-900 font-semibold dark:text-gray-100">
                时效设置
              </div>
              <div class="mt-3 flex items-center gap-3">
                <input
                  v-model="editForm.isPermanent"
                  type="checkbox"
                  class="border-gray-300 rounded text-blue-600 focus:ring-blue-500"
                >
                <span class="text-sm text-gray-600 dark:text-gray-400">永久有效</span>
              </div>
              <input
                v-if="!editForm.isPermanent"
                v-model="editForm.expiresAt"
                type="datetime-local"
                class="mt-3 w-full border border-gray-200 rounded-lg bg-white px-3 py-2 text-sm dark:border-gray-600 focus:border-blue-500 dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
            </div>
          </div>
        </div>
        <div class="mt-5 flex justify-end space-x-3">
          <BaseButton variant="secondary" size="sm" @click="showEditModal = false">
            取消
          </BaseButton>
          <BaseButton
            variant="primary"
            size="sm"
            :disabled="editLoading"
            @click="$emit('editUser')"
          >
            {{ editLoading ? '保存中...' : '保存' }}
          </BaseButton>
        </div>
      </div>
    </div>
  </div>
</template>
