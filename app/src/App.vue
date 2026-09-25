<script setup lang="ts">
import { onLaunch, onShow } from '@dcloudio/uni-app'
import { useAuthStore } from './stores/auth'

// 启动：从本地存储恢复登录态（token 持久化在 uni.storage）
onLaunch(() => {
  useAuthStore().restore()
})

// 回到前台：已登录则静默刷新用户信息与同意记录（失败不打断使用）
onShow(() => {
  useAuthStore().refreshIfLoggedIn()
})
</script>

<style lang="scss">
/* 全局基础样式：页面背景 / 字体栈 / 正文行高 / 页面容器 */
@import './theme/global.scss';
</style>
