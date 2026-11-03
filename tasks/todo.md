# 代码优化 — P0 修复

- [x] 1. JWT 区分 access/refresh（`type` claim），authMiddleware 以 DB 为准校验用户存在与角色，refresh 时校验用户
- [x] 2. `GET /api/settings` 加 adminMiddleware，并过滤掉 `reader_prefs_*`
- [x] 3. 删除用户时的"不能删除自己"校验改用 `req.user.userId`
- [x] 4. 移除封面抓取的调试 JSON 写入（会被 `/covers` 公开访问）
- [x] 5.（更正：章节模式已有实现，仅修复瀑布流模式） 实现阅读器 `jumpToBookmark`（章节模式 + 瀑布流模式，瀑布流书签存章节内相对位置）
- [x] 6. ai-manager 注册 qwen / openai / claude / ollama 插件
- [x] 验证：后端 `tsc` 编译、前端 `vue-tsc`、启动后端用 curl 验证鉴权行为

# 更新说明改版

- [x] 更新说明改为数据驱动，按「修改时间：标题」分组，点击标题展开/收起，最多显示最近 5 次，默认展开最新一次
- [x] 写入 2026-11-03 本次 P0 修复内容；开发计划移除已完成的"瀑布流书签定位"
- [x] 修复未定义的 `--border-color` 变量（改用 `--card-border`），标签统一宽度
- [x] 验证：vue-tsc 通过；浏览器实测展开/收起、截图确认样式

# P1 修复（合并 origin/main 后重新核对）

- [x] #7 扫描卡顿 — 远端已重写为扫描任务 + 并发保护，跳过
- [x] #8 AI 填充读整个 TXT：parser-txt 导出 `readTxtPreview`（只读开头、按检测编码解码），library.ts / ai-batch-fill.ts 共用
- [x] #9 插件缓存：加 LRU 上限 + 同书并发加载去重
- [x] #10 原生 PDF 模式 `/chapters` 跳过 pdf-parse 全量解析
- [x] #11 无章节 TXT 分段边界对齐到行首，避免截断多字节字符
- [x] #12 扫描清理已删除文件、删除用户时同步清理 shelf / progress / bookmarks / reader_prefs
- [x] #13 邀请码改用 crypto 生成（注册并发抢用不成立：处理函数全同步，未加事务）
- [x] #14 reader-prefs 校验：必须是对象、限制大小
- [x] 验证：新增单测（#8 #9 #11 #13），jest 全绿、tsc、开发服务实测
- [x] 更新说明 11-03 补充本轮 P1 条目

# P2 修复

- [x] #15 Element Plus 按需引入（unplugin-vue-components），去掉全局注册全部图标；首屏 JS 1186KB → 160KB（gzip 382 → 61KB）
- [x] #17 瀑布流滚动 rAF 节流；最多保留 8 章 DOM，移除顶部章节时按锚点补偿滚动（逐帧验证无可见跳动）
- [x] #18 TXT/PDF/UMD 段落 HTML 转义；指纹计算还原转义；FINGERPRINT_VERSION 1→2（同时覆盖 P1 #11 分段变化），旧数据回填改为 legacy v1
- [x] #19 移除未使用依赖 multer / node-fetch / winston / @types/multer
- [x] #21 README / CLAUDE.md 令牌有效期改为 2h；CLAUDE.md 修正 AI 插件注册说明
- [x] #16 章节模式记住章内位置 — 用户确认要做（见下方 #16 小节）
- [x] #22 默认管理员密码 admin123 — 用户决定保持现状，不修改
- [x] #20 测试 — 已补至 23 suites / 179 tests，跳过
- [x] 验证：jest 全绿、前后端 tsc、Chrome 遍历全部路由无组件解析警告、瀑布流 8 章上限与无跳动

# #16 章节模式记住章内阅读位置

- [x] 后端：reading_progress 新增 paragraph_index / paragraph_offset；进度接口读写锚点
- [x] 前端保存：按「段落序号 + 段内比例」锚点保存；延迟保存绑定章节号、加载/恢复中忽略滚动；切后台/关闭页面立即保存
- [x] 前端恢复：等字体加载后定位，3 秒内随内容尺寸变化重定位，用户主动滚动即停止
- [x] 验证：Chrome 实测 中途退出恢复 / 改字号后恢复 / 切章后恢复到新章首 / 关闭标签页后恢复
