import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import api from '@/api'
import { useAccountStore } from '@/stores/account'

export const useBagStore = defineStore('bag', () => {
  const allItems = ref<any[]>([])
  const originalItems = ref<any[]>([])
  const loading = ref(false)
  // 【2026-08-13】背包物品上锁名单（跳过自动出售）
  const lockedItemIds = ref<number[]>([])

  function clearBag() {
    allItems.value = []
    originalItems.value = []
  }

  const items = computed(() => {
    const hiddenIds = new Set([1, 1001, 1002, 1101, 1011, 1012, 3001, 3002])
    return allItems.value.filter((it: any) => !hiddenIds.has(Number(it.id || 0)))
  })

  const dashboardItems = computed(() => {
    const targetIds = new Set([1011, 1012, 3001, 3002])
    return allItems.value.filter((it: any) => targetIds.has(Number(it.id || 0)))
  })

  async function fetchBag(accountId: string) {
    if (!accountId)
      return
    const requestedId = accountId
    loading.value = true
    try {
      const res = await api.get('/api/bag', {
        headers: { 'x-account-id': accountId },
      })
      const acc = useAccountStore()
      const curId = String((acc.currentAccountId as { value?: string })?.value ?? acc.currentAccountId ?? '')
      if (curId !== requestedId)
        return
      if (res.data.ok && res.data.data) {
        allItems.value = Array.isArray(res.data.data.items) ? res.data.data.items : []
        originalItems.value = Array.isArray(res.data.data.originalItems) ? res.data.data.originalItems : []
      }
      else if (res.data && res.data.ok === false && res.data.error) {
        allItems.value = []
        originalItems.value = []
      }
    }
    catch (e) {
      const acc = useAccountStore()
      const curId = String((acc.currentAccountId as { value?: string })?.value ?? acc.currentAccountId ?? '')
      if (curId === requestedId) {
        allItems.value = []
        originalItems.value = []
      }
      console.error(e)
    }
    finally {
      loading.value = false
    }
  }

  async function useItem(accountId: string, itemId: number, count = 1) {
    const res = await api.post('/api/bag/use', { itemId, count }, {
      headers: { 'x-account-id': accountId },
    })
    return res.data
  }

  async function sellItems(accountId: string, items: Array<{ id: number, count: number, uid?: number }>) {
    const res = await api.post('/api/bag/sell', { items }, {
      headers: { 'x-account-id': accountId },
    })
    return res.data
  }

  async function fetchLocked(accountId: string) {
    if (!accountId)
      return
    try {
      const res = await api.get('/api/bag/locked', {
        headers: { 'x-account-id': accountId },
      })
      if (res.data?.ok && res.data.data) {
        lockedItemIds.value = Array.isArray(res.data.data.itemIds) ? res.data.data.itemIds : []
      }
    }
    catch {
      // 忽略：锁定接口不可用时不影响背包展示
    }
  }

  async function toggleLock(accountId: string, itemId: number) {
    const res = await api.post('/api/bag/lock', { itemId }, {
      headers: { 'x-account-id': accountId },
    })
    if (res.data?.ok && res.data.data) {
      lockedItemIds.value = Array.isArray(res.data.data.itemIds) ? res.data.data.itemIds : []
    }
    return res.data
  }

  return {
    items, allItems, originalItems, dashboardItems, loading, lockedItemIds,
    fetchBag, clearBag, useItem, sellItems, fetchLocked, toggleLock,
  }
})
