# 任务：按以下规范重做小说阅读器样式

参考对象：起点中文网章节阅读页（护眼绿主题）。请先找到项目里阅读器组件/样式文件，按下述规范修改，用 CSS 变量实现，便于以后加主题切换。不要改动业务逻辑。

## 1. 配色（护眼绿主题）
```css
:root {
  --reader-page-bg: #C9E0CB;     /* 页面外围背景（body） */
  --reader-paper-bg: #E0EEE1;    /* 正文“纸张”区域背景 */
  --reader-text: rgba(0,0,0,.9); /* 正文 & 标题 */
  --reader-text-secondary: rgba(0,0,0,.48); /* 作者、字数等元信息 */
  --reader-divider: rgba(0,0,0,.08);        /* 章节分隔线 */
}
```
- 纸张区域叠加一层细微噪点纹理（小尺寸 PNG/SVG 平铺，透明度很低），营造纸质感。
- 全屏再叠一层 fixed 的极淡斜纹：`repeating-linear-gradient(45deg, rgba(150,150,150,.02) 5px, transparent 30px, transparent 80px)`，`pointer-events:none`。

## 2. 布局
- 正文容器（纸张）水平居中，桌面宽约 **1280px**（建议做成可配置：宽/中/窄），两侧露出外围背景色。
- 纸张 `min-height:100vh`，无圆角、无阴影。
- 内边距：桌面 `64px 64px`（上/左右），底部留 64px；**移动端（<640px）`56px 20px`，底部 48px**。
- 多章连续阅读时，章节之间用 `border-top:1px solid var(--reader-divider)` 分隔，第一章不加。

## 3. 字体与排版
- 字体栈：`"Source Han Sans SC", "PingFang SC", "Microsoft YaHei", system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`
- 正文：字号默认 **20px**（提供 14–30px 可调，参考页当前设为 30px），`line-height:1.8`，`font-weight:400`。
- 段落：`margin-top:0.8em`（30px 字号时为 24px），段首缩进 2 字（`text-indent:2em`）。
- 正文区距标题块 `margin-top:1.5em`。

## 4. 章节标题区
- 标题 `h1`：居中，36px / 行高 44px，`font-weight:500`，颜色 `--reader-text`，`margin-top:20px`。
- 标题下方元信息行（作者、字数、更新时间等）：14px，颜色 `--reader-text-secondary`，`margin-top:8px`，居中。

## 5. 交互组件
- **顶部导航**：`position:sticky; top:0`，高 64px，背景与纸张一致（同样带噪点）。向下滚动时 `transform:translateY(-100%)` 隐藏，向上滚动时显示，`transition: transform 350ms`。
- **左侧悬浮工具栏**：贴在纸张左外侧的竖向窄条，小图标+竖排小字（如：目录、设置、手机阅读、反馈），颜色用次要文字色，hover 加深。
- （可选）**段评角标**：段落末尾的小气泡图标（`rgba(0,0,0,.32)` 背景，24×16），右上角显示数字；没有段评功能可忽略。

## 6. 验收
- 桌面 1440 宽 & 手机 375 宽各截图检查：两侧露出外围底色、行距舒适、无横向滚动。
- 字号调整后段距随 em 同比缩放。
