<script setup lang="ts">
/**
 * 双人确认弹层（B10 / 验收反馈第 10 条）。
 * 第一步：填写原因并发起确认单；第二步：另一名具备对应角色的账号带上确认单 ID 再次提交。
 */
import { computed, ref } from 'vue'
import AppButton from '@/components/AppButton.vue'
import AppCard from '@/components/AppCard.vue'
import AppNotice from '@/components/AppNotice.vue'
import { request } from '@/api/request'

export interface ConfirmationItem {
  id: string
  action: string
  label: string
  target_id: string
  status: string
  requirement: string
  note: string | null
  requested_by_name: string
  confirmed_by_name: string | null
  requested_at: string
}

const props = defineProps<{
  /** 动作（见服务端 CONFIRMATION_RULES） */
  action: string
  /** 目标 ID */
  targetId: string
  /** 目标说明 */
  targetLabel?: string
  /** 确认后要提交的业务接口（PUT / POST） */
  submit: (confirmationId: string) => Promise<unknown>
  /** 按钮文字 */
  buttonText?: string
  buttonType?: 'primary' | 'soft' | 'danger'
  disabled?: boolean
}>()

const emit = defineEmits<{ done: [] }>()

const open = ref(false)
const step = ref<'form' | 'submitted'>('form')
const note = ref('')
const confirmation = ref<ConfirmationItem | null>(null)
const busy = ref(false)
const errorText = ref('')
/** 目标（开启 / 关闭开关等） */
const payload = ref<Record<string, unknown>>({})

const title = computed(() => props.buttonText ?? '提交（需双人确认）')

async function start(target?: unknown, label?: string) {
  open.value = true
  step.value = 'form'
  errorText.value = ''
  note.value = ''
  payload.value = target === undefined ? {} : { value: target }
  if (label) extraLabel.value = label
}

const extraLabel = ref('')

async function submitInit() {
  if (!note.value.trim()) {
    errorText.value = '请填写变更原因（写审计）'
    return
  }
  busy.value = true
  errorText.value = ''
  try {
    const created = await request<ConfirmationItem>({
      url: '/admin/confirmations',
      method: 'POST',
      data: {
        action: props.action,
        target_id: props.targetId,
        target_label: props.targetLabel ?? extraLabel.value,
        note: note.value.trim(),
      },
    })
    confirmation.value = created
    step.value = 'submitted'
    emit('done')
  } catch (e) {
    errorText.value = e instanceof Error ? e.message : '提交确认单失败'
  } finally {
    busy.value = false
  }
}

async function confirmAndRun() {
  const c = confirmation.value
  if (!c) return
  busy.value = true
  errorText.value = ''
  try {
    await props.submit(c.id)
    open.value = false
    emit('done')
  } catch (e) {
    errorText.value = e instanceof Error ? e.message : '执行失败，请确认是否已由另一人确认'
  } finally {
    busy.value = false
  }
}

async function cancel() {
  if (confirmation.value) {
    try {
      await request({ url: `/admin/confirmations/${confirmation.value.id}/cancel`, method: 'POST' })
    } catch {
      // 取消失败不影响关闭
    }
  }
  open.value = false
  confirmation.value = null
  emit('done')
}

defineExpose({ start })</script>

<template>
  <AppButton :type="buttonType ?? 'soft'" :disabled="disabled" @click="start">{{ title }}</AppButton>

  <div v-if="open" class="dc-mask" @click.self="cancel">
    <AppCard class="dc">
      <template v-if="step === 'form'">
        <h3 class="dc__title">发起双人确认</h3>
        <p class="dc__desc">该操作需要两名账号共同确认：你发起，另一名具备对应角色的账号确认后生效。</p>
        <label class="dc__field">
          <span>变更原因（写审计）</span>
          <textarea v-model="note" class="dc__input dc__input--area" rows="3" maxlength="500" />
        </label>
        <AppNotice v-if="errorText" type="warn">{{ errorText }}</AppNotice>
        <div class="dc__actions">
          <AppButton type="primary" :disabled="busy" @click="submitInit">发起确认单</AppButton>
          <AppButton type="soft" @click="cancel">取消</AppButton>
        </div>
      </template>

      <template v-else>
        <h3 class="dc__title">等待另一人确认</h3>
        <AppNotice type="warn">
          已提交确认单（{{ confirmation?.requirement }}）。请由另一名具备权限的账号在同一台设备上再次操作并确认；
          你也可以先撤销。
        </AppNotice>
        <p class="dc__meta">发起人：{{ confirmation?.requested_by_name }} · 状态：{{ confirmation?.status }}</p>
        <AppNotice v-if="errorText" type="warn">{{ errorText }}</AppNotice>
        <div class="dc__actions">
          <AppButton type="primary" :disabled="busy" @click="confirmAndRun">我已让另一人确认，执行</AppButton>
          <AppButton type="soft" @click="cancel">撤销确认单</AppButton>
        </div>
      </template>
    </AppCard>
  </div>
</template>

<style scoped>
.dc-mask {
  position: fixed;
  inset: 0;
  background: rgb(27 34 48 / 45%);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--spacing-lg);
  z-index: 40;
}
.dc {
  width: 100%;
  max-width: 520px;
}
.dc__title {
  margin: 0 0 var(--spacing-xs);
  font-size: var(--font-size-card-title);
}
.dc__desc,
.dc__meta {
  margin: 0 0 var(--spacing-md);
  font-size: var(--font-size-aux);
  color: var(--color-text-2);
}
.dc__field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: var(--spacing-md);
  font-size: var(--font-size-aux);
  color: var(--color-text-2);
}
.dc__input {
  height: 36px;
  padding: 0 var(--spacing-sm);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-button);
}
.dc__input--area {
  height: auto;
  padding: var(--spacing-sm);
  line-height: 1.6;
}
.dc__actions {
  display: flex;
  gap: var(--spacing-sm);
  margin-top: var(--spacing-md);
}
</style>
