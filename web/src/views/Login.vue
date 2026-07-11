<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import api from '@/api'
import LoginModals from '@/components/login/LoginModals.vue'
import PasswordStrengthMeter from '@/components/login/PasswordStrengthMeter.vue'
import UpdateLogModal from '@/components/login/UpdateLogModal.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import { getPasswordStrength } from '@/composables/usePasswordStrength'
import { useAppStore } from '@/stores/app'
import { formatTimeDuration, useUserStore } from '@/stores/user'

const USERNAME_RE = /^\w+$/

const userStore = useUserStore()
const appStore = useAppStore()
const route = useRoute()
const gameVersion = ref('')
const loginLinks = computed(() => appStore.loginPageConfig)
const showUpdateLog = ref(false)
const logoLoadFailed = ref(false)

const isLogin = ref(true)
const username = ref('')
const password = ref('')
const cardCode = ref('')
const error = ref('')
const success = ref('')
const loading = ref(false)
const showPasswordStrength = ref(false)
const lockoutRemaining = ref(0)
const rateLimitRemaining = ref(0)
const routeUsername = computed(() => String(route.query.username || '').trim())

const cardClaimEnabled = ref(false)
const cardClaimLoading = ref(false)
const showClaimModal = ref(false)
const claimModalContent = ref({
  success: true,
  title: '',
  message: '',
  cardCode: '',
  days: 0,
})

const showResetVerifyModal = ref(false)
const showResetPasswordModal = ref(false)
const resetUsername = ref('')
const resetCardCode = ref('')
const resetNewPassword = ref('')
const resetConfirmPassword = ref('')
const resetError = ref('')
const resetLoading = ref(false)
const resetPasswordTouched = ref(false)

const showRenewalModal = ref(false)
const renewalUsername = ref('')
const renewalCardCode = ref('')
const renewalError = ref('')
const renewalSuccess = ref('')
const renewalLoading = ref(false)

const passwordStrength = computed(() => {
  return getPasswordStrength(password.value)
})

const resetPasswordStrength = computed(() => {
  return getPasswordStrength(resetNewPassword.value)
})

const usernameValid = computed(() => {
  const name = username.value
  if (!name)
    return { valid: false, message: '' }
  if (name.length < 3)
    return { valid: false, message: '用户名至少3位' }
  if (name.length > 32)
    return { valid: false, message: '用户名最多32位' }
  if (!USERNAME_RE.test(name))
    return { valid: false, message: '只能包含字母、数字、下划线' }
  return { valid: true, message: '' }
})

watch(password, () => {
  if (!isLogin.value && password.value) {
    showPasswordStrength.value = true
  }
})

watch(routeUsername, (value) => {
  if (value && !username.value.trim()) {
    username.value = value
  }
}, { immediate: true })

watch(() => loginLinks.value.logoUrl, () => {
  logoLoadFailed.value = false
})

function validateForm(): boolean {
  if (!username.value) {
    error.value = '请输入用户名'
    return false
  }

  if (!usernameValid.value.valid) {
    error.value = usernameValid.value.message
    return false
  }

  if (!password.value) {
    error.value = '请输入密码'
    return false
  }

  if (!isLogin.value) {
    if (password.value.length < 6) {
      error.value = '密码长度至少6位'
      return false
    }

    if (!passwordStrength.value.valid) {
      error.value = '密码强度不足：需包含大写字母、小写字母、数字、特殊符号中的至少两种'
      return false
    }

    if (!cardCode.value) {
      error.value = '请输入卡密'
      return false
    }
  }

  return true
}

async function handleSubmit() {
  if (!validateForm())
    return

  loading.value = true
  error.value = ''
  success.value = ''

  try {
    if (isLogin.value) {
      const result = await userStore.login(username.value, password.value)
      if (result.ok) {
        if (result.data?.mustChangePassword) {
          success.value = '登录成功！请修改默认密码以确保账户安全'
        }
        setTimeout(() => {
          window.location.href = '/'
        }, 500)
      }
      else {
        if (result.errorType === 'rate_limit') {
          error.value = result.error || '请求过于频繁，请稍后重试'
          if (result.remainingMs) {
            rateLimitRemaining.value = Math.ceil(result.remainingMs / 1000)
          }
        }
        else if (result.errorType === 'locked') {
          error.value = result.error || '账户已被锁定'
          if (result.remainingMs) {
            lockoutRemaining.value = Math.ceil(result.remainingMs / 1000 / 60)
          }
        }
        else {
          error.value = result.error || '登录失败'
        }
      }
    }
    else {
      const result = await userStore.register(username.value, password.value, cardCode.value)
      if (result.ok) {
        success.value = '注册成功，请登录'
        isLogin.value = true
        cardCode.value = ''
        password.value = ''
      }
      else {
        error.value = result.error || '注册失败'
      }
    }
  }
  catch (e: any) {
    const data = e.response?.data
    if (data?.errorType === 'rate_limit') {
      error.value = data.error || '请求过于频繁'
      if (data.remainingMs) {
        rateLimitRemaining.value = Math.ceil(data.remainingMs / 1000)
      }
    }
    else if (data?.errorType === 'locked') {
      error.value = data.error || '账户已被锁定'
      if (data.remainingMs) {
        lockoutRemaining.value = Math.ceil(data.remainingMs / 1000 / 60)
      }
    }
    else {
      error.value = data?.error || e.message || '操作异常'
    }
  }
  finally {
    loading.value = false
  }
}

function toggleMode() {
  isLogin.value = !isLogin.value
  error.value = ''
  success.value = ''
  showPasswordStrength.value = false
  lockoutRemaining.value = 0
  rateLimitRemaining.value = 0
}

function openRenewal() {
  renewalUsername.value = username.value.trim()
  renewalCardCode.value = ''
  renewalError.value = ''
  renewalSuccess.value = ''
  showRenewalModal.value = true
}

function closeRenewalModal() {
  if (renewalLoading.value)
    return
  showRenewalModal.value = false
  renewalError.value = ''
  renewalSuccess.value = ''
}

async function submitRenewal() {
  if (!renewalUsername.value.trim()) {
    renewalError.value = '请输入用户名'
    return
  }
  if (!renewalCardCode.value.trim()) {
    renewalError.value = '请输入卡密'
    return
  }

  renewalLoading.value = true
  renewalError.value = ''
  renewalSuccess.value = ''
  try {
    const { data } = await api.post('/api/public/renew', {
      username: renewalUsername.value.trim(),
      cardCode: renewalCardCode.value.trim(),
    })
    if (!data.ok) {
      renewalError.value = data.error || '续费失败'
      return
    }

    const cardType = data.data?.cardType
    const card = data.data?.card
    renewalSuccess.value = cardType === 'quota'
      ? '续费成功，账号额度已更新'
      : `续费成功，有效期已更新${card?.expiresAt ? `至 ${new Date(card.expiresAt).toLocaleString('zh-CN')}` : ''}`
    username.value = renewalUsername.value.trim()
  }
  catch (e: any) {
    renewalError.value = e?.response?.data?.error || e?.message || '续费失败'
  }
  finally {
    renewalLoading.value = false
  }
}

function openResetVerifyModal() {
  resetUsername.value = username.value.trim()
  resetCardCode.value = ''
  resetNewPassword.value = ''
  resetConfirmPassword.value = ''
  resetError.value = ''
  resetPasswordTouched.value = false
  showResetVerifyModal.value = true
}

function closeResetVerifyModal() {
  if (resetLoading.value)
    return
  showResetVerifyModal.value = false
  resetError.value = ''
}

function closeResetPasswordModal() {
  if (resetLoading.value)
    return
  showResetPasswordModal.value = false
  resetNewPassword.value = ''
  resetConfirmPassword.value = ''
  resetError.value = ''
  resetPasswordTouched.value = false
}

async function verifyResetPassword() {
  if (!resetUsername.value.trim()) {
    resetError.value = '请输入用户名'
    return
  }
  if (!resetCardCode.value.trim()) {
    resetError.value = '请输入注册时使用的卡密'
    return
  }

  resetLoading.value = true
  resetError.value = ''
  try {
    const result = await userStore.verifyResetPassword(resetUsername.value.trim(), resetCardCode.value.trim())
    if (!result.ok) {
      resetError.value = result.error || '验证失败'
      return
    }
    showResetVerifyModal.value = false
    showResetPasswordModal.value = true
  }
  catch (e: any) {
    resetError.value = e?.response?.data?.error || e?.message || '验证失败'
  }
  finally {
    resetLoading.value = false
  }
}

async function submitResetPassword() {
  resetPasswordTouched.value = true
  if (!resetNewPassword.value) {
    resetError.value = '请输入新密码'
    return
  }
  if (resetNewPassword.value.length < 6) {
    resetError.value = '密码长度至少6位'
    return
  }
  if (!resetPasswordStrength.value.valid) {
    resetError.value = '密码强度不足：需包含大写字母、小写字母、数字、特殊符号中的至少两种'
    return
  }
  if (resetNewPassword.value !== resetConfirmPassword.value) {
    resetError.value = '两次输入的密码不一致'
    return
  }

  resetLoading.value = true
  resetError.value = ''
  try {
    const result = await userStore.resetPassword(
      resetUsername.value.trim(),
      resetCardCode.value.trim(),
      resetNewPassword.value,
    )
    if (!result.ok) {
      resetError.value = result.error || '重置失败'
      return
    }
    showResetPasswordModal.value = false
    username.value = resetUsername.value.trim()
    password.value = ''
    isLogin.value = true
    success.value = '密码重置成功，请使用新密码登录'
    resetNewPassword.value = ''
    resetConfirmPassword.value = ''
  }
  catch (e: any) {
    resetError.value = e?.response?.data?.error || e?.message || '重置失败'
  }
  finally {
    resetLoading.value = false
  }
}

async function checkCardClaimStatus() {
  try {
    const res = await api.get('/api/card-claim/status')
    if (res.data.ok) {
      cardClaimEnabled.value = res.data.enabled === true
    }
  }
  catch (e) {
    console.error('检查卡密领取状态失败:', e)
  }
}

async function claimFreeCard() {
  if (cardClaimLoading.value)
    return

  cardClaimLoading.value = true
  error.value = ''

  try {
    const res = await api.post('/api/card-claim/claim')

    if (res.data.ok) {
      cardCode.value = res.data.cardCode
      claimModalContent.value = {
        success: true,
        title: '领取成功',
        message: `成功领取 ${formatTimeDuration(res.data)}卡密！`,
        cardCode: res.data.cardCode,
        days: res.data.days,
      }
      showClaimModal.value = true
    }
    else {
      claimModalContent.value = {
        success: false,
        title: '领取失败',
        message: res.data.error || '领取失败，请稍后重试',
        cardCode: '',
        days: 0,
      }
      showClaimModal.value = true
    }
  }
  catch (e: any) {
    const data = e.response?.data
    claimModalContent.value = {
      success: false,
      title: '领取失败',
      message: data?.error || e.message || '领取失败',
      cardCode: '',
      days: 0,
    }
    showClaimModal.value = true
  }
  finally {
    cardClaimLoading.value = false
  }
}

function closeClaimModal() {
  showClaimModal.value = false
}

onMounted(() => {
  checkCardClaimStatus()
  fetchGameVersion()
  appStore.fetchLoginPageConfig()
})

async function fetchGameVersion() {
  try {
    const res = await api.get('/api/game-version')
    if (res.data.ok) {
      gameVersion.value = res.data.clientVersion
    }
  }
  catch (e) {
    console.error('获取游戏版本失败:', e)
  }
}
</script>

<template>
  <div class="login-container">
    <div class="bg-decoration" aria-hidden="true">
      <div class="sky-gradient" />
      <div class="ground-pattern" />
      <div class="sun-decoration" />
      <div class="plant-decoration plant-left" />
      <div class="plant-decoration plant-right" />
    </div>

    <main class="login-card">
      <div class="logo-area">
        <div class="logo-icon">
          <img
            v-if="loginLinks.logoUrl && !logoLoadFailed"
            :src="loginLinks.logoUrl"
            :alt="`${loginLinks.title || 'QQ农场智能助手'}图标`"
            class="logo-image"
            @error="logoLoadFailed = true"
          >
          <div v-else class="i-carbon-home text-3xl" />
        </div>
        <h1 class="logo-title">
          {{ loginLinks.title || 'QQ农场智能助手' }}
        </h1>
        <p class="logo-subtitle">
          {{ isLogin
            ? (loginLinks.loginSubtitle || '欢迎回来，开启智慧农耕之旅')
            : (loginLinks.registerSubtitle || '创建账号，开启智慧农耕之旅') }}
        </p>
      </div>

      <form class="form-area" @submit.prevent="handleSubmit">
        <div class="form-group">
          <label class="form-label">
            <span class="label-icon i-carbon-user" />
            用户名
          </label>
          <BaseInput
            id="username"
            v-model="username"
            type="text"
            placeholder="请输入用户名（3-32位字母数字下划线）"
            required
          />
          <p v-if="username && !usernameValid.valid" class="form-hint error">
            {{ usernameValid.message }}
          </p>
        </div>

        <div class="form-group">
          <label class="form-label">
            <span class="label-icon i-carbon-password" />
            密码
          </label>
          <BaseInput
            id="password"
            v-model="password"
            type="password"
            placeholder="请输入密码"
            required
          />
          <PasswordStrengthMeter
            v-if="showPasswordStrength && password"
            :strength="passwordStrength"
            compact
          />
          <div v-if="error" class="message error-message">
            <span class="message-icon i-carbon-warning" />
            <div class="message-content">
              {{ error }}
              <span v-if="lockoutRemaining > 0" class="lockout-timer">
                ({{ lockoutRemaining }} 分钟后解锁)
              </span>
              <span v-if="rateLimitRemaining > 0" class="lockout-timer">
                ({{ rateLimitRemaining }} 秒后可重试)
              </span>
            </div>
          </div>
          <div v-if="success" class="message success-message">
            <span class="message-icon i-carbon-checkmark-filled" />
            {{ success }}
          </div>
        </div>

        <div v-if="!isLogin" class="form-group">
          <label class="form-label">
            <span class="label-icon i-carbon-ticket" />
            卡密
          </label>

          <div v-if="cardClaimEnabled" class="mb-2">
            <button
              type="button"
              class="claim-card-btn"
              :disabled="cardClaimLoading"
              @click="claimFreeCard"
            >
              <span v-if="cardClaimLoading" class="i-svg-spinners-90-ring-with-bg" />
              <span v-else>免费领取卡密</span>
            </button>
          </div>

          <BaseInput
            id="cardCode"
            v-model="cardCode"
            type="text"
            placeholder="请输入卡密"
            :required="!isLogin"
          />
        </div>

        <BaseButton
          type="submit"
          variant="primary"
          block
          :loading="loading"
          class="submit-btn"
        >
          <span v-if="!loading">{{ isLogin ? '登录' : '注册' }}</span>
        </BaseButton>
      </form>

      <div class="switch-area" :class="{ 'single-action': !isLogin }">
        <button
          type="button"
          class="switch-btn"
          @click="toggleMode"
        >
          {{ isLogin ? '立即注册' : '立即登录' }}
        </button>
        <div v-if="isLogin" class="login-quick-actions">
          <button type="button" class="quick-action-btn" @click="openResetVerifyModal">
            忘记密码
          </button>
          <button type="button" class="quick-action-btn" @click="openRenewal">
            账号续费
          </button>
        </div>
      </div>

      <div class="card-footer">
        <div class="footer-info">
          <a
            v-if="loginLinks.purchaseUrl"
            :href="loginLinks.purchaseUrl"
            class="footer-link purchase-link"
          >
            购买卡密
          </a>
          <a
            v-if="loginLinks.qqGroupUrl"
            :href="loginLinks.qqGroupUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="footer-link qq-group-link"
          >
            加入QQ群
          </a>
          <button
            type="button"
            class="footer-link update-log-link"
            @click="showUpdateLog = true"
          >
            更新日志
          </button>
        </div>
        <div v-if="gameVersion" class="game-version">
          当前游戏版本：{{ gameVersion }}
        </div>
      </div>
    </main>

    <LoginModals
      v-model:show-claim-modal="showClaimModal"
      v-model:show-reset-verify-modal="showResetVerifyModal"
      v-model:show-reset-password-modal="showResetPasswordModal"
      v-model:show-renewal-modal="showRenewalModal"
      v-model:reset-username="resetUsername"
      v-model:reset-card-code="resetCardCode"
      v-model:reset-new-password="resetNewPassword"
      v-model:reset-confirm-password="resetConfirmPassword"
      v-model:reset-password-touched="resetPasswordTouched"
      v-model:renewal-username="renewalUsername"
      v-model:renewal-card-code="renewalCardCode"
      :claim-modal-content="claimModalContent"
      :reset-error="resetError"
      :reset-loading="resetLoading"
      :reset-password-strength="resetPasswordStrength"
      :renewal-error="renewalError"
      :renewal-success="renewalSuccess"
      :renewal-loading="renewalLoading"
      @close-claim="closeClaimModal"
      @close-reset-verify="closeResetVerifyModal"
      @close-reset-password="closeResetPasswordModal"
      @close-renewal="closeRenewalModal"
      @verify-reset-password="verifyResetPassword"
      @submit-reset-password="submitResetPassword"
      @submit-renewal="submitRenewal"
    />

    <UpdateLogModal :show="showUpdateLog" @close="showUpdateLog = false" />
  </div>
</template>

<style scoped>
.login-container {
  min-height: 100vh;
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(180deg, #cfe8f9 0%, #edf7f9 48%, #fef9e8 55%, #eff8df 100%);
  font-family:
    'Noto Sans SC',
    -apple-system,
    BlinkMacSystemFont,
    'Segoe UI',
    sans-serif;
  position: relative;
  overflow: hidden;
  padding: 24px;
}

.bg-decoration {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
}

.sky-gradient {
  position: absolute;
  top: 0;
  right: 0;
  left: 0;
  height: 56%;
  background: linear-gradient(180deg, rgba(187, 222, 251, 0.42) 0%, rgba(255, 249, 230, 0.55) 100%);
}

.ground-pattern {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  height: 45%;
  opacity: 0.58;
  background:
    repeating-linear-gradient(
      90deg,
      rgba(129, 199, 132, 0.04) 0,
      rgba(129, 199, 132, 0.04) 40px,
      rgba(255, 255, 255, 0.12) 40px,
      rgba(255, 255, 255, 0.12) 80px
    ),
    linear-gradient(180deg, #f1f8e9 0%, #dcedc8 100%);
}

.sun-decoration {
  position: absolute;
  top: 8%;
  right: 12%;
  width: 78px;
  height: 78px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(255, 224, 130, 0.75) 0%, rgba(255, 213, 79, 0.44) 52%, transparent 72%);
  filter: blur(1px);
}

.plant-decoration {
  position: absolute;
  bottom: 6%;
  width: 72px;
  height: 120px;
  opacity: 0.18;
}

.plant-decoration::before,
.plant-decoration::after {
  content: '';
  position: absolute;
  border-radius: 999px 999px 999px 0;
  background: #81c784;
  transform-origin: bottom center;
}

.plant-decoration::before {
  left: 28px;
  bottom: 42px;
  width: 28px;
  height: 48px;
  transform: rotate(34deg);
}

.plant-decoration::after {
  left: 12px;
  bottom: 46px;
  width: 30px;
  height: 44px;
  transform: rotate(-36deg);
}

.plant-decoration {
  background: linear-gradient(86deg, transparent 45%, #81c784 47%, #81c784 53%, transparent 55%) bottom center / 30px
    76px no-repeat;
}

.plant-left {
  left: 9%;
}

.plant-right {
  right: 9%;
  transform: scaleX(-1);
}

.login-card {
  width: 100%;
  max-width: 420px;
  min-height: 620px;
  padding: 46px 36px 34px;
  background: rgba(255, 255, 255, 0.94);
  border: 1px solid rgba(102, 187, 106, 0.22);
  border-radius: 18px;
  box-shadow:
    0 18px 56px rgba(46, 125, 50, 0.12),
    0 8px 28px rgba(15, 23, 42, 0.08);
  position: relative;
  z-index: 10;
  backdrop-filter: blur(18px);
}

.logo-area {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0;
  text-align: center;
  margin-bottom: 34px;
}

.logo-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 74px;
  height: 74px;
  flex: 0 0 auto;
  background: #e8f5e9;
  border: 3px solid #66bb6a;
  border-radius: 50%;
  color: #43a047;
  margin-bottom: 24px;
  box-shadow: 0 6px 18px rgba(102, 187, 106, 0.16);
}

.logo-title {
  color: #2e7d32;
  font-size: 1.82rem;
  font-weight: 700;
  line-height: 1.2;
  margin: 0;
  max-width: 100%;
  overflow-wrap: anywhere;
}

.logo-subtitle {
  color: #757575;
  font-size: 0.9rem;
  margin: 10px 0 0;
  max-width: 100%;
  overflow-wrap: anywhere;
}

.logo-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 50%;
}

.form-area {
  display: flex;
  flex-direction: column;
  gap: 22px;
}

.login-card :deep(.base-input) {
  min-height: 42px;
  border-color: #d7dce2;
  border-radius: 8px;
  background: #fafafa;
  padding: 10px 12px;
  font-size: 0.94rem;
}

.login-card :deep(.base-input:focus) {
  border-color: #66bb6a;
  background: #ffffff;
  box-shadow: 0 0 0 3px rgba(102, 187, 106, 0.16);
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.form-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.875rem;
  font-weight: 700;
  color: #558b2f;
}

.label-icon {
  color: #7cb342;
  font-size: 1rem;
}

.form-hint {
  font-size: 0.75rem;
  color: #64748b;
  margin-top: 4px;
}

.form-hint.error {
  color: #ef5350;
}

.lockout-timer {
  display: block;
  font-size: 0.75rem;
  opacity: 0.8;
  margin-top: 2px;
}

.message {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 10px;
  font-size: 0.875rem;
  line-height: 1.45;
}

.message-icon {
  flex: 0 0 auto;
  font-size: 1rem;
  margin-top: 1px;
}

.error-message {
  background: #fef2f2;
  color: #c62828;
  border: 1px solid #fecaca;
}

.success-message {
  background: #f0fdf4;
  color: #166534;
  border: 1px solid #bbf7d0;
}

.submit-btn {
  margin-top: 6px;
  height: 52px;
  font-size: 1rem;
  font-weight: 700;
  border-radius: 10px;
  box-shadow: 0 8px 18px rgba(76, 175, 80, 0.32);
  transition: all 0.25s ease;
}

.submit-btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 10px 24px rgba(76, 175, 80, 0.38);
}

.submit-btn:active {
  transform: translateY(0);
}

.switch-area {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  margin-top: 22px;
  text-align: center;
}

.switch-area.single-action {
  grid-template-columns: 1fr;
}

.switch-btn {
  background: #ffffff;
  border: 1px solid #e0e0e0;
  color: #757575;
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
  padding: 12px 16px;
  border-radius: 10px;
  transition: all 0.2s ease;
}

.switch-btn:hover {
  background: #f0fdf4;
  border-color: #86efac;
  color: #15803d;
}

.login-quick-actions {
  display: contents;
}

.quick-action-btn {
  background: #ffffff;
  border: 1px solid #e0e0e0;
  border-radius: 10px;
  color: #757575;
  cursor: pointer;
  font-size: 0.875rem;
  font-weight: 600;
  padding: 12px 14px;
  transition: all 0.2s ease;
}

.quick-action-btn:hover {
  background: #f0fdf4;
  color: #166534;
}

.card-footer {
  text-align: center;
  margin-top: 28px;
  color: #94a3b8;
  font-size: 0.8rem;
}

.footer-info {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-size: 0.75rem;
  color: #94a3b8;
}

.footer-link {
  border-radius: 6px;
  padding: 5px 10px;
  font-weight: 700;
  text-decoration: none;
  transition: all 0.2s ease;
  cursor: pointer;
}

.footer-link:hover {
  text-decoration: none;
}

.purchase-link {
  color: #166534;
  background: #dcfce7;
  border: 1px solid #bbf7d0;
}

.purchase-link:hover {
  background: #bbf7d0;
}

.qq-group-link {
  color: #075985;
  background: #e0f2fe;
  border: 1px solid #bae6fd;
}

.qq-group-link:hover {
  background: #bae6fd;
}

.update-log-link {
  color: #854d0e;
  background: #fef9c3;
  border: 1px solid #fde047;
  font-size: inherit;
}

.update-log-link:hover {
  color: #713f12;
  background: #fef08a;
}

.game-version {
  margin-top: 8px;
  font-size: 0.7rem;
  color: #94a3b8;
  text-align: center;
}

.claim-card-btn {
  width: 100%;
  padding: 9px 14px;
  background: #f0fdf4;
  border: 1px solid #bbf7d0;
  border-radius: 8px;
  color: #15803d;
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
}

.claim-card-btn:hover {
  border-color: #86efac;
  background: #dcfce7;
}

.claim-card-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

@media (max-width: 480px) {
  .login-container {
    align-items: flex-start;
    padding: 16px;
  }

  .login-card {
    padding: 24px;
    border-radius: 14px;
  }

  .logo-icon {
    width: 46px;
    height: 46px;
  }

  .logo-title {
    font-size: 1.25rem;
  }

  .plant-decoration {
    display: none;
  }
}
</style>
