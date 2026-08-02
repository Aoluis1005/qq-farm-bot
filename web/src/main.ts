import { createPinia } from 'pinia'
import { createApp } from 'vue'
import { useAppStore } from '@/stores/app'
import { useToastStore } from '@/stores/toast'
import App from './App.vue'
import router from './router'
import '@unocss/reset/tailwind.css'
import 'virtual:uno.css'
import './style.css'

const app = createApp(App)
const pinia = createPinia()

app.use(pinia)
app.use(router)

// Apply theme immediately before app mounts
const THEME_KEY = 'ui_theme'
const savedTheme = localStorage.getItem(THEME_KEY) || 'light'

const lightTheme = {
  isDark: false,
  bg: '#f6f8f3',
  text: '#1c2e1c',
  primary: '#22a65e',
  secondary: '#4ade80',
  accent: '#d97706',
  gradient: 'linear-gradient(135deg, #22a65e 0%, #d97706 100%)',
}

const darkTheme = {
  isDark: true,
  bg: '#0e1218',
  text: '#e2e8f0',
  primary: '#4ade80',
  secondary: '#22c55e',
  accent: '#fbbf24',
  gradient: 'linear-gradient(135deg, #4ade80 0%, #fbbf24 100%)',
}

const theme = savedTheme === 'dark' ? darkTheme : lightTheme
if (theme) {
  document.documentElement.style.setProperty('--theme-bg', theme.bg)
  document.documentElement.style.setProperty('--theme-text', theme.text)
  document.documentElement.style.setProperty('--theme-primary', theme.primary)
  document.documentElement.style.setProperty('--theme-secondary', theme.secondary)
  document.documentElement.style.setProperty('--theme-accent', theme.accent)
  document.documentElement.style.setProperty('--theme-gradient', theme.gradient)
  document.documentElement.style.setProperty('--theme-glass', theme.isDark ? 'rgba(14,18,24,0.72)' : 'rgba(255,255,255,0.72)')
  document.documentElement.style.setProperty('--theme-border', theme.isDark ? 'rgba(74,222,128,0.15)' : 'rgba(34,166,94,0.12)')
  if (savedTheme === 'dark') {
    document.documentElement.classList.add('dark')
  }
  else {
    document.documentElement.classList.remove('dark')
  }
}

// Global Error Handling
const toast = useToastStore()

app.config.errorHandler = (err: any, _instance, info) => {
  console.error('全局 Vue 错误:', err, info)
  const message = err.message || String(err)
  if (message.includes('ResizeObserver loop'))
    return
  toast.error(`应用错误: ${message}`)
}

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason
  if (reason && typeof reason === 'object' && 'isAxiosError' in reason)
    return

  console.error('Unhandled Rejection:', reason)
  const message = reason?.message || String(reason)
  toast.error(`异步错误: ${message}`)
})

window.onerror = (message, _source, _lineno, _colno, error) => {
  console.error('Global Error:', message, error)
  if (String(message).includes('Script error'))
    return
  toast.error(`系统错误: ${message}`)
}

// Apply theme from localStorage immediately, then sync from server if authed
const appStore = useAppStore()
appStore.fetchTheme()

app.mount('#app')
