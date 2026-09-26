# T50 反馈举报、我的与服务回退

阶段：S5 android
状态：已完成（v0.55，2026-09-27）
设计稿：`docs/design/app/A16.png`、`docs/design/app/A17.png`、`docs/design/app/A18.png`

## 要做什么
用原生 Android 实现 A16、A17、A18，数据来自 server 接口，行为与 uni-app App 端一致。为 A01–A18 各页面编写 Roborazzi 截图测试（Robolectric + Compose，用演示数据渲染），运行 `gradlew.bat recordRoborazziDebug` 把截图输出到 `android/screenshots/` 并提交；`android/README.md` 写明构建、安装、`adb reverse`、deep link 与截图测试的用法。

## 完成标准
- 页面布局、颜色、字号、间距、图标、文案与设计稿一致
- 数据来自 server 接口，不写死在页面里
- `./gradlew assembleDebug` 通过，相关测试全部通过
