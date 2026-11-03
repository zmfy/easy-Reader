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

# 二次审查 · 高优先级第一批

- [x] 问题书籍页「仅删书库记录」实际删除磁盘文件 → 后端 DELETE 新增 keep_file（file-deleter keepFiles，审计 delete_book_record）；前端抽出 useBookDelete 共用 409 处理，移除契约不符的 libraryApi.remove
- [x] 子目录读取失败导致误删书籍及用户数据 → collectFiles 返回 unreadableDirs，findOrphanBookIds 跳过其下书籍
- [x] 扫描审核「修改后再接受」清空修改 → PATCH 未带 payload 时 COALESCE 保留 admin_payload
- [x] 验证：新增 6 个测试（25 suites / 185 tests）、tsc、API 实测、Chrome 实测问题书籍页

# 二次审查 · 高优先级第二批

- [x] #4 编码修复：原子写入（临时文件 + rename），改写后用新的 size/mtime 入库
- [x] #5 任意文件登记/读取：批次入库与 /raw 读取校验路径位于 BOOKS_DIR 内
- [x] #6 改密码/登出后旧令牌失效：users.token_version，令牌携带版本号
- [x] 依赖：仅做兼容升级（npm audit fix，不含破坏性大版本）
- [x] 验证：单测 + tsc + 开发服务实测

# 二次审查 · 小而明显的问题

- [x] 时间显示差 8 小时 / Safari NaN → frontend utils/time.ts（SQLite UTC 字符串按 UTC 解析），替换 8 处显示；新增首个前端单测
- [x] 扫描不导入 UMD → scan-walker SUPPORTED_FORMATS 补 umd（历史无有意排除记录），新增测试
- [x] Docker 健康检查 → 更正：合并后 docker-compose 已改用 node fetch，实测退出码 0，无需修改（此前判断基于合并前旧配置）
- [x] 安全审查补充：findReadableBook 返回校验后的真实路径，后续读取不再跟随原路径

# 二次审查 · 前端竞态与体验

- [x] 章节模式慢网快速切章：useReader.loadChapter 请求序号，过期结果丢弃，调用方据返回值跳过保存/滚动
- [x] 瀑布流后台加载时跳章：waterfallGeneration + resetWaterfall，过期请求丢弃并释放加载锁
- [x] 刷新失败误踢登录：isAuthRejection 仅 401 / 无 refresh token 时退出；临时故障保留会话，定时续期 60s 后重试；新增 4 个单测
- [x] 书库切换分类回第 1 页；fetchBooks 请求序号防乱序
- [x] 验证：vitest 7 passed、vue-tsc；Chrome 中拦截 XHR 人为延迟旧请求，三处竞态均显示正确章节

# 二次审查 · 中优先级（数据一致性）与小项

- [x] 重复书内容变化后残留 duplicate_of → upsertBookByPath 同时清空 duplicate_of（重复组阶段在其后会重新标记）
- [x] 原书文件删除后重复书永久隐藏 → removeOrphanBooks 提升指向被删书的重复书为普通书；分批 500 防 SQLite 参数上限（测 4 万条）
- [x] AI 统一章节标题先删后调 → 先收集再单事务写入，只替换成功批次的范围；INSERT OR REPLACE 防并发主键冲突
- [x] books.file_path 索引；邀请邮件 HTML 转义 + 链接仅 http(s)；API Key 掩码判断统一
- [x] 验证：28 suites / 203 tests、tsc、查询计划走索引、接口实测

# 低优先级第 5 组

- [x] 普通用户不返回书籍 file_path（书库列表 / 详情 / 系列）
- [x] 错误信息不回显内部路径与底层异常
- [x] 进度、书签写入前校验书籍存在
- [x] 手机端布局：书库搜索栏不溢出；阅读器窄屏加宽正文
- [x] 验证：测试 + tsc + Chrome 手机视口实测

# 后端依赖大版本升级

- [x] uuid：仅用 v4 → 改用 Node 内置 crypto.randomUUID，移除 uuid / @types/uuid（13 个文件，调用点不变）
- [x] zod 3 → 4：z.record 补 key 类型（2 处）、ZodError.errors → issues（1 处）；核对 default / pipe / catch 等 v4 语义变化不受影响
- [x] nodemailer 6 → 10：逐个核对 7/8/9/10 的 BREAKING（SES、错误码改名、远程内容 TLS 校验、Node 20+）均不涉及；@types/nodemailer → 8
- [x] 验证：28 suites / 203 tests、生产构建、18 项接口校验实测、本地调试 SMTP 实际收发邀请邮件并核对转义
- [ ] 剩余：adm-zip / epub2 暂无修复版本
