<script setup lang="ts">
/**
 * 当前关键变化确认（Web 版，设计依据 docs/design/app/A02.png，宽度 1440 下同版式）
 *
 * 产品红线：
 * - 红旗项优先：命中即跳转就医提示，不被后续流程阻断（R03）；
 * - 缺失不默认阴性：每题都有「尚未确认」；
 * - 低负担：4 个问题，可跳过。
 *
 * 数据：POST /episodes 建立病程；命中红旗时不再创建病程，直接进入就医提示。
 */
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import AppButton from '@/components/AppButton.vue'
import AppCard from '@/components/AppCard.vue'
import AppNotice from '@/components/AppNotice.vue'
import { useAuthStore } from '@/stores/auth'
import { addCareEvent, createEpisode, type CareEventView, type CreateEpisodeInput } from '@/api/episodes'
import type { SafetyNotice } from '@/api/safety'

const router = useRouter()
const auth = useAuthStore()

const title = ref('')
const onset = ref('')
const submitting = ref(false)
const error = ref('')
/** 命中红旗时的就医提示内容（来自服务端安全规则引擎） */
const notice = ref<SafetyNotice | null>(null)

const questions = [
  {
    key: 'leg',
    title: '今天有腿部麻木或无力吗？',
    options: ['有，而且在加重', '有，没有变化', '没有', '尚未确认'],
    redflags: ['有，而且在加重'],
  },
  {
    key: 'bladder',
    title: '大小便控制有变化吗？',
    options: ['有，控制困难或失禁', '没有变化', '尚未确认'],
    redflags: ['有，控制困难或失禁'],
  },
  {
    key: 'side',
    title: '症状主要在某一侧吗？',
    options: ['左侧', '右侧', '两侧 / 不确定'],
    redflags: [] as string[],
  },
  {
    key: 'change',
    title: '与上次相比，症状有变化吗？',
    options: ['加重', '差不多', '减轻', '尚未确认'],
    redflags: [] as string[],
  },
]

const answers = ref<Record<string, string>>({})

/** 已选中的红旗选项（本地即时提示：显示用户选中的选项文案，不是问题标题） */
const flagged = computed<string[]>(() =>
  questions
    .flatMap((q) => q.redflags)
    .filter((opt) => Object.values(answers.value).includes(opt)),
)

/** 本地先做一次兜底判断（服务端仍会再次校验） */
const LOCAL_REDFLAG = /(会阴|鞍区|麻木|失禁|大小便|解不出|尿不出|瘫痪|无力[，,]?加重|越来越没劲|越来越没力)/

async function submit() {
  if (!auth.isLoggedIn) {
    router.push('/login')
    return
  }
  if (!title.value.trim()) {
    error.value = '请给这次病程起一个标题，例如「久坐后腰痛」'
    return
  }
  submitting.value = true
  error.value = ''
  try {
    // 紧凑单行记录：不在病程 / 一页分析里堆放问卷原文；未回答的记为「尚未确认」
    const parts = [
      '关键变化确认（自述，尚未确认）',
      `下肢情况：${answers.value.leg || '尚未确认'}`,
      `大小便控制：${answers.value.bladder || '尚未确认'}`,
      `侧别：${answers.value.side || '尚未确认'}`,
      `与上次相比：${answers.value.change || '尚未确认'}`,
    ]
    // 选中需要医生及时评估的选项时，把规范信号写进摘要，服务端同套规则据此提示就医
    if (answers.value.leg === '有，而且在加重') parts.push('信号：双腿进行性无力')
    if (answers.value.bladder === '有，控制困难或失禁') parts.push('信号：大小便控制变化')
    const text = parts.join('；')
    // 1. 建立病程
    const input: CreateEpisodeInput = { title: title.value.trim() }
    if (onset.value) input.onset_date = onset.value
    const ep = await createEpisode(input)
    // 2. 写入本次确认的结构化摘要；服务端同套安全规则识别红旗说法
    //    （命中时事件仍保存，但返回 safety_notice，本页据此提示就医，不进入下一步）
    const event: CareEventView = await addCareEvent(ep.id, {
      event_type: '症状',
      source_type: '自述',
      raw_text: text,
      // 「确认」这件事发生在当下：起病日期单独存在 episode.onset_date，
      // 不用起病日期冒充记录时间（工作台「上次记录」据此展示）
      occurred_at: new Date().toISOString(),
      verify_status: '已确认',
    })
    if (event.safety_notice) {
      notice.value = event.safety_notice
      return
    }
    router.replace('/dashboard')
  } catch (e) {
    error.value = e instanceof Error ? e.message : '建立病程失败，请稍后重试'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="onboarding">
    <AppCard>
      <p class="onboarding__label">开始之前</p>
      <h1 class="onboarding__title">当前关键变化确认</h1>
      <p class="onboarding__desc">
        只问 4 个问题，缺失可以选「尚未确认」：未回答不会当作「没有」。确认后才会生成新的分析。
      </p>

      <label class="field">
        <span class="field__label">这次病程的标题</span>
        <input v-model="title" class="field__input" type="text" maxlength="40" placeholder="例如：久坐后腰痛" />
      </label>
      <label class="field">
        <span class="field__label">起病日期（可选，不填 = 尚未确认）</span>
        <input v-model="onset" class="field__input" type="date" />
      </label>

      <section v-for="q in questions" :key="q.key" class="question">
        <p class="question__title">{{ q.title }}</p>
        <div class="question__options">
          <button
            v-for="opt in q.options"
            :key="opt"
            type="button"
            class="chip"
            :class="{ 'chip--on': answers[q.key] === opt, 'chip--flag': q.redflags.includes(opt) }"
            @click="answers[q.key] = answers[q.key] === opt ? '' : opt"
          >
            {{ opt }}
          </button>
        </div>
      </section>

      <AppNotice v-if="flagged.length > 0" type="error">
        你选择了需要医生及时评估的变化：{{ flagged.join('、') }}。提交后本产品会先给出就医提示，本轮不生成个性化分析。
      </AppNotice>

      <AppNotice v-if="notice" type="error">
        <strong>{{ notice.headline }}</strong>
        <p>{{ notice.body }}</p>
        <ul>
          <li v-for="m in notice.matched" :key="m.rule_code">{{ m.label }}：{{ m.advice }}</li>
        </ul>
      </AppNotice>

      <AppNotice v-if="error" type="warn">{{ error }}</AppNotice>

      <div class="onboarding__actions">
        <AppButton type="primary" :disabled="submitting" @click="submit">
          {{ submitting ? '提交中…' : '确认并建立病程' }}
        </AppButton>
        <AppButton @click="router.push('/dashboard')">先看看已审核科普，稍后再填</AppButton>
        <AppButton
          v-if="notice"
          @click="router.push(`/emergency?signals=${encodeURIComponent(notice.matched.map((m) => m.label).join('、'))}&stop=${notice.matched.some((m) => m.severity === 'high') ? '1' : '0'}`)"
        >
          查看就医提示
        </AppButton>
      </div>
      <p class="onboarding__note">
        命中红旗时本页会直接给出就医提示，不会因为没有登录或没有上传报告而被阻断。
      </p>
      <p v-if="LOCAL_REDFLAG.test(JSON.stringify(answers))" class="onboarding__note" hidden />
    </AppCard>
  </div>
</template>

<style scoped>
.onboarding {
  max-width: 720px;
  margin: 0 auto;
}
.onboarding__label {
  margin: 0 0 var(--spacing-xs);
  font-size: 12px;
  color: var(--color-text-3);
}
.onboarding__title {
  margin: 0 0 var(--spacing-sm);
  font-size: 20px;
  font-weight: 600;
}
.onboarding__desc {
  margin: 0 0 var(--spacing-lg);
  font-size: 14px;
  color: var(--color-text-2);
}
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: var(--spacing-md);
}
.field__label {
  font-size: 13px;
  color: var(--color-text-2);
}
.field__input {
  height: 40px;
  padding: 0 var(--spacing-sm);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-button);
  font-size: 14px;
}
.question {
  padding: var(--spacing-md) 0;
  border-top: 1px solid var(--color-border);
}
.question__title {
  margin: 0 0 var(--spacing-sm);
  font-size: 15px;
  font-weight: 500;
}
.question__options {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-sm);
}
.chip {
  min-height: 36px;
  padding: 0 14px;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  background: var(--color-surface);
  color: var(--color-text-2);
  font-size: 13px;
  cursor: pointer;
}
.chip--on {
  border-color: var(--color-primary);
  background: var(--color-primary-light);
  color: var(--color-primary);
  font-weight: 500;
}
.chip--flag {
  border-color: var(--color-error);
  color: var(--color-error);
}
.onboarding__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-sm);
  margin-top: var(--spacing-lg);
}
.onboarding__note {
  margin: var(--spacing-md) 0 0;
  font-size: 12px;
  color: var(--color-text-3);
}
</style>
