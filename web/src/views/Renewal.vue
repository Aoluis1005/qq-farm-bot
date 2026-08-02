<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import api from '@/api'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import { formatTimeDuration, getCardQuotaValue, useUserStore } from '@/stores/user'

interface CardInfo {
  type: 'time' | 'quota'
  days: number
  value?: number
  durationValue?: number
  durationUnit?: 'hour' | 'day'
  durationMs?: number | null
  isPermanent?: boolean
  description: string
}

const router = useRouter()
const route = useRoute()
const userStore = useUserStore()
const username = ref('')
const cardCode = ref('')
const loading = ref(false)
const checkingCard = ref(false)
const error = ref('')
const success = ref('')
const redirectSeconds = 1.5
const cardInfo = ref<CardInfo | null>(null)
const checkedCardCode = ref('')
const routeUsername = computed(() => String(route.query.username || '').trim())

const isLoggedIn = computed(() => userStore.isLoggedIn)
const canEditUsername = computed(() => !isLoggedIn.value)
const normalizedUsername = computed(() => username.value.trim())
const normalizedCardCode = computed(() => cardCode.value.trim())
const filledFieldCount = computed(() => {
  let count = 0
  if (normalizedUsername.value)
    count++
  if (normalizedCardCode.value)
    count++
  return count
})
const submitDisabled = computed(() => loading.value || checkingCard.value || filledFieldCount.value < 2)
const submitReadinessLabel = computed(() => {
  if (loading.value)
    return '提交中'
  if (checkingCard.value)
    return '核验中'
  if (filledFieldCount.value === 2)
    return '可提交'
  return '待补充'
})
const cardUsageSummary = computed(() => {
  if (!normalizedCardCode.value)
    return '等待输入卡密'
  if (cardInfo.value?.type === 'quota')
    return `已识别为额度卡，预计增加 ${getCardQuotaValue(cardInfo.value)} 个账号额度`
  if (cardInfo.value?.type === 'time')
    return `已识别为时间卡，预计增加 ${formatTimeDuration(cardInfo.value)} 时长`
  return normalizedCardCode.value.length >= 8 ? '卡密长度已满足常规输入习惯，建议先查询再提交' : '卡密看起来偏短，建议再次核对'
})
const pageSummary = computed(() => {
  if (success.value) {
    return isLoggedIn.value
      ? '续费结果已返回，本地账号信息已同步刷新。'
      : `续费结果已返回，页面将在约 ${redirectSeconds} 秒后跳回登录页。`
  }
  if (error.value)
    return '请先核对用户名、卡密是否填写正确，再重新提交一次。'
  if (cardInfo.value) {
    return cardInfo.value.type === 'quota'
      ? '当前卡密可用于增加账号额度，提交后会立即刷新该用户可添加账号上限。'
      : '当前卡密可用于延长账号时长，提交后会立即更新有效期。'
  }
  return '时间卡会延长有效期，额度卡会增加可添加账号数量。'
})
const cardTypeLabel = computed(() => {
  if (!cardInfo.value)
    return '待识别'
  return cardInfo.value.type === 'quota' ? '额度卡' : '时间卡'
})
const cardValueLabel = computed(() => {
  if (!cardInfo.value)
    return '待查询'
  if (cardInfo.value.type === 'quota')
    return `+${getCardQuotaValue(cardInfo.value)} 个账号额度`
  return formatTimeDuration(cardInfo.value)
})

watch(normalizedCardCode, (value, previousValue) => {
  if (value === previousValue)
    return
  if (!value || value !== checkedCardCode.value) {
    cardInfo.value = null
  }
  if (!value) {
    checkedCardCode.value = ''
  }
})

watch(() => [userStore.isLoggedIn, userStore.username] as const, ([loggedIn, value]) => {
  if (loggedIn && value) {
    username.value = value
  }
}, { immediate: true })

watch(routeUsername, (value) => {
  if (!isLoggedIn.value && value) {
    username.value = value
  }
}, { immediate: true })

function resetMessages() {
  error.value = ''
  success.value = ''
}

async function checkCardInfo(options?: { silent?: boolean }) {
  if (!normalizedCardCode.value) {
    if (!options?.silent)
      error.value = '请输入卡密'
    return false
  }

  checkingCard.value = true
  if (!options?.silent)
    resetMessages()

  try {
    const { data } = await api.get(`/api/card/info/${encodeURIComponent(normalizedCardCode.value)}`)
    if (!data.ok) {
      cardInfo.value = null
      checkedCardCode.value = ''
      error.value = data.error || '卡密不存在或已使用'
      return false
    }

    cardInfo.value = data.data
    checkedCardCode.value = normalizedCardCode.value
    return true
  }
  catch (err: any) {
    cardInfo.value = null
    checkedCardCode.value = ''
    error.value = err?.response?.data?.error || err?.message || '查询卡密失败'
    return false
  }
  finally {
    checkingCard.value = false
  }
}

async function submitRenewal() {
  if (!normalizedUsername.value) {
    error.value = '请输入用户名'
    return
  }
  if (!normalizedCardCode.value) {
    error.value = '请输入卡密'
    return
  }

  if (normalizedCardCode.value.length < 8) {
    error.value = '卡密长度看起来偏短，建议核对后再提交'
    return
  }

  const cardReady = checkedCardCode.value === normalizedCardCode.value && !!cardInfo.value
  if (!cardReady) {
    const checked = await checkCardInfo({ silent: true })
    if (!checked)
      return
  }

  loading.value = true
  resetMessages()

  try {
    const data = isLoggedIn.value
      ? await userStore.renew(normalizedCardCode.value)
      : (await api.post('/api/public/renew', {
          username: normalizedUsername.value,
          cardCode: normalizedCardCode.value,
        })).data

    if (!data.ok) {
      error.value = data.error || '续费失败'
      return
    }

    const cardType = data.data?.cardType || cardInfo.value?.type
    const card = data.data?.card
    success.value = cardType === 'quota'
      ? `续费成功，账号额度已增加 ${cardInfo.value ? getCardQuotaValue(cardInfo.value) : data.data?.days ?? ''}${cardInfo.value ? ' 个' : ''}。`
      : `续费成功，有效期已更新至 ${card?.expiresAt ? new Date(card.expiresAt).toLocaleString('zh-CN') : '最新状态'}。`

    setTimeout(() => {
      if (isLoggedIn.value) {
        router.push('/')
        return
      }
      router.push({
        path: '/login',
        query: normalizedUsername.value ? { username: normalizedUsername.value } : undefined,
      })
    }, redirectSeconds * 1000)
  }
  catch (err: any) {
    const payload = err.response?.data
    error.value = payload?.error || err.message || '续费失败'
  }
  finally {
    loading.value = false
  }
}
</script>

<template>
  <section class="mx-auto max-w-xl py-8 space-y-6">
    <div class="rounded-3xl glass-card p-8">
      <div class="mb-6 flex items-center gap-3">
        <div class="i-carbon-renew text-2xl text-emerald-500" />
        <div>
          <h1 class="text-2xl font-bold">
            续费中心
          </h1>
          <p class="text-sm text-gray-500 dark:text-gray-400">
            输入用户名和卡密，完成账号续费。
          </p>
        </div>
      </div>

      <div class="grid mb-6 gap-3 sm:grid-cols-3">
        <div class="rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300">
          <div class="text-xs opacity-80">
            步骤 1
          </div>
          <div class="mt-1 font-medium">
            填写用户名
          </div>
        </div>
        <div class="rounded-2xl bg-blue-50 px-4 py-3 text-sm text-blue-700 dark:bg-blue-900/20 dark:text-blue-300">
          <div class="text-xs opacity-80">
            步骤 2
          </div>
          <div class="mt-1 font-medium">
            输入卡密
          </div>
        </div>
        <div class="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
          <div class="text-xs opacity-80">
            步骤 3
          </div>
          <div class="mt-1 font-medium">
            完成续费
          </div>
        </div>
      </div>

      <div class="mb-6 rounded-2xl bg-gray-50 px-4 py-3 text-sm text-gray-600 dark:bg-gray-900/40 dark:text-gray-300">
        {{ pageSummary }}
      </div>

      <div class="grid mb-6 gap-3 sm:grid-cols-3">
        <div class="rounded-2xl bg-gray-50 px-4 py-3 text-sm text-gray-700 dark:bg-gray-900/40 dark:text-gray-200">
          <div class="text-xs text-gray-500 dark:text-gray-400">
            当前状态
          </div>
          <div class="mt-1 font-semibold">
            {{ submitReadinessLabel }}
          </div>
        </div>
        <div class="rounded-2xl bg-gray-50 px-4 py-3 text-sm text-gray-700 dark:bg-gray-900/40 dark:text-gray-200">
          <div class="text-xs text-gray-500 dark:text-gray-400">
            已填写字段
          </div>
          <div class="mt-1 font-semibold">
            {{ filledFieldCount }} / 2
          </div>
        </div>
        <div class="rounded-2xl bg-gray-50 px-4 py-3 text-sm text-gray-700 dark:bg-gray-900/40 dark:text-gray-200">
          <div class="text-xs text-gray-500 dark:text-gray-400">
            成功后跳转
          </div>
          <div class="mt-1 font-semibold">
            {{ `${redirectSeconds} 秒后返回登录` }}
          </div>
        </div>
      </div>

      <div class="grid mb-6 gap-3 sm:grid-cols-2">
        <div class="rounded-2xl bg-gray-50 px-4 py-3 text-sm text-gray-600 dark:bg-gray-900/40 dark:text-gray-300">
          {{ isLoggedIn ? '当前已登录，将直接为当前账号续费并同步刷新本地账号信息。' : '时间卡会延长账号有效期；额度卡会增加可添加账号数量。若返回失败，优先核对用户名是否与当前登录名一致。' }}
        </div>
        <div
          class="rounded-2xl px-4 py-3 text-sm"
          :class="normalizedCardCode ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300' : 'bg-gray-50 text-gray-600 dark:bg-gray-900/40 dark:text-gray-300'"
        >
          {{ cardUsageSummary }}
        </div>
      </div>

      <form class="space-y-4" @submit.prevent="submitRenewal">
        <BaseInput
          v-model="username"
          label="用户名"
          placeholder="请输入用户名"
          :disabled="!canEditUsername"
        />
        <div class="space-y-3">
          <div class="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div class="flex-1">
              <BaseInput v-model="cardCode" label="卡密" placeholder="请输入卡密" />
            </div>
            <BaseButton
              type="button"
              variant="outline"
              class="sm:min-w-28"
              :loading="checkingCard"
              :disabled="loading || checkingCard || !normalizedCardCode"
              @click="checkCardInfo()"
            >
              查询卡密
            </BaseButton>
          </div>

          <div v-if="cardInfo" class="border border-blue-200 rounded-2xl bg-blue-50 p-4 text-sm dark:border-blue-800 dark:bg-blue-900/20">
            <div class="mb-3 flex items-center justify-between gap-3">
              <div>
                <div class="text-xs text-blue-600/80 dark:text-blue-300/80">
                  卡密信息
                </div>
                <div class="mt-1 text-blue-900 font-medium dark:text-blue-100">
                  {{ cardInfo.description }}
                </div>
              </div>
              <span
                class="inline-flex rounded-full px-2.5 py-1 text-xs font-semibold"
                :class="cardInfo.type === 'quota' ? 'bg-orange-100 text-orange-800 dark:bg-orange-900/60 dark:text-orange-200' : 'bg-blue-100 text-blue-800 dark:bg-blue-800/60 dark:text-blue-100'"
              >
                {{ cardTypeLabel }}
              </span>
            </div>

            <div class="grid gap-3 sm:grid-cols-2">
              <div class="rounded-xl bg-white/70 px-3 py-2 text-gray-700 dark:bg-gray-950/20 dark:text-gray-200">
                <div class="text-xs text-gray-500 dark:text-gray-400">
                  生效结果
                </div>
                <div class="mt-1 font-semibold">
                  {{ cardValueLabel }}
                </div>
              </div>
              <div class="rounded-xl bg-white/70 px-3 py-2 text-gray-700 dark:bg-gray-950/20 dark:text-gray-200">
                <div class="text-xs text-gray-500 dark:text-gray-400">
                  提交建议
                </div>
                <div class="mt-1 font-semibold">
                  {{ cardInfo.type === 'quota' ? '适合补账号额度' : '适合补账号时长' }}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div v-if="error" class="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
          {{ error }}
        </div>
        <div v-if="success" class="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400">
          {{ success }}
        </div>

        <div class="flex gap-3">
          <BaseButton type="submit" variant="primary" :loading="loading" :disabled="submitDisabled">
            {{ cardInfo ? '确认续费' : '立即续费' }}
          </BaseButton>
          <BaseButton type="button" variant="outline" @click="router.push('/login')">
            返回登录
          </BaseButton>
        </div>
      </form>
    </div>
  </section>
</template>

<style scoped>
.glass-card {
  border-radius: 16px;
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  background: var(--theme-glass);
  border: 1px solid var(--theme-border);
}

:deep(.bg-gray-50),
:deep(.dark\\:bg-gray-900) {
  background: color-mix(in srgb, var(--theme-bg) 30%, transparent) !important;
  border: 1px solid var(--theme-border) !important;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}

:deep(.shadow-sm) {
  box-shadow: none !important;
}
</style>
