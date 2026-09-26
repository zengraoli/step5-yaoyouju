<script setup lang="ts">
/**
 * 状态标签（三端语义完全一致）
 * 已确认 / 尚未确认 / 有冲突 / 未经核实 / 报告原文 / 自述 /
 * 系统生成 / 已审核 v2 / 已下线 · 更正中 / 不作诊断
 */
type StatusTone = 'ok' | 'warn' | 'error' | 'info' | 'neutral'

export type StatusKey =
  | 'confirmed'
  | 'unconfirmed'
  | 'conflict'
  | 'unverified'
  | 'quote'
  | 'self'
  | 'generated'
  | 'reviewed'
  | 'offline'
  | 'no-diagnosis'

const STATUS_MAP: Record<StatusKey, { text: string; tone: StatusTone }> = {
  confirmed: { text: '已确认', tone: 'ok' },
  unconfirmed: { text: '尚未确认', tone: 'warn' },
  conflict: { text: '有冲突', tone: 'error' },
  unverified: { text: '未经核实', tone: 'warn' },
  quote: { text: '报告原文', tone: 'info' },
  self: { text: '自述', tone: 'neutral' },
  generated: { text: '系统生成', tone: 'neutral' },
  reviewed: { text: '已审核 v2', tone: 'ok' },
  offline: { text: '已下线 · 更正中', tone: 'neutral' },
  'no-diagnosis': { text: '不作诊断', tone: 'neutral' },
}

withDefaults(defineProps<{ status: StatusKey; text?: string }>(), {})

function metaOf(status: StatusKey) {
  return STATUS_MAP[status]
}
</script>

<template>
  <span class="status-tag" :class="`status-tag--${metaOf(status).tone}`">
    {{ text || metaOf(status).text }}
  </span>
</template>

<style scoped>
.status-tag {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: var(--radius-tag);
  font-size: var(--font-size-tag);
  font-weight: var(--font-weight-medium);
  line-height: 1.5;
  white-space: nowrap;
}

.status-tag--ok {
  color: var(--color-ok);
  background: var(--color-ok-light);
}

.status-tag--warn {
  color: var(--color-warn);
  background: var(--color-warn-light);
}

.status-tag--error {
  color: var(--color-error);
  background: var(--color-error-light);
}

.status-tag--info {
  color: var(--color-info);
  background: var(--color-info-light);
}

.status-tag--neutral {
  color: var(--color-text-2);
  background: var(--color-neutral-light);
}
</style>
