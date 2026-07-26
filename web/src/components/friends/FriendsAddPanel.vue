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
  selected: boolean
  status: RowStatus
  resultText: string
  resultKind: 'none' | 'ok' | 'warn' | 'error'
}

let rowSeq = 0
const rawInput = ref('')
const rows = ref<TargetRow[]>([])
const sending = ref(false)
const sendIntervalMs = ref(800)

// 手动单个添加
const manualGid = ref('')
const manualKey = ref('')

// ------------ 解析逻辑 ------------
const HEX32_RE = /(?<![0-9a-f])[0-9a-f]{32}(?![0-9a-f])/i

function extractGid(line: string): number {
  // 优先 uid= / gid= 参数
  const m = line.match(/(?:uid|gid)=(\d{5,})/i)
  if (m)
    return Number(m[1] ?? '')
  // 退化：取第一段 6 位以上数字（避免匹配到 hex 里的数字，故要求前后非 hex 字符）
  const m2 = line.match(/(?<![0-9a-f])(\d{6,})(?![0-9a-f])/i)
  return m2 ? Number(m2[1] ?? '') : 0
}

function extractKey(line: string): string {
  // 优先 share_key= 参数
  const m = line.match(/share_key=([0-9a-f]+)/i)
  if (m) {
    // 参数值可能带噪声，截取前 32 位 hex
    const v = (m[1] ?? '').toLowerCase()
    if (v.length >= 32)
      return v.slice(0, 32)
    return v
  }
  // 退化：任意独立的 32 位 hex
  const m2 = line.match(HEX32_RE)
  return m2 ? (m2[0] ?? '').toLowerCase() : ''
}

function parseInput() {
  const text = String(rawInput.value || '').trim()
  if (!text) {
    toast.error('请先粘贴分享卡片数据')
    return
  }
  // 把单行拼接的多条数据拆开：在每个 uid=/gid= 前插入换行
  const normalized = text.replace(/(?=(?:uid|gid)=)/gi, '\n')
  const lines = normalized.split(/[\r\n]+/).map(s => s.trim()).filter(Boolean)

  const seen = new Set<string>()
  const parsed: TargetRow[] = []
  for (const line of lines) {
    const gid = extractGid(line)
    if (!gid)
      continue
    const key = extractKey(line)
    const dedupeKey = `${gid}:${key}`
    if (seen.has(dedupeKey))
      continue
    seen.add(dedupeKey)
    parsed.push({
      id: ++rowSeq,
      gid,
      key,
      keyValid: /^[0-9a-f]{32}$/i.test(key),
      selected: /^[0-9a-f]{32}$/i.test(key),
      status: 'pending',
      resultText: '',
      resultKind: 'none',
    })
  }

  if (parsed.length === 0) {
    toast.error('未解析到有效的 gid，请检查数据格式')
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
        .map(o => `uid=${o.gid}&share_key=${o.share_key}`)
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
  const key = String(manualKey.value).trim().toLowerCase()
  if (!gid || !Number.isFinite(gid)) {
    toast.error('请输入有效的 gid')
    return
  }
  const dedupeKey = `${gid}:${key}`
  if (rows.value.some(r => `${r.gid}:${r.key}` === dedupeKey)) {
    toast.info('该 gid + 凭证已在列表中')
    return
  }
  rows.value.push({
    id: ++rowSeq,
    gid,
    key,
    keyValid: /^[0-9a-f]{32}$/i.test(key),
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
        keyValid: /^[0-9a-f]{32}$/i.test(key),
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
    case 1002007:
      return { text: '目标未开启拜访开关', kind: 'warn' }
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
  const res = await friendStore.applyFriend(
    props.accountId,
    row.gid,
    row.keyValid ? row.key : undefined,
  )
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
  try {
    for (let i = 0; i < targets.length; i++) {
      const row = targets[i]
      if (!row)
        continue
      await sendRow(row)
      if (i < targets.length - 1 && interval > 0)
        await sleep(interval)
    }
    toast.success(`发送完成：成功 ${successCount.value}，失败 ${failedCount.value}`)
  }
  finally {
    sending.value = false
  }
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
    <div class="rounded-lg bg-blue-50 p-4 text-sm text-blue-800 dark:bg-blue-900/20 dark:text-blue-200">
      <div class="mb-1 flex items-center gap-2 font-medium">
        <div class="i-carbon-information" />
        主动加好友说明
      </div>
      <ul class="list-disc pl-5 space-y-1 text-blue-700/90 dark:text-blue-200/80">
        <li>加好友需要目标的<b>分享凭证</b>（share_key，32 位十六进制），来自对方分享的农场卡片。</li>
        <li>凭证有<b>时效</b>，请使用<b>新鲜</b>卡片；过期会返回「凭证已过期」。</li>
        <li>粘贴数据支持：<code>share.txt</code> 行、卡片 pagepath/链接、或 <code>gid 凭证</code> 每行一条；也可点「导入文件」直接选抓包导出的 <code>share_cards.txt/.json</code>。</li>
        <li>默认走「跳过进农场」的直接申请流程，可绕过对方拜访开关限制。</li>
      </ul>
    </div>

    <!-- 账号在线提示 -->
    <div
      v-if="!accountRunning"
      class="flex items-center gap-2 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:bg-amber-900/20 dark:text-amber-300"
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
        placeholder="支持多种格式，一行一条或整段粘贴，例如：&#10;uid=1218494342&openid=xxx&share_source=1&doc_id=123&share_key=44a3a23322ea4fc5be44701da99ecebc&#10;或&#10;1218494342 44a3a23322ea4fc5be44701da99ecebc&#10;或 pages/index.html?gid=...&share_key=..."
        class="w-full border border-gray-300 rounded-lg bg-white p-3 text-sm font-mono dark:border-gray-600 focus:border-blue-500 dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
      />
      <div class="mt-3 flex flex-wrap items-center gap-2">
        <button
          class="rounded-lg px-4 py-2 text-sm text-white transition disabled:opacity-50"
          :style="{ backgroundColor: 'var(--theme-primary)' }"
          :disabled="!rawInput.trim()"
          @click="parseInput"
        >
          <div class="i-carbon-parse mr-1 inline-block align-text-bottom" />
          解析
        </button>
        <button
          class="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-600 transition dark:border-gray-600 dark:bg-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-600"
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
          class="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-600 transition dark:border-gray-600 dark:bg-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-600"
          @click="rawInput = ''"
        >
          清空输入框
        </button>
      </div>
    </div>

    <!-- 手动单个添加 -->
    <div class="rounded-lg bg-white p-4 shadow dark:bg-gray-800">
      <label class="mb-2 block text-sm text-gray-700 font-medium dark:text-gray-200">
        手动添加单个目标
      </label>
      <div class="flex flex-wrap items-center gap-2">
        <input
          v-model="manualGid"
          type="text"
          inputmode="numeric"
          placeholder="目标 gid"
          class="w-40 border border-gray-300 rounded-lg bg-white px-3 py-2 text-sm dark:border-gray-600 focus:border-blue-500 dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
        <input
          v-model="manualKey"
          type="text"
          placeholder="share_key（32 位十六进制）"
          class="min-w-64 flex-1 border border-gray-300 rounded-lg bg-white px-3 py-2 text-sm font-mono dark:border-gray-600 focus:border-blue-500 dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
        <button
          class="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700 transition dark:border-gray-600 dark:bg-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-600"
          @click="addManual"
        >
          添加到列表
        </button>
      </div>
    </div>

    <!-- 目标列表 -->
    <div class="rounded-lg bg-white shadow dark:bg-gray-800">
      <div class="flex flex-wrap items-center gap-3 border-b border-gray-200 p-4 dark:border-gray-700">
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
          class="rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-700 transition dark:bg-amber-900/30 hover:bg-amber-200 dark:text-amber-300"
          @click="retryFailed"
        >
          重试失败 ({{ failedCount }})
        </button>
        <button
          class="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-600 transition dark:border-gray-600 dark:bg-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-600 disabled:opacity-50"
          :disabled="rows.length === 0 || sending"
          @click="clearAll"
        >
          清空列表
        </button>
        <button
          class="rounded-lg px-4 py-2 text-sm text-white transition disabled:opacity-50"
          :style="{ backgroundColor: 'var(--theme-primary)' }"
          :disabled="selectedCount === 0 || sending || !accountRunning"
          @click="sendSelected"
        >
          <div v-if="sending" class="i-svg-spinners-90-ring-with-bg mr-1 inline-block align-text-bottom" />
          {{ sending ? '发送中…' : `发送选中 (${selectedCount})` }}
        </button>
      </div>

      <div v-if="rows.length === 0" class="p-10 text-center text-gray-400">
        <div class="i-carbon-user-follow mx-auto mb-3 text-4xl text-gray-300" />
        <div class="text-sm">
          暂无目标，先在上方粘贴数据并解析，或手动添加。
        </div>
      </div>

      <div v-else class="divide-y divide-gray-100 dark:divide-gray-700">
        <div
          v-for="row in rows"
          :key="row.id"
          class="flex items-center gap-3 px-4 py-3"
        >
          <input
            v-model="row.selected"
            type="checkbox"
            class="h-4 w-4 shrink-0 rounded border-gray-300"
            :disabled="sending"
          >
          <div class="w-32 shrink-0">
            <div class="text-sm text-gray-800 font-medium font-mono dark:text-gray-100">
              {{ row.gid }}
            </div>
            <div class="text-xs text-gray-400">
              GID
            </div>
          </div>
          <div class="min-w-0 flex-1">
            <div class="truncate text-sm text-gray-600 font-mono dark:text-gray-300">
              {{ maskKey(row.key) }}
            </div>
            <div class="mt-0.5 flex items-center gap-1 text-xs">
              <span
                v-if="row.keyValid"
                class="rounded bg-green-100 px-1.5 py-0.5 text-green-700 dark:bg-green-900/30 dark:text-green-300"
              >凭证有效</span>
              <span
                v-else
                class="rounded bg-red-100 px-1.5 py-0.5 text-red-700 dark:bg-red-900/30 dark:text-red-300"
              >无有效凭证</span>
            </div>
          </div>
          <div class="w-44 shrink-0 text-right">
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
