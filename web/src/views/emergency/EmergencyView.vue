<script setup lang="ts">
/**
 * 就医提示（R03，公开页，无需登录；内容来自 server 公开接口）
 * 网络异常时展示静态兜底内容（就医提示不被网络阻断）。
 */
import { onMounted, ref } from 'vue'
import AppNotice from '@/components/AppNotice.vue'
import { getEmergencyNotice } from '@/api/safety'

interface EmergencyNotice {
  title: string
  headline: string
  body: string
  offline_note: string
  actions: { type: string; label: string }[]
  bring_list: string[]
  summary_action: { label: string }
  footer_note: string
}

/** 网络异常时的静态兜底内容（就医提示不被网络阻断） */
const FALLBACK: EmergencyNotice = {
  title: '需要及时寻求专业帮助',
  headline: '建议尽快就医',
  body: '你刚才选择了需要医生及时评估的变化。这类变化需要医生及时评估，本产品无法替你判断严重程度，本轮不会生成个性化分析。',
  offline_note: '本页在网络异常时也可查看。',
  actions: [
    { type: 'call', label: '拨打 120 / 前往急诊' },
    { type: 'hospital', label: '查找附近医院' },
    { type: 'doctor', label: '联系我的主治医生（已保存）' },
  ],
  bring_list: ['已录入的检查报告原文', '症状开始时间与最近变化记录', '正在使用的药物与既有医嘱'],
  summary_action: { label: '生成一页“就诊交接”摘要（仅整理已有信息）' },
  footer_note: '此提示由临床审定规则触发，不是诊断结论；请以医生的评估为准。',
}

const notice = ref<EmergencyNotice>(FALLBACK)

onMounted(async () => {
  try {
    notice.value = await getEmergencyNotice()
  } catch {
    notice.value = FALLBACK
  }
})
</script>

<template>
  <div class="emergency-page">
    <div class="emergency-card">
      <h1 class="emergency-card__title">{{ notice.title }}</h1>
      <div class="emergency-card__hero">
        <h2>{{ notice.headline }}</h2>
        <p>{{ notice.body }}</p>
        <p class="emergency-card__offline">{{ notice.offline_note }}</p>
      </div>
      <div class="emergency-card__actions">
        <a v-for="a in notice.actions" :key="a.type" class="emergency-action" :class="`emergency-action--${a.type}`" href="javascript:void(0)">
          {{ a.label }}
        </a>
      </div>
      <section class="emergency-card__section">
        <h3>就诊时可以带上</h3>
        <ul>
          <li v-for="item in notice.bring_list" :key="item">{{ item }}</li>
        </ul>
      </section>
      <AppNotice type="info">{{ notice.footer_note }}</AppNotice>
    </div>
  </div>
</template>

<style scoped>
.emergency-page {
  max-width: 720px;
  margin: 0 auto;
}

.emergency-card {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-card);
  padding: var(--spacing-xxl);
  display: flex;
  flex-direction: column;
  gap: var(--spacing-lg);
}

.emergency-card__title {
  margin: 0;
  font-size: var(--font-size-page-title);
  font-weight: var(--font-weight-medium);
}

.emergency-card__hero {
  background: var(--color-error-light);
  border-radius: var(--radius-card);
  padding: var(--spacing-lg);
}

.emergency-card__hero h2 {
  margin: 0 0 var(--spacing-sm);
  font-size: var(--font-size-card-title);
  color: var(--color-error);
}

.emergency-card__hero p {
  margin: 0 0 var(--spacing-xs);
  font-size: var(--font-size-body);
  line-height: var(--line-height-body);
}

.emergency-card__offline {
  color: var(--color-text-2);
  font-size: var(--font-size-aux-sm);
}

.emergency-card__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-sm);
}

.emergency-action {
  min-height: 44px;
  display: inline-flex;
  align-items: center;
  padding: var(--spacing-sm) var(--spacing-lg);
  border-radius: var(--radius-button);
  font-size: var(--font-size-body);
  text-decoration: none;
}

.emergency-action--call {
  background: var(--color-error);
  color: var(--color-surface);
}

.emergency-action--hospital,
.emergency-action--doctor {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  color: var(--color-text-1);
}

.emergency-card__section h3 {
  margin: 0 0 var(--spacing-sm);
  font-size: var(--font-size-card-title);
}

.emergency-card__section ul {
  margin: 0;
  padding-left: var(--spacing-lg);
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
  font-size: var(--font-size-body);
  color: var(--color-text-2);
}
</style>
