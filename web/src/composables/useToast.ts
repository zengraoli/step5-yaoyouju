/**
 * 轻提示（Toast）：替代浏览器 alert，统一中文文案与样式。
 */
import { ref } from 'vue'

export type ToastType = 'info' | 'warn' | 'error'

interface ToastItem {
  id: number
  message: string
  type: ToastType
}

const items = ref<ToastItem[]>([])
let seq = 0

function show(message: string, type: ToastType = 'info', duration = 2800): void {
  const id = (seq += 1)
  items.value = [...items.value, { id, message, type }]
  window.setTimeout(() => {
    items.value = items.value.filter((t) => t.id !== id)
  }, duration)
}

export interface ToastApi {
  (message: string): void
  info(message: string): void
  warn(message: string): void
  error(message: string): void
}

export const toast: ToastApi = Object.assign((message: string) => show(message, 'info'), {
  info: (m: string) => show(m, 'info'),
  warn: (m: string) => show(m, 'warn'),
  error: (m: string) => show(m, 'error'),
})

export function useToast(): ToastApi {
  return toast
}

export const toastItems = items
