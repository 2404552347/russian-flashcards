# PRD: 闪卡 App 架构拆分与 Anthropic 设计系统重构

**状态**: 已完成  
**日期**: 2026-05-29

---

## Problem Statement

当前项目是一个 4564 行的单文件应用 (`index.html`)，CSS、HTML、JavaScript 全部内联。维护困难，无法独立修改样式或逻辑。同时，现有设计系统使用通用绿色 (`#00BC71`) 和冷调暗色模式，缺乏视觉辨识度和品牌一致性。

## Solution

将单体文件拆分为 4 个独立文件，并按照 Anthropic 官方设计系统 (`claude/DESIGN.md`) 完全重写 UI 样式。保持零构建工具、`file://` 双击可用的架构。

## User Stories

1. 作为学习者，我希望卡片有清晰舒适的视觉层次，长时间学习不疲劳
2. 作为开发者，我希望 CSS 独立于 HTML，可以单独修改样式而不触及逻辑
3. 作为开发者，我希望数据层（localStorage/CRUD）与 UI 层分离，便于维护和调试
4. 作为用户，我希望整个应用使用统一的暖色调设计（羊皮纸底色、陶土主色），创造沉浸式学习体验
5. 作为用户，我希望闪卡上的俄语单词使用优雅的衬线字体（PT Serif），提升阅读美感
6. 作为用户，我希望按钮、输入框等交互元素使用环阴影而非传统投影，体现 Anthropic 设计语言
7. 作为用户，我不再需要暗色模式切换——统一的亮色暖调设计已足够舒适
8. 作为用户，我希望界面图标使用 SVG 而非 emoji，与整体设计语言协调
9. 作为用户，我希望现有数据和账户在重构后无缝继续使用
10. 作为用户，我希望应用保持离线可用，无需安装任何服务器或数据库

## Implementation Decisions

### 模块拆分

- **`index.html`** (~310 行): 入口文件，仅包含 HTML body 结构、外部资源引用、CDN 脚本
- **`styles.css`** (~1800 行): 完整 Anthropic 设计系统，包含 CSS 自定义属性、组件样式、动画、响应式
- **`storage.js`** (~175 行): 数据层——账户管理、密码哈希、localStorage CRUD（语言/单词/SRS/文件夹）、数据迁移
- **`app.js`** (~3300 行): UI 层——渲染引擎（闪卡/测验/词汇表/听力/统计）、事件处理、SRS 算法、导入导出、设置

加载顺序: `styles.css` → `storage.js` → `app.js`，通过全局函数通信（无模块系统）。

### 设计系统决策

- **主色调**: 陶土 `#c96442`（认识/掌握），暗化琥珀 `#b0780a`（不确定），深红 `#b53333`（错误/不认识）
- **表面色**: 羊皮纸 `#f5f4ed`（页面背景），象牙 `#faf9f5`（卡片/按钮），纯白 `#ffffff`（高对比元素）
- **字体**: 标题用 PT Serif（Google Fonts，支持 Cyrillic），UI 用 Inter，等宽用系统默认 Consolas
- **阴影系统**: 环阴影 (`0px 0px 0px 1px`) 替代传统 `box-shadow`，符合 Anthropic 设计规范
- **圆角**: 4 级阶梯——6px（内联）、8px（按钮/卡片）、12px（模态）、16px（大容器）+ 全圆（徽章）
- **间距**: 严格 8px 基准体系——3/4/6/8/10/12/16/20/24/30/40/56/80px
- **移除**: 暗色模式全部代码（CSS `html.dark` 规则 + JS `toggleTheme()` 逻辑 + 切换按钮 + `prefers-color-scheme` 监听）

### 架构决策

- **零构建工具**: 保持 `file://` 协议可用，不使用 ES modules、打包器或构建步骤
- **全局函数通信**: `storage.js` 和 `app.js` 通过 `window` 全局变量共享状态，无需重构现有函数签名
- **Google Fonts CDN**: PT Serif + Inter 通过 `@import` 加载，CSS 内置 fallback 链（Georgia / system-ui）
- **SVG 替代 Emoji**: 底部导航、工具栏、设置面板等显式位置使用手写 SVG 图标

### 数据

- 现有 `localStorage` 键名体系不变，账户迁移逻辑保留在 `storage.js`
- `supabase-setup.sql` 保留不动（可选的云数据库升级路径）

## Testing Decisions

### 测试重点

- 数据层函数应测试输入/输出正确性（load/save 循环一致性）
- SRS 间隔重复算法应测试 ease factor 和 interval 计算逻辑

### 验证方式（已执行）

- 文件拆分后结构正确性: `storage.js` 17 个函数，`app.js` 147 个函数，全部提取无误
- 暗色模式代码: 已确认 `app.js` 中无 `dark`、`toggleTheme`、`btn-theme`、`prefers-color-scheme` 残留
- HTML 引用: 确认 `<link>` 和 `<script src>` 路径正确，无双内联代码
- 设计 token: 确认所有 CSS 变量与 DESIGN.md 规范一致

### 待验证（手动）

1. 浏览器打开 `index.html`，验证登录/注册/语言管理/闪卡/测验/词汇表/听力/统计/导入导出/设置全流程
2. 手机端响应式适配（Chrome DevTools 模拟）
3. localStorage 旧数据兼容性

## Out of Scope

- 引入构建工具（Vite/webpack）
- ES Modules 模块化
- 后端数据库（Supabase/MySQL）集成
- 添加新功能或修改现有功能逻辑
- 暗色模式（已移除）
- 单元测试/自动化测试框架搭建

## Further Notes

- `claude/DESIGN.md` 是本次重构的设计依据，描述的是 Anthropic 营销网站的设计语言，已适配为本工具的 UI 语言
- 项目当前无远程仓库，后续可以初始化 git 并推送
- Google Fonts CDN 在国内可能被墙，PT Serif fallback 到 Georgia，Inter fallback 到 system-ui
