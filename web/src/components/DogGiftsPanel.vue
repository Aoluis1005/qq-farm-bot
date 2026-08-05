<script setup lang="ts">
import { onMounted, ref } from 'vue'
import api from '@/api'
import { useToastStore } from '@/stores/toast'

const props = defineProps<{
  accountId: string
  accountRunning: boolean
}>()

const toast = useToastStore()

const loading = ref(false)
const claiming = ref(false)
const claimable = ref(0)
const lastClaim = ref(0)
const errorText = ref('')

async function fetchStatus() {
  if (!props.accountId)
    return
  loading.value = true
  errorText.value = ''
  try {
    const res = await api.get('/api/dog/gifts', {
      headers: { 'x-account-id': props.accountId },
      timeout: 20000,
    })
    if (res.data.ok) {
      claimable.value = Number(res.data.data?.claimable) || 0
    }
    else {
      errorText.value = res.data.error || '查询失败'
    }
  }
  catch (e: any) {
    errorText.value = e?.response?.data?.error || e?.message || '查询失败'
  }
  finally {
    loading.value = false
  }
}

async function claim() {
  if (!props.accountId) {
    toast.error('请先选择账号')
    return
  }
  if (!props.accountRunning) {
    toast.error('当前账号未在线，请先在账号列表启动该账号')
    return
  }
  if (claimable.value <= 0) {
    toast.info('当前没有可领取的同气礼包')
    return
  }
  claiming.value = true
  errorText.value = ''
  try {
    const res = await api.post('/api/dog/gifts/claim', {}, {
      headers: { 'x-account-id': props.accountId },
      timeout: 30000,
    })
    if (res.data.ok) {
      const claimed = Number(res.data.data?.claimed) || 0
      lastClaim.value = claimed
      toast.success(`领取成功：同气礼包 ×${claimed}`)
      await fetchStatus()
    }
    else {
      const msg = res.data.error || '领取失败'
      errorText.value = msg
      toast.error(msg)
      await fetchStatus()
    }
  }
  catch (e: any) {
    const msg = e?.response?.data?.error || e?.message || '领取失败'
    errorText.value = msg
    toast.error(msg)
  }
  finally {
    claiming.value = false
  }
}

onMounted(fetchStatus)
</script>

<template>
  <div class="space-y-4">
    <!-- 说明 -->
    <div class="rounded-lg bg-blue-50 p-3 text-sm text-blue-800 dark:bg-blue-900/20 dark:text-blue-200 sm:p-4">
      <div class="mb-1 flex items-center gap-2 font-medium">
        <div class="i-carbon-information" />
        护主犬奖励（同气礼包）
      </div>
      <ul class="list-disc pl-5 space-y-1 text-blue-700/90 dark:text-blue-200/80">
        <li>显示当前<b>可领取的同气礼包数量</b>（来自 <code>DogService.GetDogInfo</code>）。</li>
        <li>点「领取」一键领取全部（<code>DogService.ClaimSkillGifts</code>，无需进农场）。</li>
        <li>领取后自动刷新剩余数量；可反复领取直至为 0。</li>
      </ul>
      <div class="mt-2 flex items-center gap-1.5 rounded-lg bg-amber-100 px-2.5 py-1.5 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
        <div class="i-carbon-warning-alt" />
        测试阶段：护主犬奖励（同气礼包）为抓包新实现，请以游戏内实际到账为准，有问题及时反馈。
      </div>
    </div>

    <!-- 账号在线提示 -->
    <div
      v-if="!accountRunning"
      class="flex items-center gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-700 dark:bg-amber-900/20 dark:text-amber-300 sm:p-4"
    >
      <div class="i-carbon-warning-alt" />
      当前账号未在线，领取前请先到「账号」页启动该账号。
    </div>

    <!-- 领取卡片 -->
    <div class="rounded-lg bg-white p-4 shadow dark:bg-gray-800 sm:p-5">
      <div class="flex flex-col items-center gap-4 sm:flex-row sm:justify-between">
        <div class="flex items-center gap-4">
          <div class="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow">
            <div class="i-carbon-gift text-2xl" />
          </div>
          <div>
            <div class="text-sm text-gray-500 dark:text-gray-400">
              当前可领取
            </div>
            <div class="text-2xl font-bold text-gray-800 dark:text-gray-100">
              <span v-if="loading" class="text-gray-400">…</span>
              <template v-else>
                {{ claimable }}
                <span class="text-base font-medium text-gray-400">个同气礼包</span>
              </template>
            </div>
          </div>
        </div>
        <button
          class="w-full rounded-xl px-6 py-3 text-sm font-medium text-white transition disabled:opacity-50 sm:w-auto"
          :style="{ backgroundColor: 'var(--theme-primary)' }"
          :disabled="claiming || loading || !accountRunning || claimable <= 0"
          @click="claim"
        >
          <span v-if="claiming" class="i-svg-spinners-90-ring-with-bg mr-1 inline-block align-text-bottom" />
          {{ claiming ? '领取中…' : `领取全部 (${claimable})` }}
        </button>
      </div>

      <!-- 上次领取记录 -->
      <div v-if="lastClaim > 0" class="mt-4 border-t border-gray-100 pt-3 text-sm text-green-600 dark:border-gray-700 dark:text-green-400">
        ✓ 上次领取：同气礼包 ×{{ lastClaim }}
      </div>
      <div v-if="errorText" class="mt-4 border-t border-gray-100 pt-3 text-sm text-red-500 dark:border-gray-700">
        {{ errorText }}
      </div>
    </div>
  </div>
</template>
