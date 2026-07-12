<script setup lang="ts">
import type { CaptureConfig, LoginLinks, SystemConfig, WxConfig } from '@/composables/useAdminSystemConfig'
import { ref, watch } from 'vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'

interface OptionItem {
  label: string
  value: string
}

defineProps<{
  defaultSystemConfig: SystemConfig
  platformOptions: OptionItem[]
  osOptions: OptionItem[]
  systemConfigSaving: boolean
  wxConfigSaving: boolean
  captureConfigSaving: boolean
  captureConfigTesting: boolean
  loginLinksSaving: boolean
  loginLogoUploading: boolean
}>()

const emit = defineEmits<{
  resetSystem: []
  saveSystem: []
  resetWx: []
  saveWx: []
  testCapture: []
  saveCapture: []
  resetLoginLinks: []
  saveLoginLinks: []
  uploadLoginLogo: [file: File]
}>()

const localSystemConfig = defineModel<SystemConfig>('localSystemConfig', { required: true })
const localWxConfig = defineModel<WxConfig>('localWxConfig', { required: true })
const localCaptureConfig = defineModel<CaptureConfig>('localCaptureConfig', { required: true })
const localLoginLinks = defineModel<LoginLinks>('localLoginLinks', { required: true })
const previewLogoFailed = ref(false)
const logoFileInput = ref<HTMLInputElement | null>(null)

watch(() => localLoginLinks.value.logoUrl, () => {
  previewLogoFailed.value = false
})

function openLogoFilePicker() {
  logoFileInput.value?.click()
}

function handleLogoFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (file)
    emit('uploadLoginLogo', file)
  input.value = ''
}
</script>

<template>
  <div class="space-y-4">
    <h3 class="text-lg text-gray-900 font-bold dark:text-gray-100">
      系统配置
    </h3>

    <div class="rounded-2xl bg-gray-50 px-4 py-3 text-sm text-gray-600 dark:bg-gray-900/40 dark:text-gray-300">
      修改后会直接影响全局连接参数与微信登录行为，保存前建议再次核对目标环境。
    </div>

    <div class="space-y-4">
      <div class="border border-gray-200 rounded-lg bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
        <h4 class="mb-3 flex items-center gap-2 text-base text-gray-900 font-bold dark:text-gray-100">
          <div class="i-carbon-application-web" />
          登录页设置
        </h4>

        <div class="mb-3 rounded-lg bg-gray-50 px-4 py-3 text-xs text-gray-600 dark:bg-gray-900/40 dark:text-gray-300">
          自定义登录页图标、标题、提示语和底部链接。图标地址留空时使用默认图标，底部链接留空时隐藏对应入口。
        </div>

        <div class="grid gap-3 text-sm">
          <div class="flex items-center gap-3 rounded-lg bg-gray-50 px-3 py-3 dark:bg-gray-900/40">
            <div class="h-12 w-12 flex flex-none items-center justify-center overflow-hidden border border-gray-200 rounded-full bg-white dark:border-gray-700 dark:bg-gray-800">
              <img
                v-if="localLoginLinks.logoUrl && !previewLogoFailed"
                :src="localLoginLinks.logoUrl"
                alt="登录页图标预览"
                class="h-full w-full object-cover"
                @error="previewLogoFailed = true"
              >
              <div v-else class="i-carbon-home text-xl text-green-600" />
            </div>
            <div class="min-w-0">
              <div class="break-words text-sm text-gray-900 font-semibold dark:text-gray-100">
                {{ localLoginLinks.title || 'QQ农场智能助手' }}
              </div>
              <div class="mt-1 break-words text-xs text-gray-500 dark:text-gray-400">
                {{ localLoginLinks.loginSubtitle || '欢迎回来，开启智慧农耕之旅' }}
              </div>
            </div>
          </div>
          <div class="flex flex-wrap items-center gap-3">
            <input
              ref="logoFileInput"
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,image/x-icon,image/vnd.microsoft.icon"
              class="hidden"
              @change="handleLogoFileChange"
            >
            <BaseButton
              variant="secondary"
              size="sm"
              :loading="loginLogoUploading"
              @click="openLogoFilePicker"
            >
              <span class="i-carbon-upload" />
              上传本地图片
            </BaseButton>
            <span class="text-xs text-gray-500 dark:text-gray-400">PNG、JPG、WebP、GIF、SVG、ICO，最大 2MB</span>
          </div>
          <BaseInput
            v-model="localLoginLinks.logoUrl"
            label="登录图标地址（可选）"
            type="text"
            placeholder="https://... 或 /icon.png"
          />
          <BaseInput
            v-model="localLoginLinks.title"
            label="主标题"
            type="text"
            placeholder="QQ农场智能助手"
          />
          <BaseInput
            v-model="localLoginLinks.loginSubtitle"
            label="登录欢迎语"
            type="text"
            placeholder="欢迎回来，开启智慧农耕之旅"
          />
          <BaseInput
            v-model="localLoginLinks.registerSubtitle"
            label="注册提示语"
            type="text"
            placeholder="创建账号，开启智慧农耕之旅"
          />
          <BaseInput
            v-model="localLoginLinks.purchaseUrl"
            label="购买链接"
            type="text"
            placeholder="https://... 或 /renewal"
          />
          <BaseInput
            v-model="localLoginLinks.qqGroupUrl"
            label="QQ群链接"
            type="text"
            placeholder="https://qm.qq.com/..."
          />
        </div>

        <div class="mt-3 flex justify-end gap-2">
          <BaseButton
            variant="secondary"
            size="sm"
            :loading="loginLinksSaving"
            @click="$emit('resetLoginLinks')"
          >
            恢复默认
          </BaseButton>
          <BaseButton
            variant="primary"
            size="sm"
            :loading="loginLinksSaving"
            @click="$emit('saveLoginLinks')"
          >
            保存
          </BaseButton>
        </div>
      </div>

      <div class="border border-gray-200 rounded-lg bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
        <h4 class="mb-3 flex items-center gap-2 text-base text-gray-900 font-bold dark:text-gray-100">
          <div class="i-carbon-settings" />
          系统配置
        </h4>

        <div class="grid gap-3 md:grid-cols-3">
          <div class="rounded-2xl bg-gray-50 px-4 py-3 text-sm text-gray-700 dark:bg-gray-900/40 dark:text-gray-200">
            <div class="text-xs text-gray-500 dark:text-gray-400">
              当前平台
            </div>
            <div class="mt-1 font-semibold">
              {{ platformOptions.find(option => option.value === localSystemConfig.platform)?.label || '未设置' }}
            </div>
          </div>
          <div class="rounded-2xl bg-gray-50 px-4 py-3 text-sm text-gray-700 dark:bg-gray-900/40 dark:text-gray-200">
            <div class="text-xs text-gray-500 dark:text-gray-400">
              当前系统
            </div>
            <div class="mt-1 font-semibold">
              {{ localSystemConfig.os }}
            </div>
          </div>
          <div class="rounded-2xl bg-gray-50 px-4 py-3 text-sm text-gray-700 dark:bg-gray-900/40 dark:text-gray-200">
            <div class="text-xs text-gray-500 dark:text-gray-400">
              默认版本
            </div>
            <div class="mt-1 font-semibold">
              {{ defaultSystemConfig.clientVersion }}
            </div>
          </div>
        </div>

        <div class="mb-3 rounded-2xl bg-gray-50 px-4 py-3 text-xs text-gray-500 dark:bg-gray-900/40 dark:text-gray-400">
          服务器地址与客户端版本通常需要成对调整，建议先在测试环境验证，再同步到生产使用。
        </div>

        <div class="mb-3 rounded-2xl bg-amber-50 px-4 py-3 text-xs text-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
          保存后会立刻影响全局连接参数。若服务器地址、平台或系统版本不匹配，可能导致后续账号连接异常。
        </div>

        <div class="grid grid-cols-2 gap-3 text-sm">
          <BaseInput
            v-model="localSystemConfig.serverUrl"
            label="服务器地址"
            type="text"
            placeholder="wss://..."
            class="col-span-2"
          />
          <BaseInput
            v-model="localSystemConfig.clientVersion"
            label="客户端版本"
            type="text"
            placeholder="1.12.3.20_20260709"
            class="col-span-2"
          />
          <div class="flex flex-col gap-1.5">
            <label class="text-sm text-gray-700 font-medium dark:text-gray-300">平台</label>
            <div class="flex gap-2">
              <button
                v-for="option in platformOptions"
                :key="option.value"
                class="rounded-lg px-3 py-1.5 text-sm transition-all"
                :class="localSystemConfig.platform === option.value
                  ? 'text-white shadow-sm'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'"
                :style="localSystemConfig.platform === option.value ? { backgroundColor: 'var(--theme-primary)' } : {}"
                @click="localSystemConfig.platform = option.value"
              >
                {{ option.label }}
              </button>
            </div>
          </div>
          <div class="flex flex-col gap-1.5">
            <label class="text-sm text-gray-700 font-medium dark:text-gray-300">系统</label>
            <div class="flex gap-2">
              <button
                v-for="option in osOptions"
                :key="option.value"
                class="rounded-lg px-3 py-1.5 text-sm transition-all"
                :class="localSystemConfig.os === option.value
                  ? 'text-white shadow-sm'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'"
                :style="localSystemConfig.os === option.value ? { backgroundColor: 'var(--theme-primary)' } : {}"
                @click="localSystemConfig.os = option.value"
              >
                {{ option.label }}
              </button>
            </div>
          </div>
        </div>

        <div class="mt-3 flex justify-end gap-2">
          <BaseButton
            variant="secondary"
            size="sm"
            :loading="systemConfigSaving"
            @click="$emit('resetSystem')"
          >
            重置
          </BaseButton>
          <BaseButton
            variant="primary"
            size="sm"
            :loading="systemConfigSaving"
            @click="$emit('saveSystem')"
          >
            保存
          </BaseButton>
        </div>
      </div>

      <div class="border border-gray-200 rounded-lg bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
        <h4 class="mb-3 flex items-center gap-2 text-base text-gray-900 font-bold dark:text-gray-100">
          <div class="i-carbon-logo-wechat" />
          微信配置
        </h4>

        <div class="grid gap-3 md:grid-cols-3">
          <div class="rounded-2xl bg-gray-50 px-4 py-3 text-sm text-gray-700 dark:bg-gray-900/40 dark:text-gray-200">
            <div class="text-xs text-gray-500 dark:text-gray-400">
              登录状态
            </div>
            <div class="mt-1 font-semibold">
              {{ localWxConfig.enabled ? '已启用' : '已关闭' }}
            </div>
          </div>
          <div class="rounded-2xl bg-gray-50 px-4 py-3 text-sm text-gray-700 dark:bg-gray-900/40 dark:text-gray-200">
            <div class="text-xs text-gray-500 dark:text-gray-400">
              自动添加账号
            </div>
            <div class="mt-1 font-semibold">
              {{ localWxConfig.autoAddAccount ? '开启' : '关闭' }}
            </div>
          </div>
          <div class="rounded-2xl bg-gray-50 px-4 py-3 text-sm text-gray-700 dark:bg-gray-900/40 dark:text-gray-200">
            <div class="text-xs text-gray-500 dark:text-gray-400">
              用户隔离
            </div>
            <div class="mt-1 font-semibold">
              {{ localWxConfig.userIsolation ? '开启' : '关闭' }}
            </div>
          </div>
        </div>

        <div class="mb-3 rounded-2xl p-3 text-xs" style="background-color: rgba(var(--theme-primary-rgb, 59, 130, 246), 0.1); color: var(--theme-primary);">
          <div>启用微信登录：关闭后普通用户无法使用微信扫码登录。</div>
          <div class="mt-1">
            自动添加账号：扫码成功后自动添加账号，关闭则只返回 Code。
          </div>
          <div class="mt-1">
            用户隔离：开启后普通用户只能看到自己的账号。
          </div>
        </div>

        <div class="mb-3 rounded-2xl bg-amber-50 px-4 py-3 text-xs text-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
          重置只会回填当前编辑区的默认值，不会立刻写回服务端。只有点击“保存”后，微信登录相关设置才会正式生效。
        </div>

        <div class="mb-3 rounded-2xl bg-gray-50 px-4 py-3 text-xs text-gray-600 dark:bg-gray-900/40 dark:text-gray-300">
          保存会立即影响扫码登录、自动添加账号与用户隔离行为，建议确认当前环境、代理地址和启用状态后再提交。
        </div>

        <div class="grid grid-cols-2 gap-3 text-sm">
          <div class="col-span-2">
            <BaseSwitch
              v-model="localWxConfig.enabled"
              label="启用微信登录"
            />
          </div>
          <BaseInput
            v-model="localWxConfig.apiBase"
            label="API地址"
            type="text"
            placeholder="https://code.z74d.top/api"
            class="col-span-2"
          />
          <BaseInput
            v-model="localWxConfig.apiKey"
            label="API密钥"
            type="text"
            placeholder="可选，用于代理模式"
            class="col-span-2"
          />
          <BaseInput
            v-model="localWxConfig.proxyApiUrl"
            label="代理API地址"
            type="text"
            placeholder="https://code.z74d.top/api"
            class="col-span-2"
          />
          <BaseSwitch
            v-model="localWxConfig.autoAddAccount"
            label="自动添加账号"
          />
          <BaseSwitch
            v-model="localWxConfig.userIsolation"
            label="用户隔离"
          />
        </div>

        <div class="mt-3 flex justify-end gap-2">
          <BaseButton
            variant="secondary"
            size="sm"
            :loading="wxConfigSaving"
            @click="$emit('resetWx')"
          >
            重置
          </BaseButton>
          <BaseButton
            variant="primary"
            size="sm"
            :loading="wxConfigSaving"
            @click="$emit('saveWx')"
          >
            保存
          </BaseButton>
        </div>
      </div>

      <div class="border border-gray-200 rounded-lg bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
        <h4 class="mb-3 flex items-center gap-2 text-base text-gray-900 font-bold dark:text-gray-100">
          <div class="i-carbon-data-connected" />
          Code/GID 抓取服务
        </h4>

        <div class="grid mb-3 gap-3 md:grid-cols-3">
          <div class="rounded-lg bg-gray-50 px-4 py-3 text-sm text-gray-700 dark:bg-gray-900/40 dark:text-gray-200">
            <div class="text-xs text-gray-500 dark:text-gray-400">
              添加账号入口
            </div>
            <div class="mt-1 font-semibold">
              {{ localCaptureConfig.enabled ? '已开放' : '已关闭' }}
            </div>
          </div>
          <div class="rounded-lg bg-gray-50 px-4 py-3 text-sm text-gray-700 dark:bg-gray-900/40 dark:text-gray-200">
            <div class="text-xs text-gray-500 dark:text-gray-400">
              API Token
            </div>
            <div class="mt-1 font-semibold">
              {{ localCaptureConfig.apiToken || localCaptureConfig.tokenConfigured ? '已配置' : '未配置' }}
            </div>
          </div>
          <div class="rounded-lg bg-gray-50 px-4 py-3 text-sm text-gray-700 dark:bg-gray-900/40 dark:text-gray-200">
            <div class="text-xs text-gray-500 dark:text-gray-400">
              QQ 好友 GID
            </div>
            <div class="mt-1 font-semibold">
              {{ localCaptureConfig.autoImportQqGids ? '自动导入' : '不导入' }}
            </div>
          </div>
        </div>

        <div class="grid grid-cols-2 gap-3 text-sm">
          <div class="col-span-2">
            <BaseSwitch
              v-model="localCaptureConfig.enabled"
              label="允许使用抓包登录添加账号"
            />
          </div>
          <BaseInput
            v-model="localCaptureConfig.apiBase"
            label="抓包服务地址"
            type="text"
            placeholder="http://127.0.0.1:8450"
            class="col-span-2"
          />
          <BaseInput
            v-model="localCaptureConfig.apiToken"
            label="API Token"
            type="password"
            :placeholder="localCaptureConfig.tokenConfigured ? '已配置，留空保持不变' : '请输入抓包服务 API Token'"
            class="col-span-2"
          />
          <div class="col-span-2">
            <BaseSwitch
              v-model="localCaptureConfig.autoImportQqGids"
              label="QQ 抓取完成后自动导入好友 GID"
            />
          </div>
        </div>

        <div class="mt-3 flex flex-wrap justify-end gap-2">
          <BaseButton
            variant="secondary"
            size="sm"
            :loading="captureConfigTesting"
            @click="$emit('testCapture')"
          >
            <span class="i-carbon-connection-signal" />
            测试连接
          </BaseButton>
          <BaseButton
            variant="primary"
            size="sm"
            :loading="captureConfigSaving"
            @click="$emit('saveCapture')"
          >
            保存
          </BaseButton>
        </div>
      </div>
    </div>
  </div>
</template>
