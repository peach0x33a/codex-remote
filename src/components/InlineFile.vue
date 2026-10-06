<script setup lang="ts">
import { formatFileSize, type FileAttachment } from '../lib/file-attachments'
import FileTypeIcon from './FileTypeIcon.vue'
defineProps<{ file: FileAttachment }>()
const emit = defineEmits<{ open: [path: string] }>()
</script>
<template>
  <button class="inline-file" type="button" :aria-label="'查看文件 ' + file.name" :title="file.path" @click="emit('open', file.path)"><FileTypeIcon :path="file.name" :size="18" /><span>{{ file.name }}</span><small>{{ formatFileSize(file.size) }}</small></button>
</template>
