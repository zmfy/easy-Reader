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
- [x] adm-zip 0.6.1 已修复（≤0.6.0 的 8 个 high 漏洞）；epub2 3.0.2 仍锁 ^0.5.10 → backend package.json 加 overrides 强制 ^0.6.1
  - 核对 epub2 用到的 API（构造、getEntries、getEntry、readFileAsync 回调 (data, err)）在 0.6.1 中签名不变
  - 验证：书库 34 本 EPUB 升级前后章节列表 / 全部章节内容 / 全部资源哈希完全一致；28 suites / 213 tests、tsc；npm audit --omit=dev 0 漏洞
  - 剩余开发依赖 23 个 low/moderate（jest 链路 minimatch 等），不进生产镜像，未处理

# 审核模式反复产生待审核批次

- [x] 根因：①重复组「✗ 非重复，加入书库」不记录任何判定，指纹不变下次原样重组；②剔除成员只记与当前正本的关系；③已标记乱码的书每次重新检测仍为乱码时重复提交审核
- [x] batch-applier：整组拒绝记录组内两两 not_duplicate；剔除成员与所有保留成员记录；已有规则不重复写入
- [x] dedup-grouper：applyNotDuplicateOverrides 过滤已判定不重复的成员；scan-walker 生成重复组后调用
- [x] scan-walker：已标记 garbled 的文件仍为乱码时不再生成审核项（救回路径不变，全量重扫同样适用）
- [x] 验证：新增 6 个单测（28 suites / 209 tests）；端到端脚本对比旧代码（每次扫描都生成重复组×1 乱码×1）与新代码（不再生成批次），并验证救回与新副本仍能正确识别

# TXT 首个章节标题之前的内容

- [x] 方案：阅读时把首个标题之前的可见文字并入第 0 章；章节列表与序号不变；指纹改用 getChapterContentForFingerprint（从标题开始），保持不变、无需重扫
- [x] 验证：新增 4 个单测（28 suites / 213 tests）；真实书库 6 本 TXT 新旧代码指纹与章节数全部一致、文件未改动；4 本书第 0 章补回前言；接口实测
- [ ] 备注：前言常含盗版站广告（原文件内容），如需过滤可另做

# 漫画 EPUB 封面空白

- [x] 根因：rewriteEpubAssetUrls 只改写 `<img src>`，SVG 封面 `<image xlink:href="../Images/...">` 保持相对路径，浏览器请求到 SPA 的 index.html
- [x] 改写函数移到 utils/epub-asset-url.ts（便于单测），新增 `<image xlink:href / href>` 与单引号属性；绝对 / data: / # 地址不动
- [x] 验证：新增 4 个单测（29 suites / 217 tests）、tsc；全书库 25,333 章新旧对比，仅 132 章的 139 处 `<image>` 变化且均指向 EPUB 内存在的资源；Chrome 柯南第 1 页封面正常显示

# PDF 插件模式文字质量

- [x] 检查：原生模式（默认，浏览器内置查看器）正常；插件模式文字重复 4 遍、中文字间多空格、整页不分段
- [x] 根因：pdf.js 文本项直接 join(' ')；假粗体同一文本在 ±1pt 内绘制多次（且可能隔整行才重绘）；没有换行，按 \n 分段失效
- [x] parser-pdf.ts 新增 buildPageText：整页按文字+位置去重；按基线分行、按坐标拼接（间隙 > 0.1 倍字号才加空格，CJK 不加）；行距放大 / 上行未写满 / 缩进 / 字号变化时分段
- [x] 验证：新增 8 个单测（30 suites / 225 tests）、tsc；真实 PDF 195 页无空页，1522 段中页内误断约 39 处（多因原文破折号/省略号非文字）；Chrome 插件模式显示正常
- [ ] 已知残留：封面大标题的假粗体副本被切成不同片段时无法去重（全书仅 1 处）；页眉页脚广告为原文内容，未过滤
- 指纹（size + 头部 sha1）不依赖提取文字，无需重扫

# PDF 插件模式改为按原版逐页渲染（pdf.js）

- [x] 前端引入 pdfjs-dist@6.4.299（legacy 构建，兼容较旧手机浏览器）
- [x] vite 内联插件：开发时提供、构建时复制 cmaps / standard_fonts / wasm 到 /pdfjs/
- [x] utils/pdf.ts：加载文档（worker、cMap、字体、wasm 地址）
- [x] components/PdfPage.vue：按容器宽度 × devicePixelRatio 渲染 canvas，宽度变化重绘，切页取消旧渲染，先占位防跳动
- [x] Reader.vue：插件模式下章节翻页 / 瀑布流用 PdfPage 代替文字；按钮显示「上一页 / 下一页」；进度、书签、目录沿用
- [x] 设置页文案更新、更新日志；pdf.js 改为打开 PDF 时按需加载（阅读页 JS 592KB → 51KB）
- [x] 验证：typecheck、vitest、build（dist 含 pdfjs 资源）；Chrome 电脑 + 手机视口：封面图片、翻页、瀑布流、进度恢复、书签
  - 结果：vue-tsc、vitest 7 passed、build 含 200 个 pdfjs 资源；开发与生产预览下封面图片 / 原版排版正常，翻页、瀑布流加载与裁剪、刷新后进度恢复（页 + 页内位置）、书签跳转均正常；手机视口 390px 按 2 倍清晰度重绘
- [ ] 备注：本书字体已嵌入，未实际触发 cmaps 加载（资源可访问已确认）；原生模式在安卓手机浏览器中通常无法内嵌显示 PDF，可考虑把逐页显示设为默认

# PDF 默认模式改为逐页显示

- [x] reader.ts / settings.ts：pdf_use_plugin 仅为 'false' 时走浏览器原生，未设置默认逐页显示；已手动关闭的保持原样
- [x] 验证：临时库中 未设置 / 'false' / 'true' 三种状态的 chapters 与 reader-plugins 接口结果正确；Chrome 未设置时直接逐页显示、设置页开关为开；30 suites / 225 tests、tsc
- [ ] 备注：逐页显示仍由后端 pdf-parse 解析全书取得页数（本书 195 页约 0.5 秒），提取出的文字已不再显示；大 PDF 可考虑改为只取页数

# MiniMax AI 填充报错

- [x] 第一次：402 insufficient_balance (1008) —— 按量付费 key 所在账户无余额，与代码无关（新旧域名、新旧模型均同样结果）
- [x] 换为订阅 key（sk-cp-）后：默认模型 MiniMax-M2 返回 404「no longer available (2069)」；MiniMax-M3.1-Flash 正常
- [x] 修复 minmax.ts：默认模型 → MiniMax-M3.1-Flash，接口 → api.minimax.cn（官方文档），提示文字更新，去掉已被忽略的 temperature；新增 2 个单测
- [x] 验证：tests/ai 18 passed、tsc；应用内单本 AI 填充成功；《三国演义》约 11 秒、结果正确
- [ ] 备注：书名与内容矛盾的文件（测试库「理智与情感」实为《凡人修仙传》）耗时 77 秒且结果编造；reasoning_effort=low 可快约 40%，结果相同，未采用
- [ ] 备注：已在设置中手动填写 MiniMax-M2 / M2.x 模型的需改为新模型

# MiniMax 推理强度可在设置页配置

- [x] 实测：MiniMax-M3 收到 reasoning_effort 会忽略不报错；非法值返回 400（允许 low/medium/high/xhigh/max）
- [x] AiPlugin 新增可选 options（固定取值字段）；/settings/ai-plugins 返回 options
- [x] minmax：新增 reasoningEffort 字段与选项（空 = 默认 max，不传）；请求体统一由 requestBody 生成；新增 2 个单测
- [x] 设置页：有 options 的字段显示为下拉框并附说明；下拉字段选「默认」时提交空值以清除；「已测试通过的配置」MiniMax-M2 → M3.1-Flash；更新说明补一条
- [x] 验证：31 suites / 229 tests、前后端 tsc；Chrome 选 low 保存 → 库中为 low、刷新后正确回显、《三国演义》AI 填充 7.2 秒且结果正确 → 切回默认保存 → 库中清空；API Key 始终未被覆盖

# DeepSeek 默认模型改为 deepseek-flash，思考模式可设置

- [x] 实测：key 可用模型为 deepseek-flash / deepseek-v4-pro；deepseek-chat 被映射到 deepseek-flash（不思考）；deepseek-flash 默认开启思考，thinking.type=disabled 可关闭
- [x] deepseek.ts：默认模型 deepseek-flash；新增 thinking 下拉（空 = 关闭并显式传 disabled、保留原 temperature；low/high/max = 开启并设 reasoning_effort、不传 temperature）；请求体统一由 requestBody 生成；新增 5 个单测
- [x] 设置页：字段名「思考模式」与说明；「已测试通过的配置」deepseek-chat → deepseek-flash；更新说明补一条
- [x] 验证：32 suites / 234 tests、前后端 tsc；Chrome 默认关闭时《红楼梦》1.3 秒、开启 low 时《三国演义》4.6 秒，结果均正确；保存 low → 库中 low，切回关闭 → 清空；API Key 未被覆盖

# Ollama 检查与思考模式

- [x] 核对官方文档与源码：/api/chat、stream、options.temperature 仍有效；结果读 message.content，思考在 message.thinking 不混入；docker-compose 已配置 host.docker.internal
- [x] 发现：未传 think 时支持思考的模型默认思考（源码 req.Think==nil → true），明显变慢；think=false 对不支持思考的模型不报错，think=true 返回 400 "does not support thinking"
- [x] ollama.ts：新增 thinking 下拉（默认关闭 → think:false；开启 → think:true）；解析前去掉 <think>…</think>（防旧版本）；模型提示改为 qwen3 / gemma3 / llama3；出错时带上 Ollama 返回的原因；新增 5 个单测，ai-manager 测试断言改为「不含 apiKey」
- [x] 验证：32 suites / 239 tests、前后端 tsc；模拟 Ollama 服务端到端：qwen3 关/开、llama3 开（页面显示「"llama3" does not support thinking」）/ 关，请求 think 参数均正确；测试后开发库设置恢复原样
- [ ] 备注：本机无 Ollama，未调用真实模型

# 单本 AI 填充预览（分支 feature/ai-fill-preview）

- [x] 设计：docs/superpowers/specs/2026-11-04-ai-fill-preview-design.md；计划：docs/superpowers/plans/2026-11-04-ai-fill-preview.md
- [x] Task 1 默认封面 SVG（夜读 / 古籍 / 现代，按分类）+ /covers 支持 SVG 与安全头
- [x] Task 2 豆瓣候选列表、主机白名单（含每跳重定向）、封面文件带版本号并清理旧文件
- [x] Task 3 预览接口（只读）+ 默认封面预览接口；删除原直接写库的 /ai-fill
- [x] Task 4 应用接口：锁规则、标签与类似作品以提交为准、封面保存、标记已填充
- [x] Task 5 前端预览弹窗 + 书页接入；Chrome 电脑 / 手机实测：取消不写库、分类改玄幻默认封面变夜读、增删类似作品、选默认封面应用后封面与数据正确、旧封面文件被清理
- [x] 实测中修复：预览请求体 null 导致 500；开发环境 /covers 代理；默认封面改用 AI 书名 / 清洗后的书名（coverTitle）
- [x] 最终评审（Opus）：0 Critical；修复 2 Important（trim 比较误锁、超长提示不明）；8 个 Minor 记录待定

# 界面优化 16 项（分支 feature/ui-polish）

全局
- [x] 14 emoji 图标 → Element Plus 线条图标（侧栏 logo、登录/注册、空状态、系列占位、插件卡片）
- [x] 15 白色按钮 / 下拉框 → 深色主题下统一深色（Element Plus 暗色变量，浅色主题不受影响）
- [x] 16 取消：页面上没有任何斜线装饰或模糊滤镜，斜线是本机 WSL 显卡驱动（D3D12）合成截图时的伪影，时有时无
书库
- [x] 1 「AI已填充」标签 → 封面角小圆点（绿 = 已填充、橙 = 失败，悬停文字）
- [x] 2 无封面占位图只显示书名
- [x] 3 手机端顶部压缩：标题 + 扫描图标一行，搜索 + 筛选按钮一行
- [x] 4 搜索提示缩短，魔法关键词说明进「?」
书页
- [x] 5 标题显示清洗后的书名，原文件名小字
- [x] 6 「已在书架 ✓」状态，可再点移出
- [x] 7 有进度时「继续阅读 · 第 X 章」
- [x] 8 文件大小并入标签行
书架
- [x] 9 整行点击继续阅读，「详情 / 移除」进「⋯」菜单，显示进度
阅读器
- [x] 10 键盘 ← / → 上下章，空格翻屏
- [x] 11 去掉右下角浮动书签按钮，顶部图标按钮加悬停文字
设置
- [x] 12 「管理员」中性色标签，「修改密码」文字按钮
- [x] 13 站点名称提示显示当前生效值
- [x] 验证：vitest / vue-tsc / jest；Chrome 电脑 + 手机；浅色主题「晴空」检查无回归
- [x] 追加：书库卡片悬停按钮移到封面下部，两侧留白
- [x] 独立评审（Opus）：修复 2 Important（编辑保存后标题退回原文件名、系列页缺 display_title）与 Minor（深色主色各级变量、书页移出 404 状态、书架移出失败提示、按住 B 重复加书签、默认站点名统一、无效 @click.stop、书架行可用键盘打开）
- [ ] 待定：书页判断「是否在书架」拉取整个书架列表（大书架时可加 GET /shelf/:bookId）
- [ ] 待定：书库「书名 A→Z」按原始文件名排序，与显示的清洗后书名不一致
- 备注：本机 Chrome（WSL D3D12）画不出 SVG 圆弧（搜索放大镜、? 圆圈、⋯、刷新图标都缺），斜线条纹也是同源伪影；DOM 与点击均正常
- [x] AI 填充弹窗：点击后立即打开并显示加载（大转圈 + 已用秒数，可取消并中止请求）；垂直居中；宽屏 880px 两栏（左：作者/分类/连载/标签，右：简介/类似作品），仅中间区域滚动、按钮始终可见；手机全屏单列；浅色主题下 Element Plus 主色同样跟随强调色

# 新默认主题「靛青」（分支 feature/theme-indigo）

- [x] 参考 stock-agent：浅灰底 #eef1f6、白卡片细边框柔阴影、主色靛蓝 #4338ca；不改布局
- [x] main.css 新增 [data-theme="indigo"]（完整定义含 --card-* / --input-bg），输入框白底细边框；暗夜块保留为其他主题的变量基底
- [x] theme.ts：DEFAULT_THEME = indigo，深色主题改为显式列表；后端 / 设置页 / index.html 默认值同步；设置页主题列表首位
- [x] 侧栏选中项：底色由当前主题强调色派生，左侧 3px 强调色竖条（所有主题）
- [x] CLAUDE.md 设计系统说明更新；更新说明补一条
- [x] 验证：vitest 30、vue-tsc、tsc；Chrome 靛青（书库 / 书页 / 设置）与暗夜（无回归）

# 阅读器上下方向键按屏翻页

- [x] ↑ / ↓ 按屏翻页（← / → 仍按章）；空格、PageUp / PageDown 同样处理
- [x] 下翻按行对齐：把距底部约两行的那一行滚到顶部，翻页后上一屏最后的完整行仍可见、顶部不出现半截行；测量点落在段落间距时多点重试，找不到文字（PDF 页面图）按「屏高 − 两行」
- [x] 翻屏时收起浮动工具栏，避免挡住衔接的行；阅读设置中的快捷键说明同步
- [x] 验证：vitest 37；Chrome 第 3 章连续下翻 5 次，每次上一屏最后完整行仍在屏内（多为顶部 8px），每次滚动 819–860px（屏高 912）

# 阅读器样式按 docs/reader-style-spec.md 重做（分支 feature/reader-page-keys）

- [x] 配色 CSS 变量（--reader-page-bg / paper-bg / text / text-secondary / divider）；新增阅读主题「护眼绿」并设为默认，其他主题由背景色与文字色派生
- [x] 纸张居中（最宽 1280px，随「页面宽度」），噪点纹理 + 全屏极淡斜纹；内边距桌面 64px、手机 56/20/48
- [x] 字体栈思源黑体优先，默认 20px（滑块 14–30），行高 1.8，段距 0.8em、首行缩进 2em
- [x] 标题区 h1 36/44 + 元信息（书名 · 作者 · 本章字数）；正文开头重复的标题段隐藏（不删除，阅读进度按段落定位不受影响）
- [x] 顶部导航吸顶 64px，下滑隐藏 / 上滑显示（350ms），方向键翻屏期间不弹出；左侧竖向工具栏（目录 / 书签 / 设置），窄屏收到导航右侧；章末上一章 / 目录 / 下一章；去掉旧底部工具栏与 4 秒自动隐藏
- [x] 瀑布流章节之间分隔线（第一章不加）
- [x] 验证：vitest 46、vue-tsc；Chrome 1440 / 375 截图无横向滚动，导航显隐、↓ 翻屏衔接正常

# 阅读器目录面板（docs/reader-toc-spec.md，分支 feature/reader-toc）

- [x] 配色变量补充 --reader-toc-bg / toc-shadow / accent / accent-weak / hover-bg / active-bg / text-2，护眼绿用规范值，其他主题派生（深色主题阴影加深）
- [x] 工具栏改到纸张右外侧，fixed 垂直居中，64×64 按钮：目录、书签、书详情、夜间（浅色↔夜间/护眼绿）、设置；没有的功能（加书架、投票、客户端、左侧链接）不做
- [x] 目录面板与纸张同宽、盖住正文区，无遮罩，淡入 180ms；点外部 / Esc / 选章关闭，打开时当前章节滚到中间并标红
- [x] 头部 Tab「目录 | 书签」+「已完结 · 共 N 章」+ 倒序；书签 Tab 右侧「添加当前位置」，悬停显示删除；原目录、书签两个抽屉移除
- [x] 两列列表、分隔线内缩 16px、细滚动条；无分卷 / VIP 数据，分卷条与锁图标不做
- [x] 窄屏（≤768）面板占满宽度并显示关闭按钮，手机单列
- [x] 验证：vitest 49、vue-tsc；Chrome 1440（面板与纸张同为 88px/1258px 重合）、375（全屏单列无横向滚动）、外部点击 / Esc / 选章关闭、倒序、夜间切换、书签增删

# 目录区分已读章节（分支 feature/toc-read-state）

- [x] 当前阅读章节之前的章节算已读（只有「当前读到第几章」的数据，跳读时被跳过的章节也显示已读，用户确认接受）
- [x] 已读标题用次要文字色（浅灰），当前章节红色，未读保持正文色
- [x] 验证：vue-tsc；Chrome 当前第 3 章时第 1、2 章浅灰、第 3 章红色、第 4 章起为正文色

# 阅读设置增加字间距（分支 feature/letter-spacing）

- [x] 用户确认「行距」指字间距（行高已有滑块）；letterSpacing 字段与正文样式原已存在，只缺入口
- [x] 设置面板「行高」下方加滑块：0–5px，步长 0.5，标签显示当前值，变更后保存
- [x] 验证：Chrome 拖动后正文 letter-spacing 1px → 1.5px，本地设置同步；已恢复原值 1px

# 阅读器视觉改版：与靛青主题统一、与起点区分（分支 feature/reader-indigo）

- [x] 默认阅读主题「靛青」：浅灰底 #eef1f6、白卡片纸张、正文 #1a2440，强调色跟随网站 --accent（深色阅读主题提亮）；移除「护眼绿」，已保存的自动迁移到靛青；默认字体 Noto Serif SC
- [x] 去掉起点特征：绿纸配色、噪点纹理、全屏斜纹、红色强调、64×64 方块工具栏、盖住正文的两列目录、居中 36px 标题
- [x] 顶栏横跨全屏、毛玻璃、底部全书进度条；纸张为圆角卡片（最宽 1120px），手机去外框
- [x] 标题区左对齐：强调色「第 N 章」小标 + 30px 标题 + 元信息 + 分隔线；章末「下一章」主色按钮
- [x] 右侧竖向胶囊工具栏（图标 + 悬停提示）；目录 / 书签改为左侧抽屉（分段切换、当前章节浅底 + 左竖条、已读浅灰），点遮罩 / Esc / 选章关闭
- [x] 验证：vitest 51、vue-tsc；Chrome 1440（靛青 / 夜间 / 目录 / 章末）、375（无横向滚动、目录全屏），遮罩 / Esc / 选章关闭；测试后阅读进度已跳回第 3 章

# 阅读器 AI：前情提要 + 问书（分支 feature/ai-recap-ask，设计见 docs/superpowers/specs/2026-11-04-ai-recap-ask-design.md）

- [x] 后端纯函数 services/ai-reading.ts（测试先行）：章节转段落、已读部分截取、长章节裁剪、关键词提取、片段检索、提示词构建、思考内容清理
- [x] 后端：ai_recaps 表 + 删除书时清理；GET progress 返回 updatedAt；POST /reader/:bookId/recap（带缓存）、POST /reader/:bookId/ask
- [x] 前端 api + 阅读器：前情卡片（≥3 天自动出现、工具栏随时调出、点击才调用 AI）；右侧问书面板（建议问题、连续对话、来源、加载 / 错误）；AI 未配置时隐藏入口
- [x] 验证：jest / vitest / tsc / vue-tsc；用真实 AI 实测前情与问书，确认不剧透；手机宽度
  - 实测（MiniMax）：前情提要约 9 秒、同位置缓存秒出；问书「梅丽莎是谁」约 8 秒带参考章节，问后文「最后成为什么序列」答「已读内容中没有提到」；第 1200 章位置问书约 9 秒（本地检索很快）；3 天以上自动出卡片（模拟上次阅读时间）；手机问书全屏无横向滚动
