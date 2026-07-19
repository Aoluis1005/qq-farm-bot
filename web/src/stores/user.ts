import { useStorage } from '@vueuse/core'
import { defineStore } from 'pinia'
import { computed } from 'vue'
import api from '@/api'

export interface UserCard {
  code: string
  description: string
  days: number
  durationValue?: number
  durationUnit?: 'hour' | 'day'
  durationMs?: number | null
  isPermanent?: boolean
  expiresAt: number | null
  enabled: boolean
}

export interface User {
  username: string
  role: 'admin' | 'super_admin' | 'user'
  card: UserCard | null
  accountLimit: number
  avatar?: string
  mustChangePassword?: boolean
}

export interface LoginResult {
  ok: boolean
  error?: string
  errorType?: 'rate_limit' | 'locked' | 'invalid_credentials'
  remainingMs?: number
  data?: {
    token: string
    role: User['role']
    card: UserCard | null
    accountLimit: number
    user: { username: string }
    mustChangePassword?: boolean
  }
}

export interface Card {
  code: string
  description: string
  days: number
  value?: number
  durationValue?: number
  durationUnit?: 'hour' | 'day'
  durationMs?: number | null
  isPermanent?: boolean
  type: 'time' | 'quota'
  enabled: boolean
  usedBy: string | null
  usedAt: number | null
  createdAt: number
}

function formatNumber(value: number) {
  if (Number.isInteger(value))
    return String(value)
  return Number(value.toFixed(2)).toString()
}

function formatDurationMs(durationMs: number) {
  const totalHours = Math.round(durationMs / 3600000)
  const days = Math.floor(totalHours / 24)
  const hours = totalHours % 24
  if (days > 0 && hours > 0)
    return `${days}天${hours}小时`
  if (days > 0)
    return `${days}天`
  if (hours > 0)
    return `${hours}小时`
  return '未激活'
}

export function getCardQuotaValue(card: Partial<Card> | Partial<UserCard> | null | undefined) {
  return Number((card as Partial<Card>)?.value ?? card?.days ?? 0)
}

export function formatTimeDuration(card: Partial<Card> | Partial<UserCard> | null | undefined) {
  if (!card)
    return '无'
  if (card.isPermanent === true || card.days === -1 || card.durationValue === -1)
    return '永久'
  const durationMs = Number(card.durationMs)
  if (Number.isFinite(durationMs) && durationMs > 0)
    return formatDurationMs(durationMs)
  const durationValue = Number(card.durationValue)
  const durationUnit = card.durationUnit === 'hour' ? 'hour' : 'day'
  if (Number.isFinite(durationValue) && durationValue > 0)
    return `${formatNumber(durationValue)}${durationUnit === 'hour' ? '小时' : '天'}`
  const days = Number(card.days)
  if (Number.isFinite(days) && days > 0)
    return `${formatNumber(days)}天`
  return '未激活'
}

export function formatCardValue(card: Card) {
  if (card.type === 'quota')
    return `+${formatNumber(getCardQuotaValue(card))}额度`
  return formatTimeDuration(card)
}

export const useUserStore = defineStore('user', () => {
  const token = useStorage('admin_token', '')
  const userInfo = useStorage<User | null>('user_info', null)
  const isLoggedIn = computed(() => !!token.value)
  const isAdmin = computed(() => userInfo.value?.role === 'admin' || userInfo.value?.role === 'super_admin')
  const isSuperAdmin = computed(() => userInfo.value?.role === 'super_admin')
  const username = computed(() => userInfo.value?.username || '')
  const userCard = computed(() => userInfo.value?.card)
  const accountLimit = computed(() => userInfo.value?.accountLimit ?? 2)
  const avatar = computed(() => userInfo.value?.avatar || '')

  // 检查用户是否过期
  const isExpired = computed(() => {
    if (!userInfo.value?.card?.expiresAt)
      return false
    return Date.now() > userInfo.value.card.expiresAt
  })

  // 获取过期时间显示
  const expireTimeText = computed(() => {
    if (!userInfo.value?.card)
      return '无卡密'
    if (userInfo.value.card.isPermanent === true || userInfo.value.card.days === -1)
      return '永久有效'
    if (!userInfo.value.card.expiresAt)
      return '未激活'
    const date = new Date(userInfo.value.card.expiresAt)
    return date.toLocaleString('zh-CN')
  })

  async function login(username: string, password: string): Promise<LoginResult> {
    try {
      const res = await api.post('/api/login', { username, password })
      if (res.data.ok) {
        token.value = res.data.data.token
        userInfo.value = {
          username: res.data.data.user.username,
          role: res.data.data.role,
          card: res.data.data.card,
          accountLimit: res.data.data.accountLimit ?? 2,
          mustChangePassword: res.data.data.mustChangePassword,
        }
      }
      return res.data
    }
    catch (error: any) {
      const data = error.response?.data
      if (data) {
        return {
          ok: false,
          error: data.error,
          errorType: data.errorType,
          remainingMs: data.remainingMs,
        }
      }
      return { ok: false, error: error.message || '网络错误' }
    }
  }

  async function register(username: string, password: string, cardCode: string) {
    const res = await api.post('/api/register', { username, password, cardCode })
    return res.data
  }

  async function logout() {
    try {
      await api.post('/api/logout')
    }
    finally {
      token.value = ''
      userInfo.value = null
    }
  }

  async function fetchUserInfo() {
    try {
      const res = await api.get('/api/user/me')
      if (res.data.ok) {
        userInfo.value = res.data.data
      }
      return res.data
    }
    catch {
      return { ok: false }
    }
  }

  async function renew(cardCode: string) {
    const res = await api.post('/api/user/renew', { cardCode })
    if (res.data.ok) {
      // 更新本地用户信息
      if (userInfo.value) {
        userInfo.value.card = res.data.data.card
        userInfo.value.accountLimit = res.data.data.accountLimit
      }
    }
    return res.data
  }

  async function changePassword(oldPassword: string, newPassword: string) {
    const res = await api.post('/api/user/change-password', { oldPassword, newPassword })
    return res.data
  }

  async function verifyResetPassword(username: string, cardCode: string) {
    const res = await api.post('/api/public/reset-password/verify', { username, cardCode })
    return res.data
  }

  async function resetPassword(username: string, cardCode: string, newPassword: string) {
    const res = await api.post('/api/public/reset-password/confirm', { username, cardCode, newPassword })
    return res.data
  }

  // 管理员功能
  async function getAllUsers() {
    const res = await api.get('/api/admin/users')
    return res.data
  }

  async function getLoginLogs(limit = 100, offset = 0) {
    const res = await api.get('/api/admin/login-logs', { params: { limit, offset } })
    return res.data
  }

  async function clearLoginLogs(payload?: { confirmed?: boolean, confirmText?: string }) {
    const res = await api.delete('/api/admin/login-logs', { data: payload })
    return res.data
  }

  async function clearExpiredUsers(payload?: { confirmed?: boolean, confirmText?: string }) {
    const res = await api.post('/api/admin/users/clear-expired', payload)
    return res.data
  }

  async function updateUser(username: string, updates: Partial<UserCard>, payload?: { confirmed?: boolean, confirmText?: string }) {
    const res = await api.post(`/api/admin/users/${username}`, { ...updates, ...payload })
    return res.data
  }

  async function deleteUser(username: string, payload?: { confirmed?: boolean, confirmText?: string }) {
    const res = await api.delete(`/api/admin/users/${username}`, { data: payload })
    return res.data
  }

  async function renewUser(username: string, cardCode: string, payload?: { confirmed?: boolean, confirmText?: string }) {
    const res = await api.post(`/api/admin/users/${username}/renew`, { cardCode, ...payload })
    return res.data
  }

  async function getAllCards() {
    const res = await api.get('/api/admin/cards')
    return res.data
  }

  async function createCard(
    description: string,
    days: number,
    count?: number,
    type?: 'time' | 'quota',
    payload?: {
      confirmed?: boolean
      confirmText?: string
      durationValue?: number
      durationUnit?: 'hour' | 'day'
      value?: number
    },
  ) {
    const res = await api.post('/api/admin/cards', { description, days, count, type, ...payload })
    return res.data
  }

  async function updateCard(code: string, updates: Partial<Card>, payload?: { confirmed?: boolean, confirmText?: string }) {
    const res = await api.post(`/api/admin/cards/${code}`, { ...updates, ...payload })
    return res.data
  }

  async function deleteCard(code: string, payload?: { confirmed?: boolean, confirmText?: string }) {
    const res = await api.delete(`/api/admin/cards/${code}`, { data: payload })
    return res.data
  }

  async function deleteCardsBatch(codes: string[], payload?: { confirmed?: boolean, confirmText?: string }) {
    const res = await api.post('/api/admin/cards/batch-delete', { codes, ...payload })
    return res.data
  }

  return {
    token,
    userInfo,
    isLoggedIn,
    isAdmin,
    isSuperAdmin,
    username,
    userCard,
    accountLimit,
    avatar,
    isExpired,
    expireTimeText,
    login,
    register,
    logout,
    fetchUserInfo,
    renew,
    changePassword,
    verifyResetPassword,
    resetPassword,
    getAllUsers,
    getLoginLogs,
    clearLoginLogs,
    clearExpiredUsers,
    updateUser,
    deleteUser,
    renewUser,
    getAllCards,
    createCard,
    updateCard,
    deleteCard,
    deleteCardsBatch,
  }
})
