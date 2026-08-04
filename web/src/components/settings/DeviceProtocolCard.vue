<script setup lang="ts">
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'

interface DeviceProtocolConfig {
  enabled: boolean
  userAgent: string
  deviceModel: string
  deviceBrand: string
  deviceMac: string
  deviceId: string
  imei: string
}

defineProps<{
  loading: boolean
  saving: boolean
  presetOptions: { label: string, value: string | number }[]
}>()

const emit = defineEmits<{
  applyPreset: [value: string | number | undefined]
  randomMac: []
  randomDeviceId: []
  randomImei: []
  save: []
}>()

const form = defineModel<DeviceProtocolConfig>('form', { required: true })
const selectedPreset = defineModel<string | number>('selectedPreset', { required: true })
</script>

<template>
  <div class="border border-gray-200 rounded-lg bg-white p-4 max-sm:p-3 dark:border-gray-700 dark:bg-gray-800">
    <h4 class="mb-3 flex items-center gap-2 text-base text-gray-900 font-bold dark:text-gray-100 max-sm:text-sm">
      <div class="i-carbon-mobile" />
      设备协议配置
    </h4>

    <div v-if="loading" class="py-6 text-center text-sm text-gray-500">
      <div class="i-svg-spinners-ring-resize mx-auto mb-2 text-2xl" />
      <p>加载中...</p>
    </div>

    <div v-else class="space-y-3">
      <div class="rounded-lg bg-gray-50 p-3 dark:bg-gray-700/40">
        <BaseSwitch
          v-model="form.enabled"
          label="启用自定义设备协议"
        />
        <p class="mt-2 text-xs text-gray-500 dark:text-gray-400">
          启用后会使用这里配置的设备参数发起登录。修改后建议重新登录相关账号。
        </p>
      </div>

      <BaseSelect
        v-model="selectedPreset"
        label="快速选择热门机型"
        :options="presetOptions"
        @update:model-value="emit('applyPreset', $event)"
      />

      <BaseInput
        v-model="form.userAgent"
        label="协议头 (User-Agent)"
        type="text"
        placeholder="自定义 User-Agent"
      />

      <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
        <BaseInput
          v-model="form.deviceBrand"
          label="设备品牌"
          type="text"
          placeholder="如 Apple / Huawei / Xiaomi"
        />
        <BaseInput
          v-model="form.deviceModel"
          label="设备型号"
          type="text"
          placeholder="如 iPhone 15 Pro Max"
        />
      </div>

      <div class="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div class="flex items-end gap-2">
          <BaseInput
            v-model="form.deviceMac"
            class="flex-1"
            label="设备 MAC 地址"
            type="text"
            placeholder="XX:XX:XX:XX:XX:XX"
          />
          <BaseButton variant="secondary" size="sm" @click="emit('randomMac')">
            随机
          </BaseButton>
        </div>
        <div class="flex items-end gap-2">
          <BaseInput
            v-model="form.deviceId"
            class="flex-1"
            label="设备 ID"
            type="text"
            placeholder="16位设备 ID"
          />
          <BaseButton variant="secondary" size="sm" @click="emit('randomDeviceId')">
            随机
          </BaseButton>
        </div>
        <div class="flex items-end gap-2">
          <BaseInput
            v-model="form.imei"
            class="flex-1"
            label="IMEI 编码"
            type="text"
            placeholder="15位 IMEI"
          />
          <BaseButton variant="secondary" size="sm" @click="emit('randomImei')">
            随机
          </BaseButton>
        </div>
      </div>

      <p class="text-xs text-gray-500 dark:text-gray-400">
        这组配置按当前用户保存，不区分单个账号。仅在登录兼容性或风控需要时启用即可。
      </p>

      <div class="flex justify-end border-t pt-3 dark:border-gray-700">
        <BaseButton
          variant="primary"
          size="sm"
          :loading="saving"
          @click="emit('save')"
        >
          保存设备协议配置
        </BaseButton>
      </div>
    </div>
  </div>
</template>
