<script setup lang="ts">
/**
 * 自绘 SVG 图标（线性风格，currentColor 随文字颜色，不加载任何外部资源）
 * 用法：<AppIcon name="home" :size="22" color="#0F6E74" />
 */
import { computed } from 'vue'

/** 图标名称（按信息架构的五个入口 + 通用图标整理） */
export type IconName =
  | 'home'
  | 'chat'
  | 'timeline'
  | 'clipboard'
  | 'user'
  | 'alert'
  | 'info'
  | 'check'
  | 'close'
  | 'phone'
  | 'arrow-right'
  | 'bell'
  | 'edit'
  | 'upload'
  | 'calendar'
  | 'play'
  | 'back'
  | 'location'
  | 'file'
  | 'report'
  | 'pulse'
  | 'heart'
  | 'ellipsis'
  | 'send'
  | 'filter'
  | 'plus'
  | 'search'

interface IconShape {
  /** 路径 d 值 */
  paths: string[]
  /** 圆形节点（时间线 / 头像等） */
  circles?: { cx: number; cy: number; r: number }[]
}

const VIEW_BOX = 24

/** 全部图标均为 24×24 线性图标，stroke-width 1.8 */
const ICONS: Record<IconName, IconShape> = {
  // 当前情况（首页）
  home: {
    paths: ['M3.4 10.4 12 3.2l8.6 7.2', 'M5.6 9.2v10.2a1.4 1.4 0 0 0 1.4 1.4h10a1.4 1.4 0 0 0 1.4-1.4V9.2', 'M9.7 20.8v-5.4h4.6v5.4'],
  },
  // 问与解释
  chat: {
    paths: [
      'M4.8 6.4A1.8 1.8 0 0 1 6.6 4.6h10.8a1.8 1.8 0 0 1 1.8 1.8v6.4a1.8 1.8 0 0 1-1.8 1.8h-6.6l-4.2 3.6v-3.6H6.6a1.8 1.8 0 0 1-1.8-1.8z',
      'M9.2 9.2h5.6',
      'M9.2 12.2h3.6',
    ],
  },
  // 病程时间线
  timeline: {
    paths: ['M7 5.4v13.2'],
    circles: [
      { cx: 7, cy: 7, r: 1.6 },
      { cx: 7, cy: 12, r: 1.6 },
      { cx: 7, cy: 17, r: 1.6 },
    ],
  },
  // 复诊准备
  clipboard: {
    paths: [
      'M9 4.6H7.4A1.6 1.6 0 0 0 5.8 6.2v12.6a1.6 1.6 0 0 0 1.6 1.6h9.2a1.6 1.6 0 0 0 1.6-1.6V6.2a1.6 1.6 0 0 0-1.6-1.6H15',
      'M9 3.2h6v2.8H9z',
      'M8.8 11h6.4',
      'M8.8 14.6h4.4',
    ],
  },
  // 我的
  user: {
    paths: ['M5.2 20.2c0-3.4 3-5.6 6.8-5.6s6.8 2.2 6.8 5.6'],
    circles: [{ cx: 12, cy: 8, r: 3.4 }],
  },
  // 就医提示 / 提醒（三角警示）
  alert: {
    paths: ['M12 3.8 2.9 19.6h18.2z', 'M12 9.6v4.2', 'M12 16.6v.6'],
  },
  // 信息提示
  info: {
    paths: ['M12 11.2v5', 'M12 7.8v.4'],
    circles: [{ cx: 12, cy: 12, r: 8.6 }],
  },
  // 已选 / 完成
  check: { paths: ['M4.8 12.6 9.8 17.6 19.2 6.6'] },
  // 关闭
  close: { paths: ['M6.2 6.2l11.6 11.6', 'M17.8 6.2 6.2 17.8'] },
  // 电话（就医动作）
  phone: {
    paths: [
      'M6.6 3.6h2.8l1.5 3.8-2 1.5a11.4 11.4 0 0 0 5.8 5.8l1.5-2 3.8 1.5v2.8a1.9 1.9 0 0 1-2.1 1.9A16.6 16.6 0 0 1 4.7 5.7a1.9 1.9 0 0 1 1.9-2.1z',
    ],
  },
  // 右箭头
  'arrow-right': { paths: ['M4 12h15.2', 'M13.6 6.4 19.8 12l-6.2 5.6'] },
  // 通知（首页右上角铃铛）
  bell: {
    paths: [
      'M12 3.6a5.8 5.8 0 0 1 5.8 5.8c0 4.6 1.5 5.9 1.5 5.9H4.7s1.5-1.3 1.5-5.9A5.8 5.8 0 0 1 12 3.6z',
      'M10.1 18.6a2 2 0 0 0 3.8 0',
    ],
  },
  // 记录今天（铅笔）
  edit: {
    paths: ['M17.4 3.6a2.1 2.1 0 0 1 3 3L8.2 18.8 4 20l1.2-4.2z'],
  },
  // 录入报告（上传）
  upload: {
    paths: ['M20.4 15.2v3.6a1.8 1.8 0 0 1-1.8 1.8H5.4a1.8 1.8 0 0 1-1.8-1.8v-3.6', 'M16.8 8.2 12 3.4l-4.8 4.8', 'M12 3.4V15'],
  },
  // 计划复诊（日历）
  calendar: {
    paths: [
      'M8 3.2v3.6',
      'M16 3.2v3.6',
      'M5.2 6.4h13.6a1.6 1.6 0 0 1 1.6 1.6v11.2a1.6 1.6 0 0 1-1.6 1.6H5.2a1.6 1.6 0 0 1-1.6-1.6V8a1.6 1.6 0 0 1 1.6-1.6z',
      'M3.6 10.6h16.8',
    ],
  },
  // 播放（内容推荐）
  play: { paths: ['M9.2 6.4 18.6 12l-9.4 5.6z'] },
  // 返回（子页面导航栏）
  back: { paths: ['M14.8 5.2 8.4 12l6.4 6.8'] },
  // 定位（查找附近医院）
  location: {
    paths: ['M12 21.2s6.6-6 6.6-10.8a6.6 6.6 0 1 0-13.2 0C5.4 15.2 12 21.2 12 21.2z'],
    circles: [{ cx: 12, cy: 10.2, r: 2.5 }],
  },
  // 文档（就诊交接摘要 / 报告）
  file: {
    paths: [
      'M14 3.6H7.4a1.6 1.6 0 0 0-1.6 1.6v13.6a1.6 1.6 0 0 0 1.6 1.6h9.2a1.6 1.6 0 0 0 1.6-1.6V8.4z',
      'M14 3.6v4.8h4.2',
      'M8.8 12.6h6.4',
      'M8.8 15.8h4.4',
    ],
  },
  // 报告术语（文档 + 放大镜）
  report: {
    paths: [
      'M14 3.6H7.4a1.6 1.6 0 0 0-1.6 1.6v13.6a1.6 1.6 0 0 0 1.6 1.6h5.4',
      'M14 3.6v4.8h4.2',
      'M8.8 12.6h4',
      'M8.8 15.8h2.6',
      'M15.4 16.6a3.4 3.4 0 1 0 2.4 5.8 3.4 3.4 0 0 0-2.4-5.8z',
      'M17.9 19.1l2.3 2.3',
    ],
  },
  // 病程变化（脉搏波形）
  pulse: { paths: ['M3.2 12.4h3.4l2-5.2 2.8 10.4 2.4-5.2h6.2'] },
  // 生活影响（心形）
  heart: {
    paths: [
      'M12 20.2S4.2 15.4 4.2 9.8A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.8 2.6c0 5.6-7.8 10.4-7.8 10.4z',
    ],
  },
  // 更多（三点）
  ellipsis: {
    circles: [
      { cx: 5.4, cy: 12, r: 1.5 },
      { cx: 12, cy: 12, r: 1.5 },
      { cx: 18.6, cy: 12, r: 1.5 },
    ],
    paths: [],
  },
  // 发送（纸飞机）
  send: {
    paths: ['M20.4 3.6 2.9 9.9l6.3 2.4 2.4 6.3z', 'M20.4 3.6 9.2 12.3'],
  },
  // 筛选（漏斗）
  filter: { paths: ['M4 5.4h16l-6.2 7.2v5.2l-3.6 2v-7.2z'] },
  // 新增（加号）
  plus: { paths: ['M12 4.8v14.4', 'M4.8 12h14.4'] },
  // 搜索（放大镜）
  search: {
    paths: ['M10.8 17.6a6.8 6.8 0 1 0 0-13.6 6.8 6.8 0 0 0 0 13.6z', 'M15.6 15.6 20.4 20.4'],
  },
}

const props = withDefaults(
  defineProps<{
    /** 图标名称 */
    name: IconName
    /** 尺寸（px），默认 24 */
    size?: number | string
    /** 颜色，默认 currentColor（随文字色） */
    color?: string
  }>(),
  { size: 24, color: 'currentColor' },
)

const shape = computed<IconShape>(() => ICONS[props.name])
</script>

<template>
  <svg
    class="app-icon"
    :viewBox="`0 0 ${VIEW_BOX} ${VIEW_BOX}`"
    :width="size"
    :height="size"
    :style="{ color }"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <path v-for="(d, i) in shape.paths" :key="`p${i}`" :d="d" />
    <circle v-for="(c, i) in shape.circles || []" :key="`c${i}`" :cx="c.cx" :cy="c.cy" :r="c.r" />
  </svg>
</template>

<style lang="scss">
/* 图标不独占基线，随父级文字排布 */
.app-icon {
  display: inline-block;
  flex: none;
  vertical-align: middle;
}
</style>
