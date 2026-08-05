<script setup lang="ts">
import { useIntervalFn } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import api from '@/api'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import DashboardTabs from '@/components/DashboardTabs.vue'
import FarmPanel from '@/components/FarmPanel.vue'
import BagPanel from '@/components/BagPanel.vue'
import TaskPanel from '@/components/TaskPanel.vue'
import DogGiftsPanel from '@/components/DogGiftsPanel.vue'
import FriendsTabContent from '@/components/DashboardFriendsTab.vue'
import AutomationSettingsTab from '@/components/settings/AutomationSettingsTab.vue'
import StrategySettingsTab from '@/components/settings/StrategySettingsTab.vue'
import Illustrated from '@/views/Illustrated.vue'
import Analytics from '@/views/Analytics.vue'
import { useAutomationSettings } from '@/composables/settings/useAutomationSettings'
import { useStrategySettings } from '@/composables/settings/useStrategySettings'
import { useSettingStore } from '@/stores/setting'
import AccountModal from '@/components/AccountModal.vue'
import CareerModal from '@/components/CareerModal.vue'
import { useAccountStore } from '@/stores/account'
import { useBagStore } from '@/stores/bag'
import { useStatusStore } from '@/stores/status'
import { useToastStore } from '@/stores/toast'
import { formatCouponAmount, formatGoldAmount, formatGoldBeanAmount } from '@/utils/number-format'
import ThemeToggle from '@/components/ThemeToggle.vue'
import { useAppStore } from '@/stores/app'
const statusStore = useStatusStore()
const accountStore = useAccountStore()
const bagStore = useBagStore()
const toastStore = useToastStore()

const {
  status,
  logs: statusLogs,
  accountLogs: statusAccountLogs,
  realtimeConnected,
  currentStatusReady,
} = storeToRefs(statusStore)
const { currentAccountId, currentAccount } = storeToRefs(accountStore)
const { dashboardItems } = storeToRefs(bagStore)

const showAccountDropdown = ref(false)
const showAccountModal = ref(false)
const showCareerModal = ref(false)
const appStore = useAppStore()
const startBtnStyle = computed(() => appStore.isDark
  ? { background: 'linear-gradient(135deg, #1e3a8a, #3730a3)', boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.4)' }
  : { background: 'linear-gradient(135deg, #3b82f6, #6366f1)', boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.1)' })
const startAllLoading = ref(false)
const startAllResults = ref<{ name: string; ok: boolean; msg: string }[]>([])
const showStartAllModal = ref(false)
const accountToEdit = ref<any>(null)

function openCareerModal() {
  showCareerModal.value = true
}

// 关闭下拉（点击外部）
onMounted(() => {
  document.addEventListener('click', closeAccountDropdown)
  // 初始化主题
  if (localStorage.getItem('theme-override') === 'dark') {
    document.documentElement.classList.add('dark')
  }
})
onUnmounted(() => {
  document.removeEventListener('click', closeAccountDropdown)
})
function closeAccountDropdown(e: MouseEvent) {
  const el = (e.target as HTMLElement)
  if (!el.closest('[data-account-dropdown]')) showAccountDropdown.value = false
}
async function handleAccountSaved() {
  showAccountModal.value = false
  accountToEdit.value = null
  await accountStore.fetchAccounts()
}

// 一键启动
const allAccountsRunning = computed(() => {
  const accs = accountStore.accounts
  return accs.length > 0 && accs.every(a => a.running)
})

async function startAllAccounts() {
  if (startAllLoading.value) return
  startAllLoading.value = true
  startAllResults.value = []

  const accs = accountStore.accounts
  const toStart = accs.filter(a => !a.running)

  if (toStart.length === 0) {
    // 全部在线，执行全部停止
    for (const acc of accs) {
      try {
        await accountStore.stopAccount(String(acc.id))
        startAllResults.value.push({ name: acc.name || acc.nick || acc.id, ok: true, msg: '已停止' })
      } catch {
        startAllResults.value.push({ name: acc.name || acc.nick || acc.id, ok: false, msg: '停止失败' })
      }
    }
  } else {
    // 启动所有离线账号
    for (const acc of toStart) {
      try {
        await api.post(`/api/accounts/${acc.id}/start`)
      } catch {
        startAllResults.value.push({ name: acc.name || acc.nick || acc.id, ok: false, msg: '启动失败，请重新扫码' })
      }
    }
    // 等待 5 秒后检查实际运行状态
    await new Promise(r => setTimeout(r, 5000))
    await accountStore.fetchAccounts()
    const latest = accountStore.accounts
    for (const acc of toStart) {
      const updated = latest.find(a => String(a.id) === String(acc.id))
      if (updated?.running) {
        startAllResults.value.push({ name: acc.name || acc.nick || acc.id, ok: true, msg: '启动成功' })
      } else {
        startAllResults.value.push({ name: acc.name || acc.nick || acc.id, ok: false, msg: '启动失败，请重新扫码' })
      }
    }
  }

  startAllLoading.value = false
  showStartAllModal.value = true
}

// 当前账号的微信昵称（去括号备注）
const nickName = computed(() => {
  const acc = currentAccount.value
  if (!acc) return '选择账号'
  const status = statusStore.status?.status
  const live = status?.name && status?.name !== '未登录' ? String(status.name).trim() : ''
  return live || acc.nick || acc.name || acc.uin || acc.qq || '选择账号'
})

// 当前账号的头像 URL
const currentAvatarSrc = computed(() => {
  const acc = currentAccount.value
  if (!acc) return ''
  const status = statusStore.status?.status
  const live = status?.avatar || status?.avatarUrl || status?.avatar_url
  if (live) return String(live).trim()
  const qq = String(acc.uin || acc.qq || '').trim()
  if (/^\d+$/.test(qq)) return `https://q1.qlogo.cn/g?b=qq&nk=${qq}&s=100`
  return ''
})

// 头像加载失败处理
function onAvatarError(e: Event) {
  const t = e.target as HTMLImageElement | null
  if (t) t.style.display = 'none'
}

const logContainer = ref<HTMLElement | null>(null)
const autoScroll = ref(true)
const lastBagFetchAt = ref(0)
const clearingLogs = ref(false)

const filter = reactive({
  module: '',
  event: '',
  keyword: '',
  isWarn: '',
})

const hasActiveLogFilter = computed(() =>
  !!(filter.module || filter.event || filter.keyword || filter.isWarn),
)
const activeTab = ref('overview')
const panelEl = ref<HTMLElement | null>(null)

const swipeStart = { x: 0, y: 0 }
function onSwipeStart(e: TouchEvent) {
  const t = e.changedTouches && e.changedTouches[0]
  if (!t) return
  swipeStart.x = t.clientX
  swipeStart.y = t.clientY
}
function onSwipeEnd(e: TouchEvent) {
  const t = e.changedTouches && e.changedTouches[0]
  if (!t) return
  const dx = t.clientX - swipeStart.x
  const dy = t.clientY - swipeStart.y
  if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
    const idx = dashboardTabs.findIndex((it) => it.key === activeTab.value)
    if (idx === -1) return
    const next = dx < 0 ? idx + 1 : idx - 1
    const target = dashboardTabs[next]
    if (target) activeTab.value = target.key

  }
}

// 切换 tab 时给内容区一个轻微淡入，缓解滑动卡顿观感
watch(activeTab, () => {
  const el = panelEl.value
  if (!el) return
  el.classList.remove('tab-fade')
  void el.offsetWidth
  el.classList.add('tab-fade')
})

const dashboardTabs = [
  { key: 'overview', label: '概览', icon: 'i-carbon-chart-pie' },
  { key: 'farm', label: '农场', icon: 'i-carbon-tree' },
  { key: 'bag', label: '背包', icon: 'i-carbon-backpack' },
  { key: 'friends', label: '好友', icon: 'i-carbon-user-multiple' },
  { key: 'pet', label: '宠物', icon: 'i-carbon-dog-walker' },
  { key: 'tasks', label: '任务', icon: 'i-carbon-task' },
  { key: 'automation', label: '自动控制', icon: 'i-carbon-settings-adjust' },
  { key: 'strategy', label: '策略设置', icon: 'i-carbon-settings' },
  { key: 'illustrated', label: '图鉴', icon: 'i-carbon-book' },
  { key: 'analytics', label: '分析', icon: 'i-carbon-analytics' },
]

const settingStore = useSettingStore()
function showAlert(message: string, _type: 'primary' | 'danger' = 'primary') {
  toastStore.info(message)
}

const {
  localAutomationSettings,
  automationSaving,
  fertilizerLandTypeOptions,
  fertilizerOptions,
  syncLocalAutomationSettings,
  saveAutomationSettings,
} = useAutomationSettings({
  currentAccountId,
  showAlert,
})

const {
  settingsLoading,
  strategySaving,
  localStrategySettings,
  plantingStrategyOptions,
  bagFallbackStrategyOptions,
  bagSeeds,
  bagSeedsLoading,
  bagSeedsError,
  sortedBagSeeds,
  preferredSeedOptions,
  strategyPreviewLabel,
  resetBagSeedPriority,
  moveBagSeed,
  removeBagSeedPriority,
  startBagSeedDrag,
  dragOverBagSeed,
  dropBagSeed,
  loadStrategyData,
  saveStrategySettings,
  resetStrategyState,
} = useStrategySettings({
  currentAccountId,
  getAutomationSettings: () => ({ automation: localAutomationSettings.value }),
  showAlert,
})

// 标记使用以消除 TS 未引用警告 (实际动态使用)
void settingStore.clearSettingsState
void resetStrategyState
void syncLocalAutomationSettings
void loadStrategyData

const currentAccountDisconnected = computed(() =>
  currentStatusReady.value && !status.value?.connection?.connected,
)

// 解析日志时间戳：后端 accountLog 的 time 为 "YYYY-MM-DD HH:mm:ss"（空格分隔，非标准 ISO），
// Chrome/V8 下 Date.parse 会返回 NaN。若回退到 Date.now()，旧日志会被错误地排到列表最底部「常驻」，
// 表现为“时间已过仍显示在日志最下方”。因此这里把空格替换为 'T' 转成 ISO 再解析。
function parseLogTs(time: any): number {
  if (time === null || time === undefined || time === '')
    return Date.now()
  const t = Number(time)
  if (!Number.isNaN(t) && t > 0)
    return t
  let s = String(time).trim()
  if (s.includes(' ') && /^\d{4}-\d{2}-\d{2} \d{1,2}:\d{2}(:\d{2})?/.test(s))
    s = s.replace(' ', 'T')
  const parsed = Date.parse(s)
  if (!Number.isNaN(parsed))
    return parsed
  return Date.now()
}

const allLogs = computed(() => {
  const sLogs = statusLogs.value || []
  const aLogs = (statusAccountLogs.value || []).map((log: any) => ({
    ts: parseLogTs(log.ts ?? log.time),
    time: log.time,
    tag: log.action === 'Error' ? '错误' : '系统',
    msg: log.reason ? `${log.msg} (${log.reason})` : log.msg,
    action: log.action,
    isAccountLog: true,
  }))

  const merged = [...sLogs, ...aLogs]
    .sort((a: any, b: any) => (a.ts || 0) - (b.ts || 0))

  // 配对标记：若某条「连接中断」重连日志之后存在对应的「已恢复在线」日志，
  // 则将其标记为已恢复，前端灰显，避免重连记录刷屏、常驻显眼位置。
  const recoverTsList = merged
    .filter((l: any) => l.action === 'reconnect_success' || /已恢复在线/.test(l.msg || ''))
    .map((l: any) => l.ts || 0)
  for (const log of merged) {
    const isInterrupt = log.action === 'ws_reconnect_failed' || /连接中断|重连失败/.test(log.msg || '')
    if (isInterrupt) {
      const recovered = recoverTsList.some(ts => ts > (log.ts || 0))
      if (recovered)
        log.recovered = true
    }
  }

  return merged
})

const modules = [
  { label: '全部模块', value: '' },
  { label: '农场', value: 'farm' },
  { label: '好友', value: 'friend' },
  { label: '仓库', value: 'warehouse' },
  { label: '任务', value: 'task' },
  { label: '系统', value: 'system' },
]

const events = [
  { label: '全部事件', value: '' },
  { label: '农场巡查', value: 'farm_cycle' },
  { label: '收获作物', value: 'harvest_crop' },
  { label: '清理枯枝', value: 'remove_plant' },
  { label: '种植种子', value: 'plant_seed' },
  { label: '施加化肥', value: 'fertilize' },
  { label: '土地提醒', value: 'lands_notify' },
  { label: '选择种子', value: 'seed_pick' },
  { label: '购买种子', value: 'seed_buy' },
  { label: '购买化肥', value: 'fertilizer_buy' },
  { label: '开启礼盒', value: 'fertilizer_gift_open' },
  { label: '获取任务', value: 'task_scan' },
  { label: '完成任务', value: 'task_claim' },
  { label: '免费礼包', value: 'mall_free_gifts' },
  { label: '分享奖励', value: 'daily_share' },
  { label: '会员礼包', value: 'vip_daily_gift' },
  { label: '月卡礼包', value: 'month_card_gift' },
  { label: '图鉴奖励', value: 'illustrated_rewards' },
  { label: '邮箱领取', value: 'email_rewards' },
  { label: '出售成功', value: 'sell_success' },
  { label: '土地升级', value: 'upgrade_land' },
  { label: '土地解锁', value: 'unlock_land' },
  { label: '好友巡查', value: 'friend_cycle' },
  { label: '访问好友', value: 'visit_friend' },
]

const logLevels = [
  { label: '全部级别', value: '' },
  { label: '普通', value: 'info' },
  { label: '警告', value: 'warn' },
]

const eventLabelMap: Record<string, string> = Object.fromEntries(
  events.filter(event => event.value).map(event => [event.value, event.label]),
)

const displayName = computed(() => {
  const account = accountStore.currentAccount
  const gameName = status.value?.status?.name

  if (gameName) {
    if (account?.name)
      return `${gameName} (${account.name})`
    return gameName
  }

  if (currentAccountDisconnected.value) {
    if (account) {
      if (account.name && account.nick)
        return `${account.nick} (${account.name})`
      return account.name || account.nick || '未登录'
    }
    return '未登录'
  }

  if (account) {
    if (account.name && account.nick)
      return `${account.nick} (${account.name})`
    return account.name || account.nick || '未命名'
  }

  return '未命名'
})

const expRate = computed(() => {
  const gain = status.value?.sessionExpGained || 0
  const uptime = status.value?.uptime || 0
  if (!uptime)
    return '0/小时'
  const rate = gain / (uptime / 3600)
  return `${Math.floor(rate)}/小时`
})

const timeToLevel = computed(() => {
  const gain = status.value?.sessionExpGained || 0
  const uptime = status.value?.uptime || 0
  const current = status.value?.levelProgress?.current || 0
  const needed = status.value?.levelProgress?.needed || 0

  if (!needed || !uptime || gain <= 0)
    return ''

  const ratePerHour = gain / (uptime / 3600)
  if (ratePerHour <= 0)
    return ''

  const expNeeded = Math.max(0, needed - current)
  const minsToLevel = expNeeded / (ratePerHour / 60)

  if (minsToLevel < 60)
    return `约 ${Math.ceil(minsToLevel)} 分钟后升级`
  return `约 ${(minsToLevel / 60).toFixed(1)} 小时后升级`
})

const fertilizerNormal = computed(() => dashboardItems.value.find((item: any) => Number(item.id) === 1011))
const fertilizerOrganic = computed(() => dashboardItems.value.find((item: any) => Number(item.id) === 1012))
const collectionNormal = computed(() => dashboardItems.value.find((item: any) => Number(item.id) === 3001))
const collectionRare = computed(() => dashboardItems.value.find((item: any) => Number(item.id) === 3002))

const nextFarmCheck = ref('--:--:--')
const nextHelpCheck = ref('--:--:--')
const nextStealCheck = ref('--:--:--')
const localUptime = ref(0)

let localNextFarmRemainSec = 0
let localNextHelpRemainSec = 0
let localNextStealRemainSec = 0
let localFarmTotalSec = 120
let localHelpTotalSec = 180
let localStealTotalSec = 120
let lastUpdateTime = Date.now()

// 圆环进度（requestAnimationFrame 实时驱动）
const farmPct = ref(0)
const helpPct = ref(0)
const stealPct = ref(0)

function animateProgress() {
  const now = Date.now()
  const elapsed = (now - lastUpdateTime) / 1000
  if (localNextFarmRemainSec > 0) {
    const remain = Math.max(0, localNextFarmRemainSec - elapsed)
    farmPct.value = localFarmTotalSec > 0 ? Math.min(1, remain / localFarmTotalSec) : 0
  } else { farmPct.value = 0 }
  if (localNextHelpRemainSec > 0) {
    const remain = Math.max(0, localNextHelpRemainSec - elapsed)
    helpPct.value = localHelpTotalSec > 0 ? Math.min(1, remain / localHelpTotalSec) : 0
  } else { helpPct.value = 0 }
  if (localNextStealRemainSec > 0) {
    const remain = Math.max(0, localNextStealRemainSec - elapsed)
    stealPct.value = localStealTotalSec > 0 ? Math.min(1, remain / localStealTotalSec) : 0
  } else { stealPct.value = 0 }
  requestAnimationFrame(animateProgress)
}

let rafStarted = false
function startProgressAnimation() {
  if (rafStarted) return
  rafStarted = true
  requestAnimationFrame(animateProgress)
}

function resetDashboardState() {
  lastBagFetchAt.value = 0
  localUptime.value = 0
  localNextFarmRemainSec = 0
  localNextHelpRemainSec = 0
  localNextStealRemainSec = 0
  nextFarmCheck.value = '--:--:--'
  nextHelpCheck.value = '--:--:--'
  nextStealCheck.value = '--:--:--'
}

const OP_META: Record<string, { label: string, icon: string, color: string }> = {
  harvest: { label: '收获', icon: 'i-carbon-crop-growth', color: 'text-green-500' },
  water: { label: '浇水', icon: 'i-carbon-rain-drop', color: 'text-blue-400' },
  weed: { label: '除草', icon: 'i-carbon-cut', color: 'text-yellow-500' },
  bug: { label: '除虫', icon: 'i-carbon-pest', color: 'text-red-400' },
  farming: { label: '一键务农', icon: 'i-carbon-clean', color: 'text-teal-500' },
  fertilize: { label: '施肥', icon: 'i-carbon-chemistry', color: 'text-emerald-500' },
  plant: { label: '种植', icon: 'i-carbon-tree', color: 'text-lime-500' },
  steal: { label: '偷菜', icon: 'i-carbon-run', color: 'text-orange-500' },
  helpWater: { label: '帮浇水', icon: 'i-carbon-rain-drop', color: 'text-blue-300' },
  goldenBugClear: { label: '清黄金虫', icon: 'i-carbon-clean', color: 'text-amber-500' },
  goldenBugPut: { label: '放黄金虫', icon: 'i-carbon-pest', color: 'text-yellow-500' },
  helpWeed: { label: '帮除草', icon: 'i-carbon-cut', color: 'text-yellow-400' },
  helpBug: { label: '帮除虫', icon: 'i-carbon-pest', color: 'text-red-300' },
  taskClaim: { label: '任务', icon: 'i-carbon-task-complete', color: 'text-indigo-500' },
  sell: { label: '收益', icon: 'i-carbon-money', color: 'text-pink-500' },
  tongQiGift: { label: '同气礼包', icon: 'i-carbon-gift', color: 'text-rose-500' },
}

const filteredOperations = computed(() => {
  const operations = status.value?.operations || {}
  const result: Record<string, number> = {}

  for (const key of Object.keys(operations)) {
    if (key !== 'upgrade' && key !== 'levelUp')
      result[key] = operations[key]
  }

  return result
})

const todayStatsExpanded = ref(false)

// 今日统计默认展示顺序（折叠时只看前6项）
const DEFAULT_KEYS = ['sell', 'tongQiGift', 'harvest', 'steal', 'plant', 'fertilize']

const todayStatsRows = computed(() => {
  const allKeys = Object.keys(filteredOperations.value)
  const keys = todayStatsExpanded.value
    ? DEFAULT_KEYS.concat(allKeys.filter(k => !DEFAULT_KEYS.includes(k)))
    : DEFAULT_KEYS

  // 排成 2 列行
  const rows: { key: string }[][] = []
  for (let i = 0; i < keys.length; i += 2) {
    const k1 = keys[i] || ""
    const k2 = keys[i + 1] || ""
    rows.push([{ key: k1 }, { key: k2 }])
  }
  return rows
})

function getEventLabel(event: string) {
  return eventLabelMap[event] || event
}

function formatBucketTime(item: any) {
  if (!item)
    return '0.0h'
  if (item.hoursText)
    return item.hoursText.replace('小时', 'h')
  return `${(Number(item.count || 0) / 3600).toFixed(1)}h`
}

function updateCountdowns() {
  if (currentAccountDisconnected.value) {
    nextFarmCheck.value = '账号未登录'
    nextHelpCheck.value = '账号未登录'
    nextStealCheck.value = '账号未登录'
    return
  }

  localUptime.value++

  if (localNextFarmRemainSec > 0) {
    localNextFarmRemainSec--
    nextFarmCheck.value = formatDuration(localNextFarmRemainSec)
  }
  else {
    nextFarmCheck.value = '检查中...'
  }

  if (localNextHelpRemainSec > 0) {
    localNextHelpRemainSec--
    nextHelpCheck.value = formatDuration(localNextHelpRemainSec)
  }
  else {
    nextHelpCheck.value = '检查中...'
  }

  if (localNextStealRemainSec > 0) {
    localNextStealRemainSec--
    nextStealCheck.value = formatDuration(localNextStealRemainSec)
  }
  else {
    nextStealCheck.value = '检查中...'
  }
}

watch(status, (newVal) => {
  if (newVal?.nextChecks) {
    const newFarmRemain = newVal.nextChecks.farmRemainSec || 0
    const newHelpRemain = newVal.nextChecks.helpRemainSec || 0
    const newStealRemain = newVal.nextChecks.stealRemainSec || 0
    // 新一轮检查：剩余时间比上次大，说明刚检查完重置了，此时剩余=这轮总时间
    if (newFarmRemain > localNextFarmRemainSec) localFarmTotalSec = newFarmRemain
    if (newHelpRemain > localNextHelpRemainSec) localHelpTotalSec = newHelpRemain
    if (newStealRemain > localNextStealRemainSec) localStealTotalSec = newStealRemain
    localNextFarmRemainSec = newFarmRemain
    localNextHelpRemainSec = newHelpRemain
    localNextStealRemainSec = newStealRemain
    lastUpdateTime = Date.now()
    updateCountdowns()
    startProgressAnimation()
  }

  if (newVal?.uptime !== undefined)
    localUptime.value = newVal.uptime
}, { deep: true })

function formatDuration(seconds: number) {
  if (seconds <= 0)
    return '00:00:00'

  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainSeconds = Math.floor(seconds % 60)
  const pad = (value: number) => value.toString().padStart(2, '0')

  if (days > 0)
    return `${days}天 ${pad(hours)}:${pad(minutes)}:${pad(remainSeconds)}`
  return `${pad(hours)}:${pad(minutes)}:${pad(remainSeconds)}`
}

function getLogTagClass(tag: string) {
  if (tag === '错误')
    return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
  if (tag === '系统')
    return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
  if (tag === '警告')
    return 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300'
  return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
}

function getLogMsgClass(tag: string) {
  if (tag === '错误')
    return 'text-red-600 dark:text-red-400'
  return 'text-gray-700 dark:text-gray-300'
}

function formatLogTime(timeStr: string) {
  if (!timeStr)
    return ''
  const parts = timeStr.split(' ')
  return parts.length > 1 ? parts[1] : timeStr
}

function getOpName(key: string | number) {
  return OP_META[String(key)]?.label || String(key)
}

function getOpIcon(key: string | number) {
  return OP_META[String(key)]?.icon || 'i-carbon-circle-dash'
}

function getOpColor(key: string | number) {
  return OP_META[String(key)]?.color || 'text-gray-400'
}

function getExpPercent(progress: any) {
  if (!progress || !progress.needed)
    return 0
  return Math.min(100, Math.max(0, (progress.current / progress.needed) * 100))
}

async function refreshBag(force = false) {
  if (!currentAccountId.value || !currentAccount.value?.running || !currentStatusReady.value || !status.value?.connection?.connected)
    return

  const now = Date.now()
  if (!force && now - lastBagFetchAt.value < 2500)
    return

  lastBagFetchAt.value = now
  await bagStore.fetchBag(currentAccountId.value)
}

async function refresh(forceReloadLogs = false) {
  if (!currentAccountId.value)
    return

  const account = currentAccount.value
  if (!account)
    return

  // 首次加载、断线回退时走 HTTP；实时连接正常时优先依赖 WS 推送。
  if (!realtimeConnected.value) {
    await statusStore.fetchStatus(currentAccountId.value)
    await statusStore.fetchAccountLogs(currentAccountId.value)
  }

  if (forceReloadLogs || hasActiveLogFilter.value || !realtimeConnected.value) {
    await statusStore.fetchLogs(currentAccountId.value, {
      module: filter.module || undefined,
      event: filter.event || undefined,
      keyword: filter.keyword || undefined,
      isWarn: filter.isWarn === 'warn' ? true : filter.isWarn === 'info' ? false : undefined,
    })
  }

  // 仅在账号运行且连接稳定后再拉背包，避免启动阶段出现 500。
  await refreshBag()
}

function syncRealtimeAccount() {
  if (currentAccountId.value)
    statusStore.connectRealtime(currentAccountId.value)
}

function onLogFilterChange() {
  refresh(true)
}

function onLogSearchTrigger() {
  refresh(true)
}

watch(currentAccountId, async (newId, oldId) => {
  if (oldId !== undefined && newId !== oldId) {
    statusStore.clearAccountScopedData()
    bagStore.clearBag()
    resetDashboardState()
  }
  syncRealtimeAccount()
  await refresh(true)
  scrollToBottom()
})

watch(() => status.value?.connection?.connected, (connected) => {
  if (connected)
    refreshBag(true)
})

watch(() => JSON.stringify(status.value?.operations || {}), (next, prev) => {
  if (!realtimeConnected.value || next === prev)
    return
  refreshBag()
})

watch(hasActiveLogFilter, (enabled) => {
  statusStore.setRealtimeLogsEnabled(!enabled)
  refresh()
})

function onLogScroll(event: Event) {
  const element = event.target as HTMLElement
  if (!element)
    return
  autoScroll.value = element.scrollHeight - element.scrollTop - element.clientHeight < 50
}

async function clearLogs() {
  if (!currentAccountId.value)
    return

  clearingLogs.value = true
  try {
    const { data } = await api.delete('/api/logs')
    if (data?.ok) {
      toastStore.success('日志已清空')
      await refresh(true)
    }
    else {
      toastStore.error(`清空失败: ${data?.error || '未知错误'}`)
    }
  }
  catch (error: any) {
    const message = error?.response?.data?.error || error?.message || '请求失败'
    toastStore.error(`清空失败: ${message}`)
  }
  finally {
    clearingLogs.value = false
  }
}

watch(allLogs, () => {
  nextTick(() => {
    if (logContainer.value && autoScroll.value)
      logContainer.value.scrollTop = logContainer.value.scrollHeight
  })
}, { deep: true })

function scrollToBottom() {
  nextTick(() => {
    if (logContainer.value)
      logContainer.value.scrollTop = logContainer.value.scrollHeight
  })
}

onMounted(async () => {
  statusStore.setRealtimeLogsEnabled(!hasActiveLogFilter.value)
  syncRealtimeAccount()
  await refresh()
  if (currentAccountId.value) {
    await loadStrategyData()
    syncLocalAutomationSettings()
  }
  scrollToBottom()
})

// Auto refresh fallback every 10s (WS 断开或启用筛选时回退 HTTP)
useIntervalFn(refresh, 10000)
// Countdown timer (every 1s)
useIntervalFn(updateCountdowns, 1000)
</script>

<template>
  <svg width="0" height="0" style="position:absolute">
    <defs>
      <linearGradient id="violetGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#818cf8" /><stop offset="100%" stop-color="#6366f1" />
      </linearGradient>
      <linearGradient id="coralGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#fb923c" /><stop offset="100%" stop-color="#f97316" />
      </linearGradient>
      <linearGradient id="emeraldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#34d399" /><stop offset="100%" stop-color="#10b981" />
      </linearGradient>
    </defs>
  </svg>
  <div ref="panelEl" class="flex flex-col gap-2 pt-1 md:pt-2 overflow-x-hidden" @touchstart="onSwipeStart" @touchend="onSwipeEnd">
    <!-- 首页子标签导航 -->

    <div class="sticky top-0 z-30 -mx-1 px-1 pt-1" style="transform: translateZ(0);">

      <DashboardTabs

        :tabs="dashboardTabs"

        :active-tab="activeTab"

        @update:active-tab="activeTab = $event"

      />

    </div>

    <!-- ===== 概览 ===== -->
    <div v-show="activeTab === 'overview'" class="overview-panel grid grid-cols-1 gap-4 lg:grid-cols-3 sm:grid-cols-2">
      <!-- 合并账号面板 -->
      <div class="overview-card">
        <div class="flex flex-col">
          <!-- 第一行：主题切换 + 居中标题 -->
          <div class="flex items-center px-5 py-3 border-b border-gray-100/80 dark:border-gray-700/80">
            <!-- 主题切换按钮 左 -->
            <ThemeToggle class="shrink-0 mr-2" />
            <div class="flex flex-1 items-center justify-center gap-2">
              <div class="i-fas-user-circle text-blue-500" />
              <span class="text-sm font-semibold text-gray-700 dark:text-gray-200">QQ农场智能助手</span>
            </div>
                        <button
              class="relative flex h-8 w-16 items-center justify-between rounded-full px-1.5 transition-all duration-300"
              :style="startBtnStyle"
              :disabled="startAllLoading"
              :title="startAllLoading ? '启动中' : (allAccountsRunning ? '停止' : '一键启动')"
              @click="startAllAccounts"
            >
              <div
                class="flex h-6 w-6 transform items-center justify-center rounded-full shadow-md transition-all duration-300"
                :class="[allAccountsRunning ? 'translate-x-[18px]' : 'translate-x-0', appStore.isDark ? 'bg-slate-700' : 'bg-white']"
              >
                <span v-if="startAllLoading" class="i-svg-spinners-90-ring-with-bg text-sm text-blue-500" />
                <span v-else-if="allAccountsRunning" class="i-carbon-stop-filled text-sm text-blue-600" />
                <span v-else class="i-carbon-play text-sm text-blue-600" />
              </div>
            </button>
          </div>

          <!-- 第二行：头像 + 数据 -->
          <div class="flex gap-4 px-5 py-4">
            <!-- 左侧头像块 -->
            <div class="flex w-[120px] shrink-0 flex-col items-center gap-2 pt-2">
              <!-- 头像 -->
              <div
                class="relative flex h-[80px] w-[80px] cursor-pointer items-center justify-center overflow-hidden rounded-[20px] bg-gradient-to-br from-gray-200 to-gray-300 ring-1 ring-gray-200 transition-transform hover:scale-[1.02] dark:from-gray-600 dark:to-gray-700 dark:ring-gray-600"
                title="查看生涯统计"
                @click="openCareerModal"
              >
                <img
                  v-if="currentAvatarSrc"
                  :src="currentAvatarSrc"
                  :alt="displayName"
                  class="h-full w-full object-cover"
                  @error="onAvatarError"
                >
                <div v-show="!currentAvatarSrc" class="text-3xl font-bold text-white dark:text-gray-300">
                  {{ (displayName || '?').charAt(0).toUpperCase() }}
                </div>
                <div class="absolute -bottom-[3px] left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border-2 border-white bg-blue-500 px-2 py-[1px] text-[10px] font-semibold text-white dark:border-gray-800">
                  Lv.{{ String(status?.status?.level ?? 0) }}
                </div>
              </div>

              <!-- 昵称 + 切换三角形（居中紧挨） -->
              <div data-account-dropdown class="relative flex items-center justify-center gap-0.5">
                <span class="max-w-[80px] truncate text-xs font-semibold text-gray-800 dark:text-gray-200" :title="String(nickName)">
                  {{ nickName }}
                </span>
                

              </div>

              <!-- EXP 进度条 -->
              <div class="w-full px-1">
                <div class="h-1.5 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700">
                  <div class="h-full rounded-full bg-blue-500 transition-all duration-500" :style="{ width: `${getExpPercent(status?.levelProgress)}%` }" />
                </div>
                <div class="mt-0.5 text-center text-[9px] text-gray-400">
                  EXP {{ status?.levelProgress?.current || 0 }} / {{ status?.levelProgress?.needed || '?' }}
                </div>
                <div class="mt-0.5 text-center text-[9px] text-gray-400">
                  效率: {{ expRate }}
                </div>
                <div class="text-center text-[9px] text-gray-400">{{ timeToLevel }}</div>
              </div>
            </div>

            <!-- 右侧数据（纵向排列） -->
            <div class="flex min-w-0 flex-1 flex-col">
              <!-- 数据行 -->
              <div class="flex items-center border-b border-gray-100/80 py-2.5 dark:border-gray-700/80">
                <div class="flex w-16 items-center gap-1.5 text-xs text-gray-500">
                  <div class="i-fas-coins text-yellow-500" />
                  <span>金币</span>
                </div>
                <div class="flex-1 text-right text-sm font-bold text-yellow-600 dark:text-yellow-500">
                  {{ formatGoldAmount(status?.status?.gold || 0) }}
                </div>
              </div>
              <div class="flex items-center border-b border-gray-100/80 py-2.5 dark:border-gray-700/80">
                <div class="flex w-16 items-center gap-1.5 text-xs text-gray-500">
                  <div class="i-fas-ticket-alt text-emerald-400" />
                  <span>点券</span>
                </div>
                <div class="flex-1 text-right text-sm font-bold text-emerald-500 dark:text-emerald-400">
                  {{ formatCouponAmount(status?.status?.coupon || 0) }}
                </div>
              </div>
              <div class="flex items-center border-b border-gray-100/80 py-2.5 dark:border-gray-700/80">
                <div class="flex w-16 items-center gap-1.5 text-xs text-gray-500">
                  <div class="i-carbon-circle text-amber-500" />
                  <span>金豆</span>
                </div>
                <div class="flex-1 text-right text-sm font-bold text-amber-500 dark:text-amber-400">
                  {{ formatGoldBeanAmount(status?.status?.goldBean || 0) }}
                </div>
              </div>
              <div class="flex items-center py-2.5">
                <div class="flex w-16 items-center gap-1.5 text-xs text-gray-500">
                  <div class="i-fas-clock text-purple-400" />
                  <span>在线</span>
                </div>
                <div class="flex flex-1 items-center justify-end gap-2 text-right text-sm font-bold text-gray-700 dark:text-gray-200">
                  <span class="inline-block h-2 w-2 rounded-full" :class="status?.connection?.connected ? 'bg-green-500' : currentStatusReady ? 'bg-red-500' : 'bg-gray-300'" />
                  {{ formatDuration(localUptime) }}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 今日统计（展开/折叠） -->
      <div class="overview-card p-5">
        <div class="mb-3 flex items-center justify-between">
          <div class="flex items-center gap-2 text-sm text-gray-500">
            <div class="i-carbon-chart-column" />
            <span>今日统计</span>
          </div>
          <div v-if="Object.keys(filteredOperations).length" class="flex items-center gap-1 text-xs text-gray-400 cursor-pointer select-none hover:text-blue-500" @click="todayStatsExpanded = !todayStatsExpanded">
            <span>{{ todayStatsExpanded ? '收起' : '展开' }}</span>
            <div class="i-carbon-chevron-down text-sm transition-transform duration-200" :class="{ 'rotate-180': todayStatsExpanded }" />
          </div>
        </div>

        <div v-if="currentAccountDisconnected" class="flex flex-col items-center justify-center gap-4 py-8 text-center text-gray-500">
          <div class="i-carbon-connection-signal-off text-4xl text-gray-400" />
          <div class="text-base font-medium text-gray-700 dark:text-gray-300">账号未登录</div>
          <div class="text-sm text-gray-400">请先运行账号或检查网络连接。</div>
        </div>
        <div v-else-if="!Object.keys(filteredOperations).length" class="flex flex-col items-center justify-center gap-3 py-6 text-center">
          <div class="i-carbon-chart-column text-3xl text-gray-300" />
          <div class="text-sm font-medium text-gray-600 dark:text-gray-300">暂无主动作统计</div>
          <div class="text-xs text-gray-400">通常是刚启动、刚切换账号，或本轮巡查尚未完成。</div>
        </div>
        <div v-else class="flex flex-col gap-2">
          <div
            v-for="(row, ri) in todayStatsRows"
            :key="ri"
            class="flex gap-2"
          >
            <div
              v-for="cell in row"
              :key="cell.key"
              class="flex flex-1 items-center justify-between rounded-lg px-3 py-2"
              :class="cell.key ? 'ui-subtle-panel' : 'invisible'"
            >
              <template v-if="cell.key">
                <div class="flex items-center gap-1.5">
                  <div class="text-sm" :class="[getOpIcon(cell.key), getOpColor(cell.key)]" />
                  <span class="text-xs text-gray-500">{{ getOpName(cell.key) }}</span>
                </div>
                <span class="text-sm font-bold">{{ filteredOperations[cell.key] }}</span>
              </template>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div v-show="activeTab === 'overview'" class="flex flex-1 flex-col items-stretch gap-5 md:flex-row">
      <!-- 倒计时圆环卡片 + 化肥容器（原 md:w-1/4，现放前面） -->
      <div class="flex flex-col gap-5 md:w-1/4">
        <div class="overview-card flex flex-col p-4">
          <div class="mb-3 flex items-center justify-center gap-1.5 text-xs text-gray-400 dark:text-gray-300 font-medium">
            <div class="i-carbon-hourglass" />
            <span>下次检查倒计时</span>
          </div>
          <div class="flex items-center justify-around py-1">
            <!-- 农场 -->
            <div class="relative flex flex-col items-center gap-1.5">
              <div class="relative flex items-center justify-center" style="width:78px;height:78px;">
                <svg class="absolute inset-0 w-full h-full" viewBox="0 0 36 36" style="transform:rotate(-90deg);">
                  <circle cx="18" cy="18" r="15.5" fill="none" stroke="rgba(128,128,128,0.12)" stroke-width="4.5" />
                  <circle cx="18" cy="18" r="15.5" fill="none" stroke="url(#violetGrad)" stroke-width="4.5" stroke-linecap="round" stroke-dasharray="97.4" :stroke-dashoffset="(97.4 * (1 - farmPct)).toFixed(2)" style="transition: stroke-dashoffset 0.3s linear;" />
                </svg>
                <div class="flex flex-col items-center leading-none">
                  <div class="text-xs font-bold tabular-nums" style="color:#a5b4fc;">{{ nextFarmCheck }}</div>
                  <div class="text-[9px] text-gray-500 dark:text-gray-400 mt-0.5">农场</div>
                </div>
              </div>
            </div>
            <!-- 帮助 -->
            <div class="relative flex flex-col items-center gap-1.5">
              <div class="relative flex items-center justify-center" style="width:78px;height:78px;">
                <svg class="absolute inset-0 w-full h-full" viewBox="0 0 36 36" style="transform:rotate(-90deg);">
                  <circle cx="18" cy="18" r="15.5" fill="none" stroke="rgba(128,128,128,0.12)" stroke-width="4.5" />
                  <circle cx="18" cy="18" r="15.5" fill="none" stroke="url(#coralGrad)" stroke-width="4.5" stroke-linecap="round" stroke-dasharray="97.4" :stroke-dashoffset="(97.4 * (1 - helpPct)).toFixed(2)" style="transition: stroke-dashoffset 0.3s linear;" />
                </svg>
                <div class="flex flex-col items-center leading-none">
                  <div class="text-xs font-bold tabular-nums" style="color:#fdba74;">{{ nextHelpCheck }}</div>
                  <div class="text-[9px] text-gray-500 dark:text-gray-400 mt-0.5">帮助</div>
                </div>
              </div>
            </div>
            <!-- 偷菜 -->
            <div class="relative flex flex-col items-center gap-1.5">
              <div class="relative flex items-center justify-center" style="width:78px;height:78px;">
                <svg class="absolute inset-0 w-full h-full" viewBox="0 0 36 36" style="transform:rotate(-90deg);">
                  <circle cx="18" cy="18" r="15.5" fill="none" stroke="rgba(128,128,128,0.12)" stroke-width="4.5" />
                  <circle cx="18" cy="18" r="15.5" fill="none" stroke="url(#emeraldGrad)" stroke-width="4.5" stroke-linecap="round" stroke-dasharray="97.4" :stroke-dashoffset="(97.4 * (1 - stealPct)).toFixed(2)" style="transition: stroke-dashoffset 0.3s linear;" />
                </svg>
                <div class="flex flex-col items-center leading-none">
                  <div class="text-xs font-bold tabular-nums" style="color:#6ee7b7;">{{ nextStealCheck }}</div>
                  <div class="text-[9px] text-gray-500 dark:text-gray-400 mt-0.5">偷菜</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 化肥容器卡片（保留原样） -->
        <div class="overview-card flex-1 p-5">
          <div class="mb-2 flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400">
            <div class="i-fas-flask text-emerald-400" />
            化肥容器
          </div>
          <div class="grid grid-cols-2 gap-2">
            <div>
              <div class="flex items-center gap-1 text-xs text-gray-400 dark:text-gray-300">
                <div class="i-fas-flask text-emerald-400" />
                普通
              </div>
              <div class="font-bold text-gray-800 dark:text-gray-100">{{ formatBucketTime(fertilizerNormal) }}</div>
            </div>
            <div>
              <div class="flex items-center gap-1 text-xs text-gray-400 dark:text-gray-300">
                <div class="i-fas-vial text-emerald-400" />
                有机
              </div>
              <div class="font-bold text-gray-800 dark:text-gray-100">{{ formatBucketTime(fertilizerOrganic) }}</div>
            </div>
          </div>
          <div class="my-3 border-t border-gray-100/80 dark:border-gray-700/80" />
          <div class="mb-1 flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400">
            <div class="i-fas-star text-emerald-400" />
            收藏点
          </div>
          <div class="grid grid-cols-2 gap-2">
            <div>
              <div class="flex items-center gap-1 text-xs text-gray-400 dark:text-gray-300">
                <div class="i-fas-bookmark text-emerald-400" />
                普通
              </div>
              <div class="font-bold text-gray-800 dark:text-gray-100">{{ collectionNormal?.count || 0 }}</div>
            </div>
            <div>
              <div class="flex items-center gap-1 text-xs text-gray-400 dark:text-gray-300">
                <div class="i-fas-gem text-emerald-400" />
                典藏
              </div>
              <div class="font-bold text-gray-800 dark:text-gray-100">{{ collectionRare?.count || 0 }}</div>
            </div>
          </div>
        </div>
      </div>

      <!-- 运行日志卡片（原 md:w-3/4，现放后面） -->
      <div class="flex flex-1 flex-col gap-5 md:w-3/4">
        <div class="overview-card flex flex-1 flex-col p-5 md:overflow-hidden">
          <div class="mb-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <h3 class="flex items-center gap-2 text-lg font-medium">
              <div class="i-carbon-document" />
              <span>运行日志</span>
            </h3>

            <div class="flex flex-wrap items-center gap-2 text-sm">
              <BaseSelect
                v-model="filter.module"
                :options="modules"
                class="w-32"
                @change="onLogFilterChange"
              />

              <BaseSelect
                v-model="filter.event"
                :options="events"
                class="w-32"
                @change="onLogFilterChange"
              />

              <BaseSelect
                v-model="filter.isWarn"
                :options="logLevels"
                class="w-32"
                @change="onLogFilterChange"
              />

              <BaseInput
                v-model="filter.keyword"
                placeholder="关键词..."
                class="w-32"
                clearable
                @keyup.enter="onLogSearchTrigger"
                @clear="onLogSearchTrigger"
              />

              <BaseButton
                variant="primary"
                size="sm"
                @click="onLogSearchTrigger"
              >
                <div class="i-carbon-search" />
              </BaseButton>

              <BaseButton
                variant="secondary"
                size="sm"
                :loading="clearingLogs"
                @click="clearLogs"
              >
                <div class="i-carbon-trash-can mr-1" />
                清空
              </BaseButton>
            </div>
          </div>

          <div ref="logContainer" class="ui-subtle-panel max-h-[50vh] min-h-0 flex-1 overflow-y-auto rounded-lg p-4 text-sm leading-relaxed font-mono" @scroll="onLogScroll">
            <div v-if="!allLogs.length" class="py-8 text-center text-gray-400">
              <div class="i-carbon-document-blank mx-auto mb-3 text-3xl text-gray-300" />
              <div class="text-sm text-gray-500 dark:text-gray-400">
                暂无日志
              </div>
              <div class="mt-1 text-xs text-gray-400">
                运行账号后，这里会持续追加巡查、种植、任务和出售记录。
              </div>
            </div>
            <div v-for="log in allLogs" :key="log.ts + log.msg" class="mb-1 break-all" :class="log.recovered ? 'opacity-45' : ''">
              <span class="mr-2 select-none text-gray-400">[{{ formatLogTime(log.time) }}]</span>
              <span class="mr-2 rounded px-1.5 py-0.5 text-xs font-bold" :class="getLogTagClass(log.tag)">{{ log.tag }}</span>
              <span v-if="log.meta?.event" class="mr-2 rounded bg-blue-50 px-1.5 py-0.5 text-xs text-blue-500 dark:bg-blue-900/20 dark:text-blue-400">{{ getEventLabel(log.meta.event) }}</span>
              <span :class="[getLogMsgClass(log.tag), log.recovered ? 'line-through decoration-gray-400' : '']">{{ log.msg }}<span v-if="log.recovered" class="ml-1 text-xs text-green-500">（已恢复）</span></span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 农场（复用 FarmPanel） -->
    <div v-show="activeTab === 'farm'" class="h-full">
      <FarmPanel />
    </div>

    <!-- 背包（复用 BagPanel） -->
    <div v-show="activeTab === 'bag'" class="h-full">
      <BagPanel />
    </div>

    <!-- 好友（复用 FriendsFriendList） -->
    <div v-show="activeTab === 'friends'" class="h-full">
      <FriendsTabContent />
    </div>

    <!-- 任务（复用 TaskPanel） -->
    <div v-show="activeTab === 'tasks'" class="h-full">
      <TaskPanel />
    </div>

    <!-- 宠物（护主犬同气礼包） -->
    <div v-show="activeTab === 'pet'" class="h-full">
      <DogGiftsPanel
        :account-id="currentAccountId"
        :account-running="allAccountsRunning"
      />
    </div>

    <!-- 自动控制（完整设置） -->
    <div v-show="activeTab === 'automation'" class="h-full">
      <AutomationSettingsTab
        v-model:settings="localAutomationSettings"
        :current-account-name="currentAccount?.nick || currentAccount?.name || ''"
        :current-account-id="currentAccountId"
        :loading="settingsLoading"
        :saving="automationSaving"
        :fertilizer-land-type-options="fertilizerLandTypeOptions"
        :fertilizer-options="fertilizerOptions"
        @save="saveAutomationSettings"
      />
    </div>

    <!-- 策略设置（完整设置） -->
    <div v-show="activeTab === 'strategy'" class="h-full">
      <StrategySettingsTab
        v-model:settings="localStrategySettings"
        :current-account-name="currentAccount?.nick || currentAccount?.name || ''"
        :current-account-id="currentAccountId"
        :loading="settingsLoading"
        :saving="strategySaving"
        :planting-strategy-options="plantingStrategyOptions"
        :preferred-seed-options="preferredSeedOptions"
        :bag-fallback-strategy-options="bagFallbackStrategyOptions"
        :strategy-preview-label="strategyPreviewLabel"
        :bag-seeds="bagSeeds"
        :sorted-bag-seeds="sortedBagSeeds"
        :bag-seeds-loading="bagSeedsLoading"
        :bag-seeds-error="bagSeedsError"
        @reset-bag-seed-priority="resetBagSeedPriority"
        @move-bag-seed="moveBagSeed"
        @remove-bag-seed="removeBagSeedPriority"
        @start-bag-seed-drag="startBagSeedDrag"
        @drag-over-bag-seed="dragOverBagSeed"
        @drop-bag-seed="dropBagSeed"
        @save="saveStrategySettings"
      />
    </div>

    <!-- 图鉴 -->
    <div v-show="activeTab === 'illustrated'" class="illustrated-container h-full">
      <Illustrated />
    </div>

    <!-- 分析 -->
    <div v-show="activeTab === 'analytics'" class="analytics-container h-full">
      <Analytics />
    </div>
  </div>

  <Teleport to="body">
    <AccountModal
      :show="showAccountModal"
      :edit-data="accountToEdit"
      @close="showAccountModal = false; accountToEdit = null"
      @saved="handleAccountSaved"
    />
    <CareerModal :show="showCareerModal" @close="showCareerModal = false" />
  </Teleport>

  <!-- 一键启动结果弹窗 -->
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="showStartAllModal" class="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" @click.self="showStartAllModal = false">
        <div class="w-full max-w-sm rounded-2xl glass-card p-5">
          <h3 class="mb-4 text-center text-base font-bold">🚀 一键启动结果</h3>
          <div class="flex flex-col gap-2">
            <div
              v-for="(r, i) in startAllResults"
              :key="i"
              class="flex items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-sm"
              :class="r.ok ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-300' : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300'"
            >
              <div class="flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold text-white" :class="r.ok ? 'bg-green-500' : 'bg-red-500'">
                {{ r.ok ? '✓' : '✕' }}
              </div>
              <span class="font-medium">{{ r.name }}</span>
              <span class="ml-auto text-xs opacity-75">{{ r.msg }}</span>
            </div>
          </div>
          <button class="mt-4 w-full rounded-xl bg-blue-500 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-600" @click="showStartAllModal = false">
            确定
          </button>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.overview-panel {
  --ov-glow: rgba(108, 92, 231, 0.06);
}

.overview-card {
  border-radius: 16px;
  overflow: visible;
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  background: var(--theme-glass);
  border: 1px solid var(--theme-border);
  box-shadow: 0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.02);
  transition: box-shadow 0.2s;
}

.overview-card :deep(.ui-subtle-panel) {
  background: var(--theme-glass) !important;
  border: 1px solid var(--theme-border) !important;
  backdrop-filter: blur(12px) !important;
  -webkit-backdrop-filter: blur(12px) !important;
}

.overview-panel .ui-card {
  border-radius: 16px;
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  background: var(--theme-glass);
  border: 1px solid var(--theme-border);
}

.overview-panel .ui-card-elevated {
  border-radius: 16px;
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  background: var(--theme-glass);
  border: 1px solid var(--theme-border);
}

.overview-panel .ui-subtle-panel {
  background: color-mix(in srgb, var(--theme-bg) 40%, transparent) !important;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border: 1px solid var(--theme-border);
}

/* 嵌入式组件玻璃覆盖 - 图鉴 / 分析 / 背包 / 好友 / 设置 */
:deep(.illustrated-container),
:deep(.analytics-container),
.illustrated-container :deep(.rounded-lg),
.analytics-container :deep(.rounded-lg) {
  background: var(--theme-glass) !important;
  border: 1px solid var(--theme-border) !important;
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
}

.illustrated-container :deep(.bg-white),
.analytics-container :deep(.bg-white),
.illustrated-container :deep(.bg-gray-50),
.analytics-container :deep(.bg-gray-50),
.illustrated-container :deep(.dark\\:bg-gray-800),
.analytics-container :deep(.dark\\:bg-gray-800),
.illustrated-container :deep(.dark\\:bg-gray-900),
.analytics-container :deep(.dark\\:bg-gray-900) {
  background: var(--theme-glass) !important;
}

.illustrated-container :deep(.shadow-sm),
.analytics-container :deep(.shadow-sm),
.illustrated-container :deep(.shadow),
.analytics-container :deep(.shadow) {
  box-shadow: none !important;
}

.illustrated-container :deep(.border-gray-200),
.analytics-container :deep(.border-gray-200),
.illustrated-container :deep(.dark\\:border-gray-700),
.analytics-container :deep(.dark\\:border-gray-700) {
  border-color: var(--theme-border) !important;
}


/* 切 tab 淡入 */
.tab-fade { animation: tabFadeIn 0.2s ease; }
@keyframes tabFadeIn {
  from { opacity: 0.35; }
  to { opacity: 1; }
}
</style>