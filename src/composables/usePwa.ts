import { onMounted, onUnmounted, ref, shallowRef } from 'vue'
import { useRegisterSW } from 'virtual:pwa-register/vue'

interface InstallEvent extends Event { prompt(): Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }
export function usePwa() {
  const prompt = shallowRef<InstallEvent | null>(null)
  const installed = ref(window.matchMedia('(display-mode: standalone)').matches || !!(navigator as Navigator & { standalone?: boolean }).standalone)
  const installing = ref(false)
  const registrationError = ref('')
  const { needRefresh, updateServiceWorker } = useRegisterSW({ onRegisterError: () => { registrationError.value = '离线缓存未启用。可继续在线使用；请检查 HTTPS 和浏览器设置。' } })
  const before = (event: Event) => { event.preventDefault(); prompt.value = event as InstallEvent }
  const complete = () => { installed.value = true; prompt.value = null }
  onMounted(() => { window.addEventListener('beforeinstallprompt', before); window.addEventListener('appinstalled', complete) })
  onUnmounted(() => { window.removeEventListener('beforeinstallprompt', before); window.removeEventListener('appinstalled', complete) })
  async function install() {
    if (!prompt.value) return false
    installing.value = true
    try { await prompt.value.prompt(); await prompt.value.userChoice; prompt.value = null; return true }
    finally { installing.value = false }
  }
  return { installed, installing, install, needRefresh, updateServiceWorker, registrationError }
}
