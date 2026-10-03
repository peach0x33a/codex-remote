<script setup lang="ts">
import HeroBackdrop from './HeroBackdrop.vue'
import type { BackgroundMode, ImageBackgroundSettings } from '../lib/ui-preferences'
defineProps<{ mode: BackgroundMode; theme: 'light' | 'dark'; imageUrl: string; imageSettings: ImageBackgroundSettings; welcome: boolean }>()
</script>
<template>
  <HeroBackdrop v-if="mode === 'animated'" :key="theme" :theme="theme" :class="{ 'is-conversation': !welcome }" />
  <div v-else-if="mode === 'image' && imageUrl" class="workspace-image-backdrop" :style="{ '--image-opacity': imageSettings.opacity / 100, '--image-blur': imageSettings.blur + 'px', '--image-color': imageSettings.color, '--image-color-opacity': imageSettings.colorOpacity / 100 }" aria-hidden="true"><img :src="imageUrl" alt="" :draggable="false" referrerpolicy="no-referrer" /></div>
</template>
<style scoped>
.workspace-image-backdrop { position: absolute; inset: 0; z-index: -1; overflow: hidden; pointer-events: none; background: var(--canvas); }
.workspace-image-backdrop img { position: absolute; inset: calc(var(--image-blur) * -3); width: calc(100% + var(--image-blur) * 6); height: calc(100% + var(--image-blur) * 6); object-fit: cover; object-position: center; opacity: var(--image-opacity); filter: blur(var(--image-blur)); }
.workspace-image-backdrop::after { content: ''; position: absolute; inset: 0; background: var(--image-color); opacity: var(--image-color-opacity); }
</style>
