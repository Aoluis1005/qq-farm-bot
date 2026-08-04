<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue'
import api from '@/api'
import ConfirmModal from '@/components/ConfirmModal.vue'
import AccountSettingsTab from '@/components/settings/AccountSettingsTab.vue'
import DefaultPlanSettingsTab from '@/components/settings/DefaultPlanSettingsTab.vue'
import UserSettingsTab from '@/components/settings/UserSettingsTab.vue'
import { useAccountSettings } from '@/composables/settings/useAccountSettings'
import { useUserSettings } from '@/composables/settings/useUserSettings'
import { useSettingStore } from '@/stores/setting'
import { useAutomationSettings } from '@/composables/settings/useAutomationSettings'
import { useStrategySettings } from '@/composables/settings/useStrategySettings'
import AdminPanel from '@/views/AdminPanel.vue'

const settingStore = useSettingStore()

type SettingsTabKey = 'account' | 'default-plan' | 'user' | 'admin'

function getInitialSettingsTab(): SettingsTabKey {
  const saved = localStorage.getItem('settings-active-tab')
  return saved === 'default-plan' || saved === 'user' || saved === 'admin'
    ? saved
    : 'account'
}

const activeTab = ref<SettingsTabKey>(getInitialSettingsTab())
const settingsTabsNav = ref<HTMLElement | null>(null)

async function scrollActiveTabIntoView() {
  await nextTick()
  const button = settingsTabsNav.value?.querySelector<HTMLElement>(`[data-settings-tab="${activeTab.value}"]`)
  button?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
}

watch(activeTab, (newTab) => {
  localStorage.setItem('settings-active-tab', newTab)
  void scrollActiveTabIntoView()
})

const tabs = [
  { key: 'account', label: '账号管理', icon: 'i-carbon-user-settings' },
  { key: 'default-plan', label: '默认方案', icon: 'i-carbon-settings-adjust' },
  { key: 'user', label: '用户管理', icon: 'i-carbon-user' },
  { key: 'admin', label: '后台', icon: 'i-carbon-settings-adjust' },
] as const

const modalVisible = ref(false)
const defaultPlanApplyingId = ref('')
const modalConfig = ref({
  title: '',
  message: '',
  type: 'primary' as 'primary' | 'danger',
  isAlert: true,
})

function showAlert(message: string, type: 'primary' | 'danger' = 'primary') {
  modalConfig.value = {
    title: type === 'danger' ? '错误' : '提示',
    message,
    type,
    isAlert: true,
  }
  modalVisible.value = true
}

const {
  passwordSaving,
  offlineSaving,
  offlineTesting,
  deviceProtocolLoading,
  deviceProtocolSaving,
  passwordForm,
  deviceProtocolPresetOptions,
  selectedDevicePreset,
  deviceProtocolForm,
  localOffline,
  channelOptions,
  currentChannelDocUrl,
  openChannelDocs,
  fillRandomDeviceMac,
  fillRandomDeviceId,
  fillRandomImei,
  applyDevicePreset,
  fetchDeviceProtocol,
  syncLocalOfflineSettings,
  handleSaveDeviceProtocol,
  handleChangePassword,
  handleSaveOffline,
  handleTestOffline,
} = useUserSettings(showAlert)

const {
  accounts,
  accountsLoading,
  currentAccountId,
  currentAccountName,
  userIsAdmin,
  showModal,
  showDeleteConfirm,
  deleteLoading,
  editingAccount,
  accountToDelete,
  showClearStoppedConfirm,
  clearStoppedLoading,
  refreshWxCodesLoading,
  stoppedAccountsCount,
  isAddAccountDisabled,
  addAccountDisabledReason,
  isAccountOpsDisabled,
  fetchAccounts,
  selectFirstAccountIfNeeded,
  openSettings,
  openAddModal,
  openEditModal,
  handleDelete,
  confirmDelete,
  toggleAccount,
  refreshWxCodesNow,
  handleSaved,
  selectAccount,
  openClearStoppedConfirm,
  confirmClearStopped,
} = useAccountSettings(showAlert)

// 默认方案 tab 内含策略/自动化设置子区，选项需与首页同款 composable 提供
const {
  fertilizerLandTypeOptions,
  fertilizerOptions,
} = useAutomationSettings({
  currentAccountId,
  showAlert,
})

const {
  plantingStrategyOptions,
  bagFallbackStrategyOptions,
  preferredSeedOptions,
  bagSeeds,
  bagSeedsLoading,
  bagSeedsError,
  loadStrategyData,
  fetchBagSeeds,
} = useStrategySettings({
  currentAccountId,
  getAutomationSettings: () => ({ automation: {} }),
  showAlert,
})

// 注意：策略设置/自动控制的完整可编辑 UI 也作为首页子 Tab 提供；此处为"默认方案"预设入口

async function applyDefaultPlan(account: any) {
  if (!account?.id || defaultPlanApplyingId.value)
    return
  const accountId = String(account.id)
  defaultPlanApplyingId.value = accountId
  try {
    const { data } = await api.post('/api/settings/default-plan/apply', {}, {
      headers: { 'x-account-id': accountId },
    })
    if (!data?.ok)
      throw new Error(data?.error || '应用失败')
    showAlert(`已将默认方案应用到 ${account.name || account.id}`)
  }
  catch (error: any) {
    showAlert(error.response?.data?.error || error.message || '应用默认方案失败', 'danger')
  }
  finally {
    defaultPlanApplyingId.value = ''
  }
}

watch(currentAccountId, async () => {
  settingStore.clearSettingsState()
  if (currentAccountId.value) {
    syncLocalOfflineSettings()
    void loadStrategyData()
  }
})

onMounted(async () => {
  await fetchAccounts()
  await fetchDeviceProtocol()
  selectFirstAccountIfNeeded()
  await scrollActiveTabIntoView()
})
</script>

<template>
  <div class="settings-page">
    <div class="mb-4">
      <h1 class="text-2xl text-gray-900 font-bold dark:text-gray-100">
        设置
      </h1>
    </div>

    <div class="glass-page">
      <div class="glass-tabnav">
        <nav ref="settingsTabsNav" class="flex gap-1 overflow-x-auto p-2">
          <button
            v-for="tab in tabs"
            :key="tab.key"
            :data-settings-tab="tab.key"
            class="flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition-all"
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
        <AccountSettingsTab
          v-if="activeTab === 'account'"
          :accounts="accounts"
          :accounts-loading="accountsLoading"
          :current-account-id="currentAccountId"
          :user-is-admin="userIsAdmin"
          :stopped-accounts-count="stoppedAccountsCount"
          :is-add-account-disabled="isAddAccountDisabled"
          :add-account-disabled-reason="addAccountDisabledReason"
          :is-account-ops-disabled="isAccountOpsDisabled"
          :show-modal="showModal"
          :show-delete-confirm="showDeleteConfirm"
          :delete-loading="deleteLoading"
          :editing-account="editingAccount"
          :account-to-delete="accountToDelete"
          :show-clear-stopped-confirm="showClearStoppedConfirm"
          :clear-stopped-loading="clearStoppedLoading"
          :refresh-wx-codes-loading="refreshWxCodesLoading"
          :default-plan-applying-id="defaultPlanApplyingId"
          @add="openAddModal"
          @clear-stopped="openClearStoppedConfirm"
          @refresh-wx-codes="refreshWxCodesNow"
          @select="selectAccount"
          @toggle="toggleAccount"
          @settings="openSettings"
          @apply-default-plan="applyDefaultPlan"
          @edit="openEditModal"
          @delete="handleDelete"
          @saved="handleSaved"
          @close-modal="showModal = false"
          @close-delete-confirm="showDeleteConfirm = false"
          @confirm-delete="confirmDelete"
          @close-clear-stopped-confirm="showClearStoppedConfirm = false"
          @confirm-clear-stopped="confirmClearStopped"
        />

        <DefaultPlanSettingsTab
          v-else-if="activeTab === 'default-plan'"
          :current-account-id="currentAccountId"
          :current-account-name="currentAccountName"
          :planting-strategy-options="plantingStrategyOptions"
          :preferred-seed-options="preferredSeedOptions"
          :bag-fallback-strategy-options="bagFallbackStrategyOptions"
          :bag-seeds="bagSeeds"
          :bag-seeds-loading="bagSeedsLoading"
          :bag-seeds-error="bagSeedsError"
          :fetch-bag-seeds="fetchBagSeeds"
          :fertilizer-land-type-options="fertilizerLandTypeOptions"
          :fertilizer-options="fertilizerOptions"
          @notify="showAlert"
        />

        <UserSettingsTab
          v-else-if="activeTab === 'user'"
          v-model:device-protocol-form="deviceProtocolForm"
          v-model:selected-device-preset="selectedDevicePreset"
          v-model:password-form="passwordForm"
          v-model:offline-config="localOffline"
          :device-protocol-loading="deviceProtocolLoading"
          :device-protocol-saving="deviceProtocolSaving"
          :device-protocol-preset-options="deviceProtocolPresetOptions"
          :password-saving="passwordSaving"
          :channel-options="channelOptions"
          :current-channel-doc-url="currentChannelDocUrl"
          :offline-saving="offlineSaving"
          :offline-testing="offlineTesting"
          @apply-device-preset="applyDevicePreset"
          @random-mac="fillRandomDeviceMac"
          @random-device-id="fillRandomDeviceId"
          @random-imei="fillRandomImei"
          @save-device-protocol="handleSaveDeviceProtocol"
          @change-password="handleChangePassword"
          @open-docs="openChannelDocs"
          @test-offline="handleTestOffline"
          @save-offline="handleSaveOffline"
        />

        <AdminPanel v-else-if="activeTab === 'admin'" />
      </div>
    </div>

    <ConfirmModal
      :show="modalVisible"
      :title="modalConfig.title"
      :message="modalConfig.message"
      :type="modalConfig.type"
      :is-alert="modalConfig.isAlert"
      confirm-text="知道了"
      @confirm="modalVisible = false"
      @close="modalVisible = false"
      @cancel="modalVisible = false"
    />
  </div>
</template>

<style scoped>
.settings-page {
  margin: 0 auto;
  max-width: 1440px;
  padding: 18px 24px;
  /* App.vue 根容器是 h-screen overflow-hidden，本页必须自带滚动容器，
     否则后台等子 tab 内容超出屏幕时无法滚动（移动端尤其明显） */
  height: 100%;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
}

@media (max-width: 640px) {
  .settings-page {
    padding: 12px 12px;
  }
}

.glass-page {
  border-radius: 16px;
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  background: var(--theme-glass);
  border: 1px solid var(--theme-border);
}

.glass-tabnav {
  border-bottom: 1px solid var(--theme-border);
}

.glass-content :deep(.bg-white),
.glass-content :deep(.dark\\:bg-gray-800),
.glass-content :deep(.dark\\:bg-gray-900) {
  background: var(--theme-glass) !important;
}

.glass-content :deep(.border-gray-200),
.glass-content :deep(.dark\\:border-gray-700) {
  border-color: var(--theme-border) !important;
}

.glass-content :deep(.shadow-sm),
.glass-content :deep(.shadow) {
  box-shadow: none !important;
}
</style>
