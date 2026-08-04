<script setup lang="ts">
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'

interface PasswordForm {
  old: string
  new: string
  confirm: string
}

defineProps<{
  saving: boolean
}>()

const emit = defineEmits<{
  save: []
}>()

const form = defineModel<PasswordForm>('form', { required: true })
</script>

<template>
  <div class="border border-gray-200 rounded-lg bg-white p-4 max-sm:p-3 dark:border-gray-700 dark:bg-gray-800">
    <h4 class="mb-3 flex items-center gap-2 text-base text-gray-900 font-bold dark:text-gray-100 max-sm:text-sm">
      <div class="i-carbon-password" />
      修改用户密码
    </h4>

    <div class="space-y-3">
      <div class="grid grid-cols-1 gap-3 md:grid-cols-3">
        <BaseInput
          v-model="form.old"
          label="当前密码"
          type="password"
          placeholder="当前用户密码"
        />
        <BaseInput
          v-model="form.new"
          label="新密码"
          type="password"
          placeholder="至少 4 位"
        />
        <BaseInput
          v-model="form.confirm"
          label="确认新密码"
          type="password"
          placeholder="再次输入新密码"
        />
      </div>

      <div class="flex items-center justify-end pt-1">
        <BaseButton
          variant="primary"
          size="sm"
          :loading="saving"
          @click="emit('save')"
        >
          修改用户密码
        </BaseButton>
      </div>
    </div>
  </div>
</template>
