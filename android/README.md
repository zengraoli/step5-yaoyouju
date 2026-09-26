# 腰有据 · 原生 Android 客户端

Kotlin 2.x + Jetpack Compose（Material 3）+ Navigation Compose + Retrofit/OkHttp +
kotlinx.serialization + DataStore。单 Activity。功能与设计同 uni-app App 端
（设计稿 `docs/design/app/A01`–`A18`，设计宽度 375）。

## 环境要求

- JDK 21
- Android SDK：platforms android-35、build-tools 35.0.0（`ANDROID_HOME` 指向本机 SDK）
- Gradle 8.9（`./gradlew` 自动下载）

## 构建

```bash
cd android
./gradlew assembleDebug        # Windows: gradlew.bat assembleDebug
```

产物：`app/build/outputs/apk/debug/app-debug.apk`。

## 安装与真机调试

```bash
# 安装
adb install -r app/build/outputs/apk/debug/app-debug.apk

# 真机访问本机 server：USB 连接后执行一次
adb reverse tcp:3200 tcp:3200

# 之后 App 内默认基地址 http://127.0.0.1:3200 即可访问电脑上的 server
```

server 启动方式见 `server/README.md`（`npm run dev`，端口 3200）。

## Deep link（测试时直接打开页面）

```bash
adb shell am start -a android.intent.action.VIEW -d "yaoyouju://A07"
```

支持的编号（对应设计稿）：

| 编号 | 页面 | 编号 | 页面 |
|-|-|-|-|-|
| A01 | 登录与授权 | A10 | 病程时间线 |
| A02 | 当前关键变化确认 | A11 | 记录今天 |
| A03 | 就医提示 | A12 | 复诊摘要 |
| A04 | 选择主要困惑 | A13 | 审核内容库 |
| A05 | 录入报告与医嘱 | A15 | 视频详情 |
| A06 | 核对结构化信息 | A16 | 反馈与举报 |
| A07 | 一页理性分析 | A17 | 我的 |
| A08 | 原文对照 | A18 | 服务不可用回退 |
| A09 | 问与解释 | | |

## 网络与安全配置

- 接口基地址写在 `BuildConfig.API_BASE_URL`（默认 `http://127.0.0.1:3200`，
  `app/build.gradle.kts` 中修改）；
- 明文 HTTP 白名单仅放开 `127.0.0.1` / `10.0.0.2` / `localhost`
  （`res/xml/network_security_config.xml`），生产必须改 HTTPS；
- 登录令牌存 DataStore（`core/datastore/TokenStore.kt`），不写入账号口令；
- 日志拦截器已脱敏 Authorization 头。

## 目录结构

```
app/src/main/java/com/yaoyouju/android/
├── MainActivity.kt            单 Activity（deep link 入口）
├── YyjApplication.kt          Application（DataStore 初始化）
├── core/
│   ├── net/                   Retrofit 接口、统一响应解析、错误模型
│   ├── datastore/             令牌与基地址持久化
│   └── deepLink/              yaoyouju://<编号> → 路由映射
└── ui/
    ├── theme/                 Material 3 主题（色彩令牌 / 字体 / 圆角）
    ├── components/            按钮 / 芯片 / 状态标签 / 提示条 / 卡片 / 底部导航
    ├── navigation/            路由表与 NavHost
    └── screens/               各页面（T43 阶段为占位，T44–T50 逐页实现）
```

## 测试

```bash
./gradlew testDebugUnitTest    # 单元测试（deep link 映射、响应解析、页面逻辑）
```

截图测试（Roborazzi）：

```bash
# 录制 / 更新截图（输出到 android/screenshots/）
gradlew.bat recordRoborazziDebug

# 校验截图（不重新录制，仅与已提交截图比对）
gradlew.bat verifyRoborazziDebug
```

覆盖 A01–A18 全部页面（`ScreenShotsTest`，Robolectric + Compose）。
数据来自 server 接口的页面在无网络环境下渲染空态 / 加载态 / 静态兜底内容。

## 已知问题

- 大模型 / OCR 均为 server 侧模拟实现，客户端不调用任何外部服务；
- 数据来自 server 接口的页面，在无网络截图测试中渲染空态 / 加载态；
- 真机调试依赖 `adb reverse`，模拟器可直接访问 127.0.0.1。
