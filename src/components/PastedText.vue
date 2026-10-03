<script setup lang="ts">
import { pastedTextLabel } from '../lib/prompt'
defineProps<{ text: string }>()
</script>
<template>
  <details class="pasted-text"><summary class="inline-pasted-text">{{ pastedTextLabel(text) }}</summary><pre>{{ text }}</pre></details>
</template>
<style scoped>
.pasted-text { display: inline-block; max-width: 100%; vertical-align: middle; }
.pasted-text > summary { cursor: pointer; list-style: none; }
.pasted-text > summary::-webkit-details-marker { display: none; }
.pasted-text > pre { margin: 8px 0 0; padding: 12px; max-height: 240px; overflow: auto; overscroll-behavior: contain; border-radius: var(--radius-md); background: var(--canvas); color: var(--ink-soft); white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; }
</style>
