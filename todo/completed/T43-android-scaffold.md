# T43 Android 项目骨架与通用组件

阶段：S5 android
状态：已完成（v0.48，2026-09-27）

## 要做什么
在仓库根目录新建 `android/` 原生项目，实现与 uni-app App 端同样的功能（设计稿即 `docs/design/app/` 下的 App 端设计，设计宽度 375）。技术栈：Kotlin 2.x + Jetpack Compose（Material 3）+ Navigation Compose + Retrofit/OkHttp + kotlinx.serialization + DataStore；Gradle Kotlin DSL 与版本目录；minSdk 26，targetSdk 35；单 Activity。按 `docs/design/README.md` 的设计规范写 Material 3 主题；通用组件：四种按钮、芯片、状态标签、三种提示条、卡片、底部导航（当前情况 / 问与解释 / 病程 / 复诊准备 / 我的）；就医提示入口全局可达；网络层解析统一响应格式。接口基地址写在 BuildConfig 中，默认 `http://127.0.0.1:3200`，真机调试时通过 `adb reverse tcp:3200 tcp:3200` 访问本机 server；为 127.0.0.1 与 10.0.2.2 配置明文 HTTP 白名单（network security config）。支持 deep link `yaoyouju://<页面编号>`（如 yaoyouju://A07），方便测试时直接打开对应页面。

## 完成标准
- `./gradlew assembleDebug` 通过（Windows 下为 `gradlew.bat assembleDebug`）
- deep link 可打开对应页面
- `./gradlew assembleDebug` 通过，相关测试全部通过
