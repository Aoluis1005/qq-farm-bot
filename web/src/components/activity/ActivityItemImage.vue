<script setup lang="ts">
import { computed, ref } from 'vue'

// 活动物品图片组件 —— 与过期「荷露」活动保持一致：
// 直接使用后端 normalizeExchangeShopItem 返回的 item.image（即 gameConfig 中
// skinDetailImageMap / seedCdnFallback 等映射出来的 CDN 或本地资源 URL）。
// 没有图片或加载失败时，显示 item.name 首字兜底。
//
// 注意：活动专属 sprite（item.extra.res）不再使用本地 texture 资源——
// 那些 `img_exchange_item{N}.png` 是游戏 texture 整页/场景插画，不是单 item 图标，
// 整图渲染会被误识为「游戏场景切片」。正确的单 item 图标由后端 item.image 提供。
//
// 月光营地滤镜：skinDetail 目录里「萤火」与「月光」两套皮肤图实际是同一张图（解包时挂了一份），
// 这里为名称包含「月光营地」的物品叠加冷色调滤镜，让两套视觉上区分开。

const props = defineProps<{
  item: { image?: string; itemName?: string; name?: string; itemId?: number }
  imgClass?: string
}>()

const error = ref(false)
const src = computed(() => (error.value ? '' : (props.item.image || '')))
const showImage = computed(() => Boolean(src.value))
const fallbackText = computed(() => {
  const n = String(props.item.name || props.item.itemName || '').trim()
  return n ? n.slice(0, 1) : String(props.item.itemId || '?')
})
const isMoon = computed(() => {
  const name = String(props.item.name || props.item.itemName || '')
  return name.includes('月光')
})
function onError() {
  error.value = true
}
</script>

<template>
  <img
    v-if="showImage"
    :src="src"
    :alt="item.name || item.itemName"
    class="object-contain"
    :class="[imgClass || 'max-h-14 max-w-14', isMoon ? 'hue-rotate-180 brightness-90 saturate-125' : '']"
    @error="onError"
  >
  <span
    v-else
    class="grid place-items-center rounded bg-white text-gray-500 font-semibold dark:bg-gray-800"
    :class="[imgClass || 'h-14 w-14 text-sm', isMoon ? 'hue-rotate-180 brightness-90 saturate-125' : '']"
  >{{ fallbackText }}</span>
</template>