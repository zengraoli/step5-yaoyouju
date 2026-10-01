<script setup lang="ts">
/**
 * 待确认单列表（双人确认的第二半）：另一名具备对应角色的账号在自己的浏览器里
 * 看到待确认单并直接「确认并执行」，不必与发起人共用一台设备（验收反馈第 9 条）。
 */
import { onMounted, ref } from 'vue'
import AppButton from '@/components/AppButton.vue'
import AppNotice from '@/components/AppNotice.vue'
import { request } from '@/api/request'

interface ConfirmationItem {
  id: string
  action: string
  label: string
  target_id: string
  target_label: string
  status: string
  requirement: string
  note: string | null
  requested_by_name: string
  requested_by_role: string
  confirmed_by_name: string | null
  requested_at: string
  can_confirm?: boolean
  payload?: Record<string, unknown>
}

const items = ref<ConfirmationItem[]>([])
const loading = ref(false)
const busy = ref('')
const errorText = ref('')
const tip = ref('')

async function load() {
  loading.value = true
  try {
    const res = await request<{ items: ConfirmationItem[] }>({ url: '/admin/confirmations' })
    items.value = (res?.items ?? []).filter((i) => i.status === '待确认')
  } catch {
    items.value = []
  } finally {
    loading.value = false
  }
}

/** 确认并执行：服务端校验角色、不能与发起人同一人、必须已绑定 MFA，然后真正执行业务 */
async function approve(item: ConfirmationItem) {
  busy.value = item.id
  errorText.value = ''
  tip.value = ''
  try {
    const result = await request<unknown>({
      url: `/admin/confirmations/${encodeURIComponent(item.id)}/approve`,
      method: 'POST',
    })
    tip.value = `已确认并执行：${item.label}`
    emit('done')
    await load()
    void result
  } catch (e) {
    errorText.value = e instanceof Error ? e.message : '确认失败，请稍后重试'
  } finally {
    busy.value = ''
  }
}

async function reject(item: ConfirmationItem) {
  busy.value = item.id
  errorText.value = ''
  try {
    await request({ url: `/admin/confirmations/${encodeURIComponent(item.id)}/reject`, method: 'POST', data: { reason: '不符合当前情况' } })
    tip.value = `已驳回：${item.label}`
    emit('done')
    await load()
  } catch (e) {
    errorText.value = e instanceof Error ? e.message : '驳回失败'
  } finally {
    busy.value = ''
  }
}

const emit = defineEmits<{ done: [] }>()

onMounted(load)
defineExpose({ load })
</script>

<template>
  <section class="pending">
    <div class="pending__head">
      <h2 class="pending__title">待我确认的双人确认单（{{ items.length }}）</h2>
      <AppButton type="soft" size="sm" :loading="loading" @click="load">刷新</AppButton>
    </div>
    <AppNotice v-if="tip" type="info">{{ tip }}</AppNotice>
    <AppNotice v-if="errorText" type="error">{{ errorText }}</AppNotice>
    <p v-if="items.length === 0 && !loading" class="pending__empty">当前没有待确认的申请。</p>
    <ul v-else class="pending__list">
      <li v-for="i in items" :key="i.id" class="pending__item">
        <div class="pending__item-main">
          <p class="pending__item-title">
            {{ i.label }}<span class="pending__item-target"> · {{ i.target_label || i.target_id.slice(0, 8) }}</span>
          </p>
          <p class="pending__item-meta">
            发起人：{{ i.requested_by_name }}（{{ i.requested_by_role }}） · {{ i.requested_at.slice(0, 16).replace('T', ' ') }}
            · 要求：{{ i.requirement }}
          </p>
          <p v-if="i.note" class="pending__item-note">原因：{{ i.note }}</p>
        </div>
        <div class="pending__item-ops">
          <AppButton
            v-if="i.can_confirm"
            type="primary"
            size="sm"
            :loading="busy === i.id"
            @click="approve(i)"
          >
            确认并执行
          </AppButton>
          <span v-else class="pending__item-hint">需由{{ i.requirement }}确认</span>
          <AppButton v-if="i.can_confirm" type="soft" size="sm" :loading="busy === i.id" @click="reject(i)">驳回</AppButton>
        </div>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.pending {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-card);
  padding: var(--spacing-md) var(--spacing-lg);
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
}

.pending__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-md);
}

.pending__title {
  margin: 0;
  font-size: var(--font-size-card-title);
  font-weight: var(--font-weight-medium);
}

.pending__empty {
  margin: 0;
  font-size: var(--font-size-aux);
  color: var(--color-text-3);
}

.pending__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
}

.pending__item {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--spacing-md);
  padding: var(--spacing-sm) 0;
  border-top: 1px solid var(--color-border);
}

.pending__item-main {
  min-width: 0;
}

.pending__item-title {
  margin: 0;
  font-size: var(--font-size-aux);
  font-weight: var(--font-weight-medium);
}

.pending__item-target {
  color: var(--color-text-2);
  font-weight: var(--font-weight-regular);
}

.pending__item-meta,
.pending__item-note {
  margin: 2px 0 0;
  font-size: var(--font-size-aux-sm);
  color: var(--color-text-2);
}

.pending__item-ops {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  flex-shrink: 0;
}

.pending__item-hint {
  font-size: var(--font-size-aux-sm);
  color: var(--color-text-3);
}
</style>
