<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import { useAccountStore, getPlatformLabel, getPlatformClass } from '@/stores/account'
import { useUserStore } from '@/stores/user'
import AccountModal from './AccountModal.vue'
import RemarkModal from './RemarkModal.vue'

const route = useRoute()
const router = useRouter()
const accountStore = useAccountStore()
const userStore = useUserStore()
const { accounts, currentAccount } = storeToRefs(accountStore)

const showAccountPopup = ref(false)
const showAccountModal = ref(false)
const showRemarkModal = ref(false)
const accountToEdit = ref<any>(null)

// ---------- 滚动方向显隐导航栏（向下滑隐藏 / 向上滑显示） ----------
// 捕获阶段监听 document 上所有元素的 scroll 事件，不依赖特定选择器：
// 无论实际滚动发生在 window/body 还是页面内任意滚动容器，都能覆盖。
const dockHidden = ref(false)
let lastScrollTop = 0
let lastScrollTarget: EventTarget | null = null
const SCROLL_THRESHOLD = 5 // 滚动超过该像素才算"滑过"，防误触

function scrollTopOf(target: EventTarget | null): number {
  if (!target) return 0
  if (target === document || target === document.documentElement || target === document.body) {
    return window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0
  }
  const el = target as HTMLElement
  return typeof el.scrollTop === 'number' ? el.scrollTop : 0
}

function handleScroll(e: Event) {
  const target = e.target
  const st = scrollTopOf(target)
  // 滚动源切换（如从主容器切到子面板）：重置基准，不误判方向
  if (target !== lastScrollTarget) {
    lastScrollTarget = target
    lastScrollTop = st
    return
  }
  const delta = st - lastScrollTop
  if (Math.abs(delta) < SCROLL_THRESHOLD) {
    lastScrollTop = st
    return
  }
  dockHidden.value = delta > 0 // 向下滑隐藏，向上滑显示
  lastScrollTop = st
}

const navItems = [
  { key: 'dashboard', path: '/', label: '首页', icon: 'i-carbon-home' },
  { key: 'shop', path: '/shop', label: '商城', icon: 'i-carbon-shopping-cart' },
  { key: 'account', label: '账号', icon: 'i-carbon-user' },
  { key: 'activity', path: '/activity', label: '活动', icon: 'i-carbon-gift' },
  { key: 'settings', path: '/settings', label: '设置', icon: 'i-carbon-settings' },
]

function isActive(item: typeof navItems[number]): boolean {
  if (item.key === 'dashboard') return route.path === '/' || route.path === ''
  if (item.path) return route.path.startsWith(item.path)
  return false
}

function handleNavClick(item: typeof navItems[number]) {
  if (item.key === 'account') {
    showAccountPopup.value = !showAccountPopup.value
    return
  }
  showAccountPopup.value = false
  if (item.path) router.push(item.path)
}

// 账号弹窗
const avatarErrors = ref<Set<string>>(new Set())
function closePopup() { showAccountPopup.value = false }

function handleOutsideClick(e: MouseEvent) {
  const target = e.target as HTMLElement
  if (showAccountPopup.value && !target.closest('.account-popup') && !target.closest('.nav-item--account')) {
    closePopup()
  }
}

onMounted(() => {
  document.addEventListener('click', handleOutsideClick)
  // 捕获阶段监听：能收到文档内任意元素的 scroll（含 window/body 滚动）
  document.addEventListener('scroll', handleScroll, { capture: true, passive: true })
})
onBeforeUnmount(() => {
  document.removeEventListener('click', handleOutsideClick)
  document.removeEventListener('scroll', handleScroll, { capture: true } as EventListenerOptions)
})

// 切换页面时恢复导航栏显示，避免上一页隐藏的状态带到下一页
watch(() => route.fullPath, () => {
  dockHidden.value = false
  lastScrollTarget = null
  lastScrollTop = 0
})

function selectAccount(acc: any) {
  accountStore.setCurrentAccount(acc)
  closePopup()
}

function accountDisplayName(acc: any) {
  const nick = acc?.nick || ''
  const remark = acc?.name || ''
  if (nick && remark && nick !== remark) return `${nick} (${remark})`
  return nick || remark || acc?.uin || acc?.qq || acc?.id || '账号'
}

function accountSub(acc: any) {
  return acc?.uin || acc?.qq || ''
}

function avatarSrc(acc: any) {
  const qq = acc?.uin || acc?.qq
  if (qq && /^\d+$/.test(qq)) return `https://q1.qlogo.cn/g?b=qq&nk=${qq}&s=100`
  return acc?.avatar || ''
}

function hasAvatar(acc: any) {
  const key = String(acc?.id || acc?.uin || '')
  return !!avatarSrc(acc) && !avatarErrors.value.has(key)
}

function avatarInitial(acc: any) {
  return accountDisplayName(acc).replace(/[()（）\s]/g, '').slice(0, 1) || '账'
}

function markAvatarFailed(acc: any) {
  const key = String(acc?.id || acc?.uin || '')
  if (key) avatarErrors.value.add(key)
}

async function handleLogout() {
  closePopup()
  await userStore.logout()
}

function openAddAccount() {
  accountToEdit.value = null
  showAccountModal.value = true
  closePopup()
}

function openRemarkModal(acc: any) {
  accountToEdit.value = acc
  showRemarkModal.value = true
  closePopup()
}

async function handleAccountSaved() {
  await accountStore.fetchAccounts()
  showAccountModal.value = false
  showRemarkModal.value = false
  accountToEdit.value = null
}
</script>

<template>
  <div class="ambient-glow" :class="{ 'dock-hidden': dockHidden }" />
  <div class="floating-nav-wrapper" :class="{ 'dock-hidden': dockHidden }">
    <nav class="floating-nav" role="navigation" aria-label="主导航">
      <button
        v-for="item in navItems"
        :key="item.key"
        class="nav-item"
        :class="{
          'nav-item--active': isActive(item),
          'nav-item--account': item.key === 'account',
        }"
        @click="handleNavClick(item)"
      >
        <span class="nav-item-icon" :class="item.icon" />
        <span class="nav-item-label">{{ item.label }}</span>
      </button>
    </nav>

    <!-- 账号弹窗 -->
    <Teleport to="body">
      <Transition name="popup">
        <div v-if="showAccountPopup" class="account-popup-overlay" @click.self="closePopup">
          <div class="account-popup">
            <div class="popup-header">
              <span class="popup-title">切换账号</span>
              <button class="popup-close" @click="closePopup">✕</button>
            </div>

            <div class="popup-list">
              <div v-if="accounts.length === 0" class="popup-empty">暂无账号</div>
              <button
                v-for="acc in accounts"
                :key="acc.id || acc.uin"
                class="popup-item"
                :class="{ 'popup-item--active': currentAccount?.id === acc.id }"
                @click="selectAccount(acc)"
              >
                <div class="popup-avatar">
                  <img
                    v-if="hasAvatar(acc)"
                    :src="avatarSrc(acc)"
                    :alt="accountDisplayName(acc)"
                    class="popup-avatar-img"
                    @error="markAvatarFailed(acc)"
                  >
                  <span v-else class="popup-avatar-text">{{ avatarInitial(acc) }}</span>
                </div>
                <div class="popup-info">
                  <span class="popup-name">{{ accountDisplayName(acc) }}</span>
                  <span v-if="accountSub(acc)" class="popup-sub">{{ accountSub(acc) }}</span>
                </div>
                <span v-if="getPlatformLabel(acc.platform)" class="popup-platform" :class="getPlatformClass(acc.platform)">
                  {{ getPlatformLabel(acc.platform) }}
                </span>
                <span v-if="currentAccount?.id === acc.id" class="popup-check">✓</span>
                <button class="popup-remark-btn" @click.stop="openRemarkModal(acc)">✎</button>
              </button>
            </div>

            <div class="popup-footer">
              <button class="popup-action" :style="{ color: 'var(--theme-primary)' }" @click="openAddAccount">
                添加账号
              </button>
              <router-link class="popup-action" :style="{ color: 'var(--theme-primary)' }" to="/settings" @click="closePopup">
                管理账号
              </router-link>
              <button class="popup-action popup-action--danger" @click="handleLogout">
                退出登录
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <Teleport to="body">
      <AccountModal
        :show="showAccountModal"
        :edit-data="accountToEdit"
        @close="showAccountModal = false; accountToEdit = null"
        @saved="handleAccountSaved"
      />
      <RemarkModal
        :show="showRemarkModal"
        :account="accountToEdit"
        @close="showRemarkModal = false"
        @saved="handleAccountSaved"
      />
    </Teleport>
  </div>
</template>

<style scoped>
.floating-nav-wrapper {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 1000;
  display: flex;
  justify-content: center;
  padding-bottom: env(safe-area-inset-bottom, 0px);
  pointer-events: none;
  transition: transform 0.35s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.35s ease;
  will-change: transform;
}
.floating-nav-wrapper.dock-hidden {
  transform: translateY(calc(100% + 28px));
  opacity: 0;
  pointer-events: none;
}
.ambient-glow {
  position: fixed;
  bottom: -60px;
  left: 50%;
  transform: translateX(-50%);
  width: 360px;
  height: 140px;
  background: radial-gradient(ellipse, color-mix(in srgb, var(--theme-primary) 22%, transparent), transparent 70%);
  pointer-events: none;
  z-index: 999;
  filter: blur(36px);
  transition: transform 0.35s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.35s ease;
  will-change: transform;
}
.ambient-glow.dock-hidden {
  transform: translateX(-50%) translateY(calc(100% + 28px));
  opacity: 0;
}
.floating-nav {
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  margin-bottom: 20px;
  border-radius: 28px;
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  background: transparent;
  border: 1px solid rgba(15, 23, 42, 0.1);
  box-shadow: 0 8px 32px rgba(15, 23, 42, 0.16);
  animation: nav-slide-up 0.5s cubic-bezier(0.16, 1, 0.3, 1) both;
}
.floating-nav::-webkit-scrollbar { display: none; }
@keyframes nav-slide-up {
  from { opacity: 0; transform: translateY(20px) scale(0.95); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
.nav-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 64px;
  height: 56px;
  border-radius: 20px;
  cursor: pointer;
  transition: all 0.3s ease;
  text-decoration: none;
  color: rgba(0, 0, 0, 0.5);
  background: transparent;
  border: none;
  -webkit-tap-highlight-color: transparent;
  flex-shrink: 0;
  font-family: inherit;
}
.nav-item-icon { font-size: 24px; line-height: 1; transition: all 0.3s ease; }
.nav-item-label { font-size: 10px; margin-top: 2px; transition: all 0.3s ease; }
@media (hover: hover) {
  .nav-item:hover:not(.nav-item--active) {
    color: rgba(0, 0, 0, 0.75);
    background: rgba(0, 0, 0, 0.04);
  }
}
.nav-item:active { transform: scale(0.94); }
.nav-item--active {
  color: #111827;
  background: rgba(0, 0, 0, 0.06);
  box-shadow: 0 0 20px color-mix(in srgb, var(--theme-primary) 18%, transparent);
}
.nav-item--active .nav-item-icon {
  filter: drop-shadow(0 0 6px color-mix(in srgb, var(--theme-primary) 60%, transparent));
}
.nav-item--active::before {
  content: '';
  position: absolute;
  top: 0;
  left: 50%;
  transform: translateX(-50%);
  width: 20px;
  height: 2px;
  border-radius: 2px;
  background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--theme-primary) 80%, #fff), transparent);
  animation: glow-pulse 2s ease-in-out infinite alternate;
}
@keyframes glow-pulse {
  from { opacity: 0.5; width: 16px; }
  to { opacity: 1; width: 24px; }
}

/* Account Popup */
.account-popup-overlay {
  position: fixed;
  inset: 0;
  z-index: 1001;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  background: rgba(0, 0, 0, 0.35);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  pointer-events: auto;
}
.account-popup {
  pointer-events: auto;
  width: min(400px, calc(100vw - 24px));
  max-height: 70vh;
  margin-bottom: calc(80px + env(safe-area-inset-bottom, 0px));
  border-radius: 20px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  backdrop-filter: blur(24px) saturate(180%);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  background: rgba(25, 25, 35, 0.8);
  border: 1px solid rgba(255, 255, 255, 0.10);
  box-shadow: 0 8px 40px rgba(0, 0, 0, 0.5);
  animation: popup-slide-up 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}
@keyframes popup-slide-up {
  from { opacity: 0; transform: translateY(20px) scale(0.95); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
.popup-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 16px 8px;
}
.popup-title { font-size: 15px; font-weight: 700; color: #fff; }
.popup-close {
  width: 28px; height: 28px; display: flex; align-items: center; justify-content: center;
  border-radius: 8px; border: none; background: rgba(255,255,255,0.06);
  color: rgba(255,255,255,0.5); cursor: pointer; font-size: 14px;
}
.popup-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px 8px;
  max-height: 50vh;
}
.popup-list::-webkit-scrollbar { width: 3px; }
.popup-list::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 2px; }
.popup-empty { text-align: center; padding: 24px; color: rgba(255,255,255,0.4); font-size: 13px; }
.popup-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 10px 12px;
  border-radius: 14px;
  border: none;
  background: transparent;
  color: rgba(255,255,255,0.85);
  cursor: pointer;
  transition: all 0.2s;
  font-family: inherit;
  font-size: 14px;
  text-align: left;
}
.popup-item:hover { background: rgba(255,255,255,0.06); }
.popup-item--active { background: rgba(108,92,231,0.12); }
.popup-avatar {
  width: 36px; height: 36px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
  overflow: hidden;
  background: linear-gradient(135deg, var(--theme-primary, #6c5ce7), #a29bfe);
}
.popup-avatar-img { width: 100%; height: 100%; object-fit: cover; }
.popup-avatar-text { font-size: 13px; font-weight: 700; color: #fff; }
.popup-info { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.popup-name { font-weight: 600; font-size: 13px; }
.popup-sub { font-size: 11px; color: rgba(255,255,255,0.4); }
.popup-platform {
  font-size: 10px; padding: 2px 6px; border-radius: 6px; font-weight: 500;
}
.popup-check { color: var(--theme-primary, #6c5ce7); font-size: 14px; margin-left: 4px; }
.popup-remark-btn {
  width: 24px; height: 24px; display: flex; align-items: center; justify-content: center;
  border-radius: 6px; border: none; background: transparent;
  color: rgba(255,255,255,0.35); cursor: pointer; font-size: 12px; flex-shrink: 0;
}
.popup-remark-btn:hover { background: rgba(255,255,255,0.08); color: #fff; }

.popup-footer {
  border-top: 1px solid rgba(255,255,255,0.08);
  padding: 10px 8px;
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
}
.popup-action {
  flex: 1 1 auto;
  min-width: 84px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 9px 14px;
  border-radius: 9999px;
  border: 1px solid rgba(255,255,255,0.14);
  background: rgba(255,255,255,0.08);
  backdrop-filter: blur(10px);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
  font-family: inherit;
  text-decoration: none;
  white-space: nowrap;
}
.popup-action:hover { background: rgba(255,255,255,0.16); }
.popup-action--danger { color: #e74c3c; border-color: rgba(231,76,60,0.32); }
.popup-action--danger:hover { background: rgba(231,76,60,0.14); }

/* Transitions */
.popup-enter-active, .popup-leave-active { transition: opacity 0.25s ease; }
.popup-enter-from, .popup-leave-to { opacity: 0; }
.popup-enter-active .account-popup { animation: popup-slide-up 0.3s cubic-bezier(0.16, 1, 0.3, 1); }

  @media (prefers-color-scheme: light) {
  .floating-nav {
    background: transparent;
    border: 1px solid rgba(15, 23, 42, 0.1);
    box-shadow: 0 8px 32px rgba(15, 23, 42, 0.14);
  }
  .nav-item { color: rgba(0, 0, 0, 0.5); }
  .nav-item--active { color: #000; background: rgba(0, 0, 0, 0.05); box-shadow: 0 0 20px color-mix(in srgb, var(--theme-primary) 15%, transparent); }
  .nav-item--active::before { background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--theme-primary) 70%, #000), transparent); }
  @media (hover: hover) {
    .nav-item:hover:not(.nav-item--active) { color: rgba(0, 0, 0, 0.8); background: rgba(0, 0, 0, 0.03); }
  }
  .account-popup {
    background: rgba(245, 245, 250, 0.85);
    border: 1px solid rgba(0, 0, 0, 0.06);
    box-shadow: 0 8px 40px rgba(0, 0, 0, 0.15);
  }
  .popup-title { color: #111; }
  .popup-item { color: #222; }
  .popup-item:hover { background: rgba(0,0,0,0.04); }
  .popup-item--active { background: rgba(108,92,231,0.08); }
  .popup-sub { color: rgba(0,0,0,0.4); }
  .popup-remark-btn { color: rgba(0,0,0,0.3); }
  .popup-remark-btn:hover { color: #000; background: rgba(0,0,0,0.04); }
  .popup-footer { border-top-color: rgba(0,0,0,0.06); }
    .popup-action {
    background: rgba(0,0,0,0.04);
    border-color: rgba(0,0,0,0.08);
  }
  .popup-action:hover { background: rgba(0,0,0,0.08); }
  .popup-action--danger { border-color: rgba(231,76,60,0.28); }
  .popup-action--danger:hover { background: rgba(231,76,60,0.08); }
  .popup-action--danger:hover { background: rgba(231,76,60,0.06); }
  .popup-close { background: rgba(0,0,0,0.04); color: rgba(0,0,0,0.4); }
}

@media (max-width: 640px) {
  .floating-nav { gap: 4px; padding: 6px 8px; margin-bottom: 16px; border-radius: 24px; }
  .nav-item { width: 56px; height: 50px; border-radius: 18px; }
  .nav-item-icon { font-size: 22px; }
  .account-popup { margin-bottom: calc(72px + env(safe-area-inset-bottom, 0px)); }
}

@media (prefers-reduced-motion: reduce) {
  .floating-nav, .nav-item, .nav-item-icon, .nav-item--active::before, .account-popup,
  .floating-nav-wrapper, .ambient-glow {
    animation: none !important;
    transition: opacity 0.15s ease !important;
  }
}

.dark .floating-nav {
  background: rgba(30, 30, 40, 0.32);
  border: 1px solid rgba(255, 255, 255, 0.12);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4), 0 0 0 0.5px rgba(255, 255, 255, 0.05) inset;
}
.dark .nav-item { color: rgba(255, 255, 255, 0.5); }
.dark .nav-item--active { color: #fff; background: rgba(255, 255, 255, 0.1); }
.dark .nav-item:hover:not(.nav-item--active) { color: rgba(255, 255, 255, 0.8); background: rgba(255, 255, 255, 0.05); }
</style>
