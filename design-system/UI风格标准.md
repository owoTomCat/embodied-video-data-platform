# VD 数据智能 · 前端 UI 风格标准（精炼紧凑版 · GitHub 同步版）

> 编码代号：`ui-compact-v1`
> 适用：AutoConnect / 具身视频数据平台的运营端界面（管理员 / 团长 / 数采）以及登录页。
> 说明：本文件是**随仓库同步到 GitHub** 的风格标准（位于 `design-system/`）。`docs/` 目录被 `.gitignore` 忽略、**不参与同步**；本目录为唯一可同步的风格规范源。

配套参考：仓库内 `web/app/globals.css` 的 `:root` 令牌（本文件即其依据）、示例演示页见历史 `docs/page-exam/index.html`（仅本地，不同步）。

---

## 1. 设计目标：紧凑 · 高效 · 精炼

在保留品牌语言（蓝色主色 `#2563eb`、浅灰画布、白色卡片、彩色状态徽章）的前提下，把界面做得更紧凑、更高信息密度、更高效：

- 正文基准 **13px**，数字用 `font-variant-numeric: tabular-nums` 保证纵向对齐。
- 控件（按钮/输入框）**高 30px**，圆角 6px。
- 表格：表头 36px、行高约 38px、字体 12/13px。
- 布局：侧栏 **208px**、顶栏 **48px**、页面内边距 **16px**、卡片间隙 **12px**。
- 目标：同分辨率下首屏信息量提升 ≥ 25%，操作路径减短 ≥ 15%。

---

## 2. 基础令牌（对齐 `globals.css :root`）

### 2.1 颜色

| 令牌 | 值 | 用途 |
| --- | --- | --- |
| `--blue` | `#2563eb` | 主色（主按钮、选中态、链接） |
| `--blue-dark` | `#1d4ed8` | 主色 hover |
| `--blue-active` | `#1e40af` | 主色按下 |
| `--blue-bg` | `#eff4ff` | 主色浅底（选中行、信息标签） |
| `--blue-border` | `#a9c3ff` | 主色描边 |
| `--ink` | `#1a2333` | 一级文本 |
| `--ink-2` | `#5a6478` | 二级文本 |
| `--ink-3` | `#8a93a6` | 三级/占位/时间戳 |
| `--muted` | `#5a6478` | 次级文本 |
| `--line` | `#e4e8f0` | 常规边框/分隔线 |
| `--line-strong` | `#d2d8e3` | 强调边框/表头下边框 |
| `--surface` | `#ffffff` | 卡片底 |
| `--canvas` | `#f4f6fa` | 页面画布 |
| `--navy` | `#0b1222` | 深色语境（公开站/登录左侧） |

状态语义色（徽章）：成功/警告/危险/信息 沿用 `globals.css` 中的 `.status-success/.status-warning/.status-danger/.status-info/.status-neutral`。

### 2.2 字体

- 字体族：`--font-geist-sans, "PingFang SC", "Microsoft YaHei", sans-serif`。
- 字号阶梯（正文基准 13px）：页面主标题 18px/600 · 卡片标题 14px/600 · 正文 13px/400 · 正文强调 13px/600 · 标签 12px/500 · meta/时间戳 12px · 大数字 20–22px/700。
- 数字列启用 `tabular-nums`。

### 2.3 间距（8px 基准 · 紧凑）

| 令牌 | 值 | 用途 |
| --- | --- | --- |
| `--radius-sm` | 4px | 标签/徽章 |
| `--radius-md` | 6px | 按钮/输入/下拉 |
| `--radius-lg` | 8px | 卡片/表格容器 |
| `--radius-xl` | 10px | 弹窗 |

- 页面外边距 16px；卡片内边距 14px（表格卡 0）；卡片间隙 12px；卡内行距 8–10px。

### 2.4 阴影 / 布局尺寸

| 名称 | 值 |
| --- | --- |
| 卡片阴影 `--shadow` | `0 1px 2px rgb(23 35 61/4%), 0 1px 6px rgb(23 35 61/4%)` |
| 浮层阴影 `--shadow-float` | `0 8px 30px rgb(23 35 61/14%)` |
| 侧栏宽 | 208px |
| 顶栏高 | 48px |
| 内容区内边距 | 16px |
| 页面标题 `h1` | 18px |

---

## 3. 组件规范

| 组件 | 关键规格 |
| --- | --- |
| 按钮 `.button` | 高 30px / sm 26px，`padding 0 14px`，圆角 6px，字体 13px/600；主按钮 `linear-gradient(180deg,#2f74f5,#2563eb)` + 轻投影 |
| 图标按钮 `.icon-button` | 32×32，圆角 6px |
| 卡片 `.content-card` | 内边距 14px，圆角 8px，极浅阴影 + 1px 描边 |
| 指标卡 `.metric-card` | 高约 96px，图标 34px，数值 20px/700，副文案 12px |
| 表格 `.data-table` | 表头 8px 内距/36px 高/12px 字体；单元格 10px 内距/13px 字体；行 hover 高亮 |
| 状态徽章 `.status-badge` | `1px 8px`，圆角 4px，12px 字体，语义色三件套 |
| 表单 `.search-field/.modal-form/.review-form` | 高 30–32px，圆角 6px，焦点主色描边 |
| 筛选栏 `.filter-bar` | 内边距 12px 14px，控件可换行 |
| 分页 `.pagination` | 内边距 10px 14px，右对齐，`共 N 条 · 第 x/y 页` |

---

## 4. 落地方式

- 所有令牌在 `web/app/globals.css` 的 `:root` 中声明，一处修改、全局生效；组件类复用这些令牌与上面的尺寸。
- 若用 Tailwind，可将上述 `--blue/*` 等映射到 `@theme` 变量；本仓库当前为自定义 CSS 类体系，直接引用 `:root` 变量即可。
- 可访问性：正文/数字对白底对比度 ≥ 4.5:1；焦点态统一 `:focus-visible` 主色描边；交互动效 ≤ 160ms。

---

## 5. 变更记录

| 版本 | 日期 | 变更 |
| --- | --- | --- |
| `ui-compact-v1` | 2026-09 | 首个同步版风格标准；落地到 `globals.css` 令牌与共享组件/布局尺寸 |
