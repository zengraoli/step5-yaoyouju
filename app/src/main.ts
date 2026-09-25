import { createSSRApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
// CSS 自定义属性（主题令牌），供内联 style / 运行时使用
import './theme/tokens.css'

export function createApp() {
  const app = createSSRApp(App)
  // 登录态等全局状态（Pinia）
  app.use(createPinia())
  return {
    app,
  }
}
