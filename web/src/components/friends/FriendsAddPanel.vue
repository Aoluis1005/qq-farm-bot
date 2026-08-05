<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useFriendStore } from '@/stores/friend'
import { useToastStore } from '@/stores/toast'

const props = defineProps<{
  accountId: string
  accountRunning: boolean
}>()

const friendStore = useFriendStore()
const toast = useToastStore()

type RowStatus = 'pending' | 'sending' | 'success' | 'failed'

interface TargetRow {
  id: number
  gid: number
  key: string
  keyValid: boolean
  tokenKind?: 'invite' | 'sharekey'
  openid?: string
  selected: boolean
  status: RowStatus
  resultText: string
  resultKind: 'none' | 'ok' | 'warn' | 'error'
}

let rowSeq = 0
const rawInput = ref('')
const rows = ref<TargetRow[]>([])
const sending = ref(false)
const cancelRequested = ref(false)
const sendIntervalMs = ref(800)

// 手动单个添加
const manualGid = ref('')
const manualKey = ref('')

// ------------ 解析逻辑 ------------
const HEX32_RE = /(?<![0-9a-f])[0-9a-f]{32}(?![0-9a-f])/i
const INVITE_RE = /[A-Za-z0-9+/=]{40,}/

interface TokenInfo { token: string; kind: 'invite' | 'sharekey' | 'none' }

function extractGid(line: string): number {
  // 优先 uid= / gid= 参数
  const m = line.match(/(?:uid|gid)=(\d{5,})/i)
  if (m)
    return Number(m[1] ?? '')
  // 退化：取第一段 6 位以上数字（避免匹配到 hex 里的数字，故要求前后非 hex 字符）
  const m2 = line.match(/(?<![0-9a-f])(\d{6,})(?![0-9a-f])/i)
  return m2 ? Number(m2[1] ?? '') : 0
}

// 抽取加好友凭证：邀请 token（base64 >=40 位）优先；否则 32 位 hex 分享凭证（分享卡路径，需搭配 openid）
function extractToken(line: string): TokenInfo {
  const mi = line.match(INVITE_RE)
  if (mi && (mi[0] ?? '').length >= 40)
    return { token: mi[0] ?? '', kind: 'invite' }
  const m = line.match(/share_key=([0-9a-f]+)/i)
  if (m) {
    const v = (m[1] ?? '').toLowerCase()
    return { token: v.length >= 32 ? v.slice(0, 32) : v, kind: v.length >= 32 ? 'sharekey' : 'none' }
  }
  const m2 = line.match(HEX32_RE)
  if (m2)
    return { token: (m2[0] ?? '').toLowerCase(), kind: 'sharekey' }
  return { token: '', kind: 'none' }
}

// 抽取卡主 openid（分享卡路径 ReportArkClick 必需）
function extractOpenId(line: string): string {
  const m = line.match(/openid=([A-Za-z0-9_\-]+)/i)
  return m ? (m[1] ?? '') : ''
}

function isTokenValid(info: TokenInfo): boolean {
  if (info.kind === 'invite')
    return info.token.length >= 40
  if (info.kind === 'sharekey')
    return /^[0-9a-f]{32}$/i.test(info.token)
  return false
}

function parseInput() {
  const text = String(rawInput.value || '').trim()
  if (!text) {
    toast.error('请先粘贴分享卡片数据')
    return
  }
  // 把单行拼接的多条数据拆开：在每个 uid=/gid=/invite= 前插入换行
  const normalized = text.replace(/(?=(?:uid|gid|invite)=)/gi, '\n')
  const lines = normalized.split(/[\r\n]+/).map(s => s.trim()).filter(Boolean)

  const seen = new Set<string>()
  const parsed: TargetRow[] = []
  for (const line of lines) {
    const gid = extractGid(line)
    const info = extractToken(line)
    if (!info.token)
      continue
    const openid = extractOpenId(line)
    const dedupeKey = `${gid}:${info.token}`
    if (seen.has(dedupeKey))
      continue
    seen.add(dedupeKey)
    parsed.push({
      id: ++rowSeq,
      gid,
      key: info.token,
      keyValid: isTokenValid(info),
      tokenKind: info.kind === 'none' ? undefined : info.kind,
      openid: openid || undefined,
      selected: isTokenValid(info),
      status: 'pending',
      resultText: '',
      resultKind: 'none',
    })
  }

  if (parsed.length === 0) {
    toast.error('未解析到有效的分享卡数据（uid + openid + share_key），请检查格式')
    return
  }

  // 合并进现有列表（按 gid+key 去重）
  const existing = new Set(rows.value.map(r => `${r.gid}:${r.key}`))
  const merged = [...rows.value]
  let added = 0
  for (const r of parsed) {
    const k = `${r.gid}:${r.key}`
    if (existing.has(k))
      continue
    existing.add(k)
    merged.push(r)
    added++
  }
  rows.value = merged
  toast.success(`解析成功，新增 ${added} 条${added !== parsed.length ? `（去重 ${parsed.length - added} 条）` : ''}`)
}

// ------------ 文件导入 ------------
const fileInput = ref<HTMLInputElement | null>(null)

function triggerImport() {
  fileInput.value?.click()
}

async function onImportFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file)
    return
  try {
    const content = await file.text()
    const trimmed = content.trim()
    let text = content
    // 支持 JSON 格式：[{gid, share_key}] 或 {"gid":..,"share_key":..}
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      const arr = trimmed.startsWith('[') ? JSON.parse(trimmed) : [JSON.parse(trimmed)]
      const lines = (arr as any[])
        .filter(o => o && o.gid && o.share_key)
        .map(o => `uid=${o.gid}${o.openid ? `&openid=${o.openid}` : ''}&share_key=${o.share_key}`)
      if (lines.length === 0) {
        toast.error('JSON 中未找到 gid + share_key 字段')
        return
      }
      text = lines.join('\n')
    }
    rawInput.value = text
    parseInput()
  }
  catch (err: any) {
    toast.error('文件读取或解析失败：' + (err?.message || err))
  }
  finally {
    input.value = '' // 允许重复选择同一文件
  }
}

function addManual() {
  const gid = Number(String(manualGid.value).trim())
  const raw = String(manualKey.value).trim()
  const info = extractToken(raw)
  if (!info.token) {
    toast.error('请输入有效的分享卡数据（含 share_key）')
    return
  }
  const gidOk = gid && Number.isFinite(gid)
  const dedupeKey = `${gidOk ? gid : 0}:${info.token}`
  if (rows.value.some(r => `${r.gid}:${r.key}` === dedupeKey)) {
    toast.info('该目标已在列表中')
    return
  }
  rows.value.push({
    id: ++rowSeq,
    gid: gidOk ? gid : 0,
    key: info.token,
    keyValid: isTokenValid(info),
    tokenKind: info.kind === 'none' ? undefined : info.kind,
    openid: extractOpenId(raw) || undefined,
    selected: true,
    status: 'pending',
    resultText: '',
    resultKind: 'none',
  })
  manualGid.value = ''
  manualKey.value = ''
  toast.success('已添加到列表')
}

function removeRow(id: number) {
  rows.value = rows.value.filter(r => r.id !== id)
}

function clearAll() {
  rows.value = []
  try {
    localStorage.removeItem(storageKey())
  }
  catch {
    // ignore
  }
}

// ------------ 持久化（localStorage）------------
// 导入/手动添加的目标长期保留，切换账号或刷新页面不丢失，仅用户手动删除才移除。
const STORAGE_PREFIX = 'qqfarm:addfriends:'

function storageKey() {
  return `${STORAGE_PREFIX}${props.accountId || 'default'}`
}

interface PersistTarget {
  gid: number
  key: string
  tokenKind?: 'invite' | 'sharekey'
  openid?: string
  selected: boolean
}

function loadRows(): TargetRow[] {
  try {
    const raw = localStorage.getItem(storageKey())
    if (!raw)
      return []
    const arr = JSON.parse(raw) as PersistTarget[]
    if (!Array.isArray(arr))
      return []
    const loaded: TargetRow[] = []
    const seen = new Set<string>()
    for (const item of arr) {
      if (!item || typeof item.gid !== 'number')
        continue
      const gid = item.gid
      const key = typeof item.key === 'string' ? item.key.toLowerCase() : ''
      const dedupe = `${gid}:${key}`
      if (seen.has(dedupe))
        continue
      seen.add(dedupe)
      loaded.push({
        id: ++rowSeq,
        gid,
        key,
        keyValid: item.tokenKind === 'invite' ? key.length >= 40 : /^[0-9a-f]{32}$/i.test(key),
        tokenKind: item.tokenKind === 'invite' || item.tokenKind === 'sharekey' ? item.tokenKind : undefined,
        openid: typeof item.openid === 'string' && item.openid ? item.openid : undefined,
        selected: item.selected !== false,
        status: 'pending',
        resultText: '',
        resultKind: 'none',
      })
    }
    return loaded
  }
  catch {
    return []
  }
}

function saveRows() {
  try {
    const data: PersistTarget[] = rows.value.map(r => ({
      gid: r.gid,
      key: r.key,
      tokenKind: r.tokenKind,
      openid: r.openid,
      selected: r.selected,
    }))
    localStorage.setItem(storageKey(), JSON.stringify(data))
  }
  catch {
    // 忽略序列化 / 配额错误
  }
}

onMounted(() => {
  rows.value = loadRows()
})

// 列表任何变更（解析 / 手动添加 / 删除 / 勾选）都即时落盘
watch(rows, saveRows, { deep: true })

// 切换账号时载入对应账号保存的目标库
watch(() => props.accountId, () => {
  rows.value = loadRows()
})

const selectedCount = computed(() => rows.value.filter(r => r.selected).length)
const validCount = computed(() => rows.value.filter(r => r.keyValid).length)
const allSelected = computed({
  get: () => rows.value.length > 0 && rows.value.every(r => r.selected),
  set: (val: boolean) => rows.value.forEach((r) => { r.selected = val }),
})

const successCount = computed(() => rows.value.filter(r => r.status === 'success').length)
const failedCount = computed(() => rows.value.filter(r => r.status === 'failed').length)

// ------------ 错误码友好文案 ------------
function describeResult(ok: boolean, code: number, error: string): { text: string, kind: TargetRow['resultKind'] } {
  if (ok)
    return { text: '✅ 申请已发送', kind: 'ok' }
  switch (code) {
    case 1005024:
      return { text: '凭证已过期（请用新鲜卡片）', kind: 'warn' }
    case 1005004:
      return { text: '对方好友列表已满', kind: 'warn' }
    case 1005014:
      return { text: '协议结构错误', kind: 'error' }
    default:
      return { text: error || (code ? `失败 code=${code}` : '发送失败'), kind: 'error' }
  }
}

function maskKey(key: string) {
  if (!key)
    return '(无凭证)'
  if (key.length <= 12)
    return key
  return `${key.slice(0, 8)}…${key.slice(-4)}`
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function sendRow(row: TargetRow) {
  row.status = 'sending'
  row.resultText = '发送中…'
  row.resultKind = 'none'
  // 唯一路径（2026-08-05 已验证）：gid + openid + share_key → ReportArkClick，无需 Enter、绕过 1002007
  const isCard = !!row.openid && !!row.gid && /^[0-9a-f]{32}$/i.test(row.key)
  if (!isCard) {
    row.status = 'failed'
    row.resultText = '缺少 openid，请粘贴完整分享卡数据 (uid&openid&share_key)'
    row.resultKind = 'error'
    return
  }
  const res = await friendStore.applyFriend(props.accountId, {
    gid: row.gid,
    shareKey: row.key,
    openid: row.openid,
  })
  const desc = describeResult(res.ok, res.code, res.error)
  row.status = res.ok ? 'success' : 'failed'
  row.resultText = desc.text
  row.resultKind = desc.kind
}

async function sendSelected() {
  if (!props.accountId) {
    toast.error('请先选择账号')
    return
  }
  if (!props.accountRunning) {
    toast.error('当前账号未在线，请先在账号列表启动该账号')
    return
  }
  const targets = rows.value.filter(r => r.selected)
  if (targets.length === 0) {
    toast.error('请先勾选要发送的目标')
    return
  }
  const interval = Math.max(0, Number(sendIntervalMs.value) || 0)
  sending.value = true
  cancelRequested.value = false
  let sent = 0
  let skipped = 0
  try {
    for (let i = 0; i < targets.length; i++) {
      if (cancelRequested.value) {
        skipped = targets.length - i
        break
      }
      const row = targets[i]
      if (!row)
        continue
      await sendRow(row)
      sent++
      if (cancelRequested.value) {
        skipped = targets.length - i - 1
        break
      }
      if (i < targets.length - 1 && interval > 0)
        await sleep(interval)
    }
    if (cancelRequested.value) {
      // 恢复仍在"发送中"的行（请求未返回的视为未发送）
      for (const r of rows.value) {
        if (r.status === 'sending') {
          r.status = 'pending'
          r.resultText = ''
          r.resultKind = 'none'
        }
      }
      toast.info(`已取消发送：已发送 ${sent} 条${skipped > 0 ? `，跳过 ${skipped} 条` : ''}`)
    }
    else {
      toast.success(`发送完成：成功 ${successCount.value}，失败 ${failedCount.value}`)
    }
  }
  finally {
    sending.value = false
    cancelRequested.value = false
  }
}

function cancelSending() {
  cancelRequested.value = true
}

async function retryFailed() {
  const targets = rows.value.filter(r => r.status === 'failed')
  targets.forEach((r) => { r.selected = true })
  await sendSelected()
}

function statusBadgeClass(row: TargetRow) {
  if (row.resultKind === 'ok')
    return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
  if (row.resultKind === 'warn')
    return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
  if (row.resultKind === 'error')
    return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
  if (row.status === 'sending')
    return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
  return 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-300'
}
</script>

<template>
  <div class="space-y-4">
    <!-- 说明 -->
    <div class="rounded-lg bg-blue-50 p-3 text-sm text-blue-800 dark:bg-blue-900/20 dark:text-blue-200 sm:p-4">
      <div class="mb-1 flex items-center gap-2 font-medium">
        <div class="i-carbon-information" />
        主动加好友说明
      </div>
      <ul class="list-disc pl-5 space-y-1 text-blue-700/90 dark:text-blue-200/80">
        <li>粘贴<b>分享卡片数据</b>（<code>uid=...&openid=...&share_key=...</code>）——走 <b>ReportArkClick</b> 直接发申请，<b>无需进农场、天然绕过拜访开关 1002007</b>（已验证）。</li>
        <li>每条必须含 <code>gid(uid)</code> + <code>openid</code> + <code>share_key</code>(32位hex) 三者，缺一不可；支持一行一条或整段粘贴，或「导入文件」选 <code>share_cards.txt/.json</code>。</li>
        <li>凭证有<b>时效</b>，请使用<b>新鲜</b>卡片；过期会返回「凭证已过期」。</li>
      </ul>
    </div>

    <!-- 账号在线提示 -->
    <div
      v-if="!accountRunning"
      class="flex items-center gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-700 dark:bg-amber-900/20 dark:text-amber-300 sm:p-4"
    >
      <div class="i-carbon-warning-alt" />
      当前账号未在线，发送前请先到「账号」页启动该账号。
    </div>

    <!-- 粘贴解析区 -->
    <div class="rounded-lg bg-white p-4 shadow dark:bg-gray-800">
      <label class="mb-2 block text-sm text-gray-700 font-medium dark:text-gray-200">
        粘贴分享卡片数据
      </label>
      <textarea
        v-model="rawInput"
        rows="6"
        placeholder="支持多种格式，一行一条或整段粘贴，例如：&#10;uid=1218494342&openid=xxx&share_key=44a3a23322ea4fc5be44701da99ecebc&share_source=1&#10;或&#10;1218494342 44a3a23322ea4fc5be44701da99ecebc&#10;或 pages/index.html?gid=...&openid=...&share_key=..."
        class="w-full border border-gray-300 rounded-lg bg-white p-3 text-sm font-mono dark:border-gray-600 focus:border-blue-500 dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
      />
      <div class="mt-3 flex flex-wrap items-center gap-2">
        <button
          class="w-full rounded-lg px-4 py-2 text-sm text-white transition disabled:opacity-50 sm:w-auto"
          :style="{ backgroundColor: 'var(--theme-primary)' }"
          :disabled="!rawInput.trim()"
          @click="parseInput"
        >
          <div class="i-carbon-parse mr-1 inline-block align-text-bottom" />
          解析
        </button>
        <button
          class="w-full rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-600 transition dark:border-gray-600 dark:bg-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-600 sm:w-auto"
          @click="triggerImport"
        >
          <div class="i-carbon-document-import mr-1 inline-block align-text-bottom" />
          导入文件
        </button>
        <input
          ref="fileInput"
          type="file"
          accept=".txt,.json"
          class="hidden"
          @change="onImportFile"
        >
        <button
          class="w-full rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-600 transition dark:border-gray-600 dark:bg-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-600 sm:w-auto"
          @click="rawInput = ''"
        >
          清空输入框
        </button>
      </div>
    </div>

    <!-- 手动单个添加 -->
    <div class="rounded-lg bg-white p-3 shadow dark:bg-gray-800 sm:p-4">
      <label class="mb-2 block text-sm text-gray-700 font-medium dark:text-gray-200">
        手动添加单个目标
      </label>
      <div class="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-2">
        <input
          v-model="manualGid"
          type="text"
          inputmode="numeric"
          placeholder="目标 gid"
          class="w-full border border-gray-300 rounded-lg bg-white px-3 py-2 text-sm dark:border-gray-600 focus:border-blue-500 dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500 sm:w-40"
        >
        <input
          v-model="manualKey"
          type="text"
          placeholder="分享卡数据 uid&openid&share_key（可整段粘贴）"
          class="w-full min-w-0 flex-1 border border-gray-300 rounded-lg bg-white px-3 py-2 text-sm font-mono dark:border-gray-600 focus:border-blue-500 dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500 sm:min-w-64"
        >
        <button
          class="w-full rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700 transition dark:border-gray-600 dark:bg-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-600 sm:w-auto"
          @click="addManual"
        >
          添加到列表
        </button>
      </div>
    </div>

    <!-- 目标列表 -->
    <div class="rounded-lg bg-white shadow dark:bg-gray-800">
      <div class="flex flex-col gap-3 border-b border-gray-200 p-3 dark:border-gray-700 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3 sm:p-4">
        <label class="flex cursor-pointer items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
          <input v-model="allSelected" type="checkbox" class="h-4 w-4 rounded border-gray-300">
          全选
        </label>
        <div class="text-sm text-gray-500 dark:text-gray-400">
          共 <b>{{ rows.length }}</b> 条 · 有效凭证 <b class="text-green-600 dark:text-green-400">{{ validCount }}</b> · 已选 <b>{{ selectedCount }}</b>
          <span v-if="successCount || failedCount">
            · 成功 <b class="text-green-600 dark:text-green-400">{{ successCount }}</b> · 失败 <b class="text-red-600 dark:text-red-400">{{ failedCount }}</b>
          </span>
        </div>
        <div class="flex-1" />
        <div class="flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400">
          间隔
          <input
            v-model.number="sendIntervalMs"
            type="number"
            min="0"
            step="100"
            class="w-20 border border-gray-300 rounded bg-white px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
          >
          ms
        </div>
        <button
          v-if="failedCount > 0 && !sending"
          class="w-full rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-700 transition dark:bg-amber-900/30 hover:bg-amber-200 dark:text-amber-300 sm:w-auto"
          @click="retryFailed"
        >
          重试失败 ({{ failedCount }})
        </button>
        <button
          class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-600 transition dark:border-gray-600 dark:bg-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-600 disabled:opacity-50 sm:w-auto"
          :disabled="rows.length === 0 || sending"
          @click="clearAll"
        >
          清空列表
        </button>
        <button
          v-if="!sending"
          class="w-full rounded-lg px-4 py-2 text-sm text-white transition disabled:opacity-50 sm:w-auto"
          :style="{ backgroundColor: 'var(--theme-primary)' }"
          :disabled="selectedCount === 0 || sending || !accountRunning"
          @click="sendSelected"
        >
          <div class="i-carbon-send mr-1 inline-block align-text-bottom" />
          发送选中 ({{ selectedCount }})
        </button>
        <button
          v-else
          class="w-full rounded-lg bg-red-600 px-4 py-2 text-sm text-white transition hover:bg-red-500 sm:w-auto"
          @click="cancelSending"
        >
          <div class="i-carbon-close mr-1 inline-block align-text-bottom" />
          取消发送
        </button>
      </div>

      <div v-if="rows.length === 0" class="p-6 text-center text-gray-400 sm:p-10">
        <div class="i-carbon-user-follow mx-auto mb-3 text-4xl text-gray-300" />
        <div class="text-sm">
          暂无目标，先在上方粘贴数据并解析，或手动添加。
        </div>
      </div>

      <div v-else class="divide-y divide-gray-100 dark:divide-gray-700">
        <div
          v-for="row in rows"
          :key="row.id"
          class="flex items-start gap-2 px-3 py-2.5 sm:items-center sm:gap-3 sm:px-4 sm:py-3"
        >
          <input
            v-model="row.selected"
            type="checkbox"
            class="mt-1 h-4 w-4 shrink-0 rounded border-gray-300 sm:mt-0"
            :disabled="sending"
          >
          <div class="min-w-0 flex-1">
            <div class="flex items-baseline gap-2">
              <span class="text-sm font-mono font-medium text-gray-800 dark:text-gray-100">
                {{ row.gid || '—' }}
              </span>
              <span class="text-xs text-gray-400">GID</span>
            </div>
            <div class="truncate text-sm font-mono text-gray-600 dark:text-gray-300">
              {{ maskKey(row.key) }}
            </div>
            <div v-if="row.openid" class="truncate text-xs font-mono text-gray-400">
              openid={{ row.openid }}
            </div>
            <div class="mt-0.5 flex items-center gap-1 text-xs">
              <span
                v-if="row.keyValid && row.tokenKind === 'invite'"
                class="rounded bg-green-100 px-1.5 py-0.5 text-green-700 dark:bg-green-900/30 dark:text-green-300"
              >邀请 token</span>
              <span
                v-else-if="row.keyValid && row.tokenKind === 'sharekey' && row.openid"
                class="rounded bg-green-100 px-1.5 py-0.5 text-green-700 dark:bg-green-900/30 dark:text-green-300"
              >分享卡 · 直发</span>
              <span
                v-else-if="row.keyValid"
                class="rounded bg-amber-100 px-1.5 py-0.5 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
              >仅兜底(缺 openid)</span>
              <span
                v-else
                class="rounded bg-red-100 px-1.5 py-0.5 text-red-700 dark:bg-red-900/30 dark:text-red-300"
              >无有效凭证</span>
            </div>
            <!-- 移动端：状态显示在内容下方 -->
            <div class="mt-1 sm:hidden">
              <span
                v-if="row.status !== 'pending' || row.resultText"
                class="inline-block rounded-full px-2 py-1 text-xs font-medium"
                :class="statusBadgeClass(row)"
              >
                {{ row.resultText || '待发送' }}
              </span>
              <span v-else class="text-xs text-gray-400">待发送</span>
            </div>
          </div>
          <!-- 桌面端：状态靠右 -->
          <div class="hidden w-44 shrink-0 text-right sm:block">
            <span
              v-if="row.status !== 'pending' || row.resultText"
              class="inline-block rounded-full px-2 py-1 text-xs font-medium"
              :class="statusBadgeClass(row)"
            >
              {{ row.resultText || '待发送' }}
            </span>
            <span v-else class="text-xs text-gray-400">待发送</span>
          </div>
          <button
            class="shrink-0 rounded p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-red-500 dark:hover:bg-gray-700 disabled:opacity-40"
            :disabled="sending"
            @click="removeRow(row.id)"
          >
            <div class="i-carbon-trash-can text-sm" />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
