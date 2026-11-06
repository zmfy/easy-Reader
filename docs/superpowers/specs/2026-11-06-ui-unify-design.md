# 全站界面风格统一（设计）

## 为什么做

用户觉得「系统设置」页和系统风格不搭，并要求全站统一。盘点（11-06，靛青主题、1440 宽逐页截图 + 代码对照）结论：全站并存四套写法——
- A 靛青新规范：侧栏、阅读器、修改密码、铃铛、学习总结入口页；
- B 旧暗夜写法：书库、书架、书籍详情、设置、登录/注册、BookCard/SeriesCard（写死 `rgba(124,92,255,…)` 共 37 处 / 9 个文件、`rgba(0,212,184,…)` 青色，卡片无阴影，EP 图标）；
- C 无框架管理页：扫描批次 / 批次审核 / 问题书籍 / 手动修正 / 审计日志 / 系列详情（h1 走浏览器默认 32px/700，表格无卡片，`← 返回` 字符）；
- D 学习版全屏页：学习总结、学习导图（用 `--el-*` 变量，不随主题）。
另外 Element Plus 整体未接入主题：控件字体是 Arial、圆角 4px、`el-select` 边框与输入框不同色、alert/tag/dialog 用 EP 默认橙绿；图标 Tabler / EP / emoji 混用。

## 目标

1. 定一套全站样式规则（以靛青为基准、所有颜色取主题变量，6 个主题都成立），尽量在 `main.css` 全局实现。
2. 设置页按用户选定的方案 B 重构：顶部分段标签 + 全宽分组白卡片、输入框统一白底细边框、说明框主题色淡底、保存按钮在卡片底部右侧、去掉重复标题。
3. 其余页面按规则逐页对齐，消除写死颜色、统一页头 / 卡片 / 按钮 / 标签 / 图标。
4. 学习版独有页面在 study 上对齐同一套规则。

## 不做 / 反目标

- 不改任何功能与交互流程（只改样式与结构标记）；不改阅读器的阅读体验（只做小修）。
- 不引入新 UI 库或 CSS 框架；不新增依赖（可选的 stylelint 防回归另议，本期不做）。
- 反目标：统一后某个主题（尤其深色主题）出现看不清 / 白底白字；手机出现横向滚动。

## 全站样式规则（用户待确认）

**新增 / 调整 token（main.css，6 个主题）**：`--radius-lg: 16px`（统一）、`--radius-md: 12px`、`--radius-sm: 8px`、`--accent-soft: color-mix(in srgb, var(--accent) 8%, var(--card-bg))`、`--accent-line: color-mix(in srgb, var(--accent) 22%, var(--card-bg))`、`--success`；未定义的 `--text-3` 引用改为 `--text-2`；`--font-mono`。

| 元素 | 规则 | 实现 |
|---|---|---|
| Element Plus 主题化 | `--el-font-family: var(--font-sans)`；`--el-border-radius-base: 8px`；`--el-component-size: 36px`；success/warning/danger/info 映射到主题变量；table / alert / dialog / card 变量映射主题 | 全局 |
| 页面容器 `.page` | padding 32px；表格类页面 max-width 1200px；≤768px padding 16px | 全局类 + 逐页替换 |
| 页头 `.page-header` / `.page-title` | flex 居中、gap 12、下距 24；标题 24px/600（手机 20px）`--text-0`；每页一个标题、不重复；返回统一为 text 按钮 + Tabler `IconChevronLeft`（可抽 `PageHeader.vue`） | 全局类 / 组件 |
| 分组卡片 `.section-card` | `--card-bg` 底、1px `--card-border`、`--radius-lg`、`--shadow-soft`、padding 20px 24px（手机 16px），卡片间距 16；小标题 15px/600、说明 12–13px `--text-2`；底部操作区 `.section-actions` 右对齐、上边框、主按钮最右、无改动时禁用 | 全局类 |
| 输入框 / 下拉框 / 文本域 | 统一白底（`--input-bg`）+ 1px `--card-border`，hover `--accent-line`、focus `--accent`；高 36px（登录页 40px）；圆角 8；`el-select` 与 `el-input` 同一规则；去掉「填充式」写法与靛青专属规则 | 全局 |
| 按钮 | 圆角 8；页面级 36px，卡片内 / 表格行内 small；登录整宽 40px；主 / 次（描边）/ 危险（danger plain）；同一组不混用两种主色；主按钮 hover 用 color-mix | 全局变量 + 逐页尺寸 |
| 标签 tag | 高 22、圆角 6、12px；主色 = `--accent-soft` 底 accent 字；中性 = `--bg-2` 底；成功 / 警告 = 对应色 12% color-mix | 全局 |
| 说明框 `.note` | `--accent-soft` 底、`--accent-line` 边、`--radius-md`、padding 12 16；警告类用 `--warning` color-mix；不再用青色 accent-2；el-alert 同步覆盖 | 全局 |
| 表单 `.form-grid` | 固定 2 列（手机 1 列），gap 16/20，长字段跨整行；label 13px/500、hint 12px | 全局 |
| 分段标签 `.segmented` | 白底、细边、圆角 10、padding 4；激活项 accent 底白字；手机横向滚动；设置页 tab、问题书籍筛选、学习总结排序、阅读器目录/书签共用 | 全局 |
| 表格 | 外包 `.section-card`（padding 0）；表头 `--bg-2` 底 13px/600；行高 48；hover `--accent-soft` | 全局变量 + 逐页包裹 |
| 空状态 `.empty-state` | 最小高 320；Tabler 图标 48px `--text-2`；标题 16px/500、说明 13px、可带主按钮 | 全局类 |
| 弹窗 | 圆角 `--radius-lg`、padding 24、标题 16px/600、按钮右对齐；不用 emoji | 全局 |
| 图标 | 只用 Tabler（stroke 1.75，14/16/18/20）；不用 emoji / 字符当图标（评分 ★ 可保留，颜色 `--warning`）；CLAUDE.md 同步改为 Tabler | 逐文件 |
| 颜色 | 组件内不写死主题色；例外：封面遮罩、PDF 白纸、主题预览色卡、导图语义配色（后续变量化） | 逐文件 |
| 背景噪点层 | 浅色主题关闭（或透明度降到 0.15），避免白卡发灰 | 全局 |

## 实施顺序

1. main.css 全局规则 + 新 token + 通用类（一个提交，6 个主题截图回归）。
2. 设置页方案 B（含改密码、邀请两个弹窗）。
3. 6 个管理页套页框（表格包卡片、Tabler 返回、问题书籍筛选改分段标签、修 `--text-3`）。
4. BookCard / SeriesCard / 书架：去写死色、常态阴影、tag 语义化。
5. 书籍详情 / 书库收尾（标题、按钮尺寸、「已在书架」改中性、评分色、书库手机 padding、图标）。
6. 登录 / 注册对齐修改密码（去光晕与文字阴影、品牌图标 Tabler、按钮 40px、错误框 `--danger`）。
7. 弹窗去 emoji 与写死色（扫描选项、费用提示、AI 填充预览）。
8. 阅读器小修（返回图标、danger 变量、按钮统一）与侧栏分隔线。
9. CLAUDE.md Design System 一节更新（图标 Tabler、通用类说明）。
10. （study）学习版页面对齐：学习总结 / 学习导图改主题变量、纸张圆角、入口页套通用类、图标 Tabler、导图配色补深色。

## 约束

- 每步在 6 个主题下截图回归（至少靛青、暗夜、素纸），手机 390 宽无横向滚动。
- 前端 `npx vitest run && npx vue-tsc --noEmit && npx vite build` 通过。
- 在 main 实现 1–9，合并进 study 后做 10。

## 盘点明细

逐页问题表与截图见盘点报告（scratchpad/style-audit/，截图 01–42）；实施各步时由主控把对应页面的问题条目带给实现者。
