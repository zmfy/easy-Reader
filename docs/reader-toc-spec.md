# 任务：给阅读器加“目录”面板（参考起点阅读页）

前置：先按 reader-style-spec.md 做完阅读页样式。下面说明点击“目录”后弹出的面板。所有颜色复用那份规范里的 CSS 变量，并补充下面这些：

```css
:root {
  --toc-bg: #EBFAEB;                 /* 面板底色（护眼绿主题，比纸张略亮） */
  --toc-shadow: 0 2px 16px rgba(0,0,0,.16);
  --accent: #E5353E;                 /* 当前章节、VIP 标签 */
  --accent-weak: #FFE6E7;            /* VIP 标签底色 */
  --hover-bg: rgba(0,0,0,.04);       /* hover-4 */
  --active-bg: rgba(0,0,0,.08);      /* active-8 */
  --text-2: rgba(0,0,0,.7);
}
```

## 0. 更正上一份规范：右侧工具栏
主要工具栏在纸张**右**外侧（左侧只有“反馈/指南/举报/旧版”这几个竖排小字链接）。
- 竖排按钮，每个按钮 64×64，`border-radius:8px`，背景 `--toc-bg` 加噪点纹理，`box-shadow: var(--toc-shadow)`，按钮间距约 8px，整栏垂直居中、`position:fixed`。
- 按钮内容：上面一个 24px 线性图标，下面一行 14px 文字（`rgba(0,0,0,.48)`，`margin-top:2px`）；hover 时文字变 `--accent`。
- 按钮依次为：目录、书详情、加书架、投票、夜间、设置、客户端（没有的功能可以不做）。

## 1. 面板容器与开关
- 外层容器 `position:fixed; top:0; bottom:0; left:50%; z-index:4`。面板本体 `position:absolute; height:100%; transform:translateX(-50%)`，**宽度和阅读纸张一样（1280px，跟随阅读宽度设置）**，整块正好盖住正文区，两侧外围底色仍然露出来。
- 面板 `display:flex; flex-direction:column`，背景 `--toc-bg`，阴影 `--toc-shadow`，无圆角，不加遮罩层。
- 开关：点“目录”切换显示/隐藏。点面板外区域或按 Esc 关闭，点了某章后跳转并关闭。打开时自动把当前章节滚到可视区域。可以加一个淡入或轻微位移的过渡（参考页过渡不明显，150–200ms 就够）。
- 移动端（<640px）：面板改成全屏宽度。

## 2. 头部（固定、不随列表滚动）
- 容器 `margin-top:36px; padding:0 32px 0 22px; display:flex; align-items:flex-end`。
- 左边是两个 Tab：**目录** | **书签**。字号 24px、行高 32px，按钮 `padding:6px 10px; border-radius:8px`，hover 背景 `--hover-bg`，active 背景 `--active-bg`。当前 Tab 用 `font-weight:500`、`rgba(0,0,0,.9)`；另一个 400、`--text-2`，两者间距 18px。
- “目录”Tab 后面跟一段状态文字，如“连载中 · 共221章”：14px，`font-weight:500`，`rgba(0,0,0,.48)`，`margin-left:8px`。
- 右边（`margin-left:auto`）放操作：“批量订阅”（购物车图标 + 14px 文字）、“倒序”切换。没有订阅功能就只保留“倒序”。

## 3. 列表滚动区
- `margin-top:24px; padding:0 16px 32px; flex:1; overflow:auto; overscroll-behavior:contain`。
- 自定义一个细滚动条（`.reader-scrollbar`：宽约 6px，滑块 `rgba(0,0,0,.16)`，圆角，轨道透明）。

## 4. 分卷标题条
- 每卷一条，高 48px，`padding:11px 16px; border-radius:8px; background:rgba(0,0,0,.08)`。
- 18px，`font-weight:500`，`rgba(0,0,0,.9)`，`display:flex; justify-content:space-between; align-items:center`，超长截断。
- 左边：卷名，后面可以跟一个标签（“免费”，或 VIP 标签：`font-size:12px; font-weight:500; padding:3px 5px; border-radius:6px; color:--accent; background:--accent-weak; margin-left:6px`）。
- 右边：可选的操作文字（如“订阅本卷”，14px、500）。
- 点标题条可以折叠/展开本卷，列表高度过渡 `transition: height .4s`。
- hover 用 `--hover-bg` 叠加，active 背景加深到 10%。

## 5. 章节列表
- 每卷一个 `ul`：`margin:8px 0 20px; overflow:hidden`。
- **两列布局**：`li { width:50%; display:inline-block; vertical-align:bottom; position:relative }`（用 grid 两列也行）。移动端改成单列。
- 每个 `li` 底部一条分隔线：`::after { content:''; position:absolute; left:16px; right:16px; bottom:0; height:1px; background:rgba(0,0,0,.08) }`。
- 链接 `a`：`display:flex; justify-content:space-between; align-items:center; padding:12px 16px; border-radius:8px`，16px / 行高 24px，`rgba(0,0,0,.9)`，标题单行截断（`truncate`）。hover 背景 `--hover-bg`（截图里 hover 那一行是浅灰绿色的圆角块），active 背景 `--active-bg`。
- **当前章节**：标题颜色 `--accent`。
- **锁定/VIP 章节**：标题用 `rgba(0,0,0,.48)`，右侧放一个 16px 的锁图标（颜色同上）。

## 6. 书签 Tab
- 列表样式和章节列表一样，显示已加书签的章节。为空时居中显示一行灰字提示。

## 7. 夜间模式（可选）
- 给 `--toc-bg`、分隔线、hover 背景这几个变量各准备一套深色值，跟着阅读器主题一起切换。

## 验收
- 1440 宽：面板正好盖住正文区，两列章节对齐，分隔线两端各内缩 16px。
- 375 宽：全屏、单列、没有横向滚动。
- 打开面板时当前章节可见并标红。
