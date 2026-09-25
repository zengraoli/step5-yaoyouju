import { defineConfig } from 'vite'
import uni from '@dcloudio/vite-plugin-uni'

// https://vitejs.dev/config/
export default defineConfig({
  server: {
    // 端口约定见 AGENTS.md「本机运行约定」：app（H5）固定 5201
    port: 5201,
    // 端口被占用时直接失败，避免顺延占用 web(5202) 等其他项目端口
    strictPort: true,
    // 允许通过 127.0.0.1 / 本机 IP 访问（真机调试需要）
    host: true,
  },
  plugins: [
    uni(),
  ],
})
