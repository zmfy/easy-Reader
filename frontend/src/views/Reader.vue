<template>
  <div class="reader-page" :style="readerStyle">

    <!-- ── PDF 原生渲染模式 ── -->
    <template v-if="isPdf">
      <div class="pdf-topbar">
        <el-button circle title="返回" @click="goBack"><IconChevronLeft :size="18" :stroke-width="1.75" /></el-button>
        <span class="pdf-topbar-title">PDF 阅读</span>
      </div>
      <div class="pdf-viewer-area">
        <div v-if="pdfLoading" class="pdf-loading">
          <el-icon class="is-loading"><IconLoader2 /></el-icon>
          <span>正在加载 PDF…</span>
        </div>
        <iframe
          v-else-if="pdfBlobUrl"
          :src="pdfBlobUrl"
          class="pdf-frame"
          allowfullscreen
        />
        <div v-else class="pdf-error">PDF 加载失败，请检查文件是否完整</div>
      </div>
    </template>

    <!-- ── 章节阅读模式 ── -->
    <template v-else>
    <!-- 浅灰底 + 居中白色卡片「纸张」；顶栏吸顶，下滑隐藏、上滑显示 -->
    <div
      class="reader-content"
      ref="contentRef"
      @click="toggleToolbar"
      @scroll="handleScroll"
    >
      <header class="reader-nav" :class="{ hidden: !toolbarVisible }" @click.stop>
        <div class="nav-inner">
          <button class="nav-btn" title="返回" @click="goBack"><IconChevronLeft :size="22" :stroke-width="1.75" /></button>
          <span class="nav-title">{{ bookTitle }}</span>
          <span class="nav-progress">
            {{ reader.currentChapterIndex.value + 1 }} / {{ reader.chapters.value.length }}{{ readerStore.settings.pageMode === 'waterfall' ? ` ${unitLabel} · 瀑布流` : '' }}
          </span>
          <!-- 窄屏：右侧工具栏放不下，按钮收在顶栏右侧 -->
          <div class="nav-actions">
            <button class="nav-btn" title="章节目录" @click="openToc('toc')"><IconList :size="20" :stroke-width="1.75" /></button>
            <button class="nav-btn" title="书签（按 B 添加当前位置）" @click="openToc('bookmark')"><IconBookmark :size="20" :stroke-width="1.75" /></button>
            <button class="nav-btn" :class="{ on: onShelf }" :title="shelfLabel" :aria-label="shelfLabel" :aria-pressed="onShelf" @click="toggleShelf"><IconBooks :size="20" :stroke-width="1.75" /></button>
            <button v-if="aiReady" class="nav-btn" title="问书（AI）" @click="openAsk"><IconSparkles :size="20" :stroke-width="1.75" /></button>
            <button v-if="listenAvailable" class="nav-btn" :class="{ on: listenActive }" :title="ttsReady ? '听书（MiniMax AI 语音）' : '听书（浏览器语音）'" @click="toggleListen"><IconHeadphones :size="20" :stroke-width="1.75" /><span v-if="ttsReady" class="ai-badge">AI</span></button>
            <button class="nav-btn" title="阅读设置" @click="settingsPanelVisible = true"><IconSettings :size="20" :stroke-width="1.75" /></button>
          </div>
        </div>
        <!-- 全书进度：读到第几章 -->
        <div class="nav-bar"><i :style="{ width: bookProgress }" /></div>
      </header>

      <div class="paper" :class="{ 'pdf-wrapper': isPdfRender, listening: listenActive }" :style="paperStyle">
        <!-- 右侧悬浮工具栏：纸张右外侧的竖向胶囊，图标按钮 + 悬停提示（宽屏） -->
        <aside class="side-tools" @click.stop>
          <el-tooltip content="目录" placement="left" :show-after="300">
            <button class="side-tool" aria-label="目录" :class="{ on: tocVisible && tocTab === 'toc' }" @click="openToc('toc')"><IconList :size="20" :stroke-width="1.75" /></button>
          </el-tooltip>
          <el-tooltip content="书签（B 添加当前位置）" placement="left" :show-after="300">
            <button class="side-tool" aria-label="书签（B 添加当前位置）" :class="{ on: tocVisible && tocTab === 'bookmark' }" @click="openToc('bookmark')"><IconBookmark :size="20" :stroke-width="1.75" /></button>
          </el-tooltip>
          <el-tooltip content="书籍详情" placement="left" :show-after="300">
            <button class="side-tool" aria-label="书籍详情" @click="router.push(`/book/${bookId}`)"><IconBook2 :size="20" :stroke-width="1.75" /></button>
          </el-tooltip>
          <el-tooltip :content="shelfLabel" placement="left" :show-after="300">
            <button class="side-tool" :aria-label="shelfLabel" :aria-pressed="onShelf" :class="{ on: onShelf }" @click="toggleShelf"><IconBooks :size="20" :stroke-width="1.75" /></button>
          </el-tooltip>
          <el-tooltip v-if="listenAvailable" :content="listenActive ? '关闭听书' : (ttsReady ? '听书（MiniMax AI 语音）' : '听书（浏览器语音）')" placement="left" :show-after="300">
            <button class="side-tool" :aria-label="listenActive ? '关闭听书' : (ttsReady ? '听书（MiniMax AI 语音）' : '听书（浏览器语音）')" :class="{ on: listenActive }" @click="toggleListen"><IconHeadphones :size="20" :stroke-width="1.75" /><span v-if="ttsReady" class="ai-badge">AI</span></button>
          </el-tooltip>
          <template v-if="aiReady">
            <span class="side-sep" />
            <el-tooltip content="前情提要（AI）" placement="left" :show-after="300">
              <button class="side-tool" aria-label="前情提要（AI）" :class="{ on: recapVisible }" @click="toggleRecap"><IconHistory :size="20" :stroke-width="1.75" /></button>
            </el-tooltip>
            <el-tooltip content="问书（AI）" placement="left" :show-after="300">
              <button class="side-tool" aria-label="问书（AI）" :class="{ on: askVisible }" @click="openAsk"><IconSparkles :size="20" :stroke-width="1.75" /></button>
            </el-tooltip>
          </template>
          <span class="side-sep" />
          <el-tooltip :content="nightMode ? '切换到日间（靛青）' : '切换到夜间'" placement="left" :show-after="300">
            <button class="side-tool" :aria-label="nightMode ? '切换到日间（靛青）' : '切换到夜间'" @click="toggleNight"><component :is="nightMode ? IconSun : IconMoon" :size="20" :stroke-width="1.75" /></button>
          </el-tooltip>
          <el-tooltip content="阅读设置" placement="left" :show-after="300">
            <button class="side-tool" aria-label="阅读设置" @click="settingsPanelVisible = true"><IconSettings :size="20" :stroke-width="1.75" /></button>
          </el-tooltip>
        </aside>

        <!-- ── 章节模式 ── -->
        <template v-if="readerStore.settings.pageMode === 'scroll'">
          <div v-if="loading" class="content-loading">
            <el-skeleton :rows="20" animated />
          </div>
          <template v-else>
            <div v-if="!isPdfRender && !(isImagePage(reader.currentContent.value) && !reader.chapters.value[reader.currentChapterIndex.value]?.title)" class="chapter-head">
              <div class="chapter-eyebrow">第 {{ reader.currentChapterIndex.value + 1 }} {{ unitLabel }}</div>
              <h1 class="chapter-heading">{{ chapterTitle }}</h1>
              <div class="chapter-meta">{{ chapterMeta(reader.currentContent.value) }}</div>
            </div>
            <div v-if="isPdfRender" class="chapter-content pdf-chapter">
              <PdfPage v-if="pdfDoc" :doc="pdfDoc" :page-number="reader.currentChapterIndex.value + 1" />
              <div v-else-if="pdfDocFailed" class="pdf-error">PDF 加载失败，请检查文件是否完整</div>
              <el-skeleton v-else :rows="20" animated />
            </div>
            <div
              v-else
              class="chapter-content"
              :class="{ 'image-page': isImagePage(reader.currentContent.value), 'fit-width': readerStore.settings.imageFit === 'width' }"
              v-html="hideLeadingTitle(reader.currentContent.value, chapterTitle)"
              :style="contentStyle"
              @click.capture="handleContentClick"
            />
            <!-- 章末导航：上一章 · 目录 · 下一章 -->
            <nav class="chapter-end" @click.stop>
              <button class="end-btn" :disabled="reader.currentChapterIndex.value === 0" @click="goToPrevChapter"><IconChevronLeft :size="18" :stroke-width="1.75" />上一{{ unitLabel }}</button>
              <button class="end-btn" @click="openToc('toc')"><IconList :size="18" :stroke-width="1.75" />目录</button>
              <button class="end-btn primary" :disabled="reader.currentChapterIndex.value >= reader.chapters.value.length - 1" @click="goToNextChapter">下一{{ unitLabel }}<IconChevronRight :size="18" :stroke-width="1.75" /></button>
            </nav>
          </template>
        </template>

        <!-- ── 瀑布流模式：章节之间用分隔线 ── -->
        <template v-else>
          <section
            v-for="ch in waterfallChapters"
            :key="ch.index"
            :data-chapter-index="ch.index"
            class="waterfall-chapter"
          >
            <div v-if="!isPdfRender && !(isImagePage(ch.content) && !reader.chapters.value[ch.index]?.title)" class="chapter-head">
              <div class="chapter-eyebrow">第 {{ ch.index + 1 }} {{ unitLabel }}</div>
              <h1 class="chapter-heading">{{ ch.title }}</h1>
              <div class="chapter-meta">{{ chapterMeta(ch.content) }}</div>
            </div>
            <div v-if="isPdfRender" class="chapter-content pdf-chapter">
              <PdfPage v-if="pdfDoc" :doc="pdfDoc" :page-number="ch.index + 1" />
            </div>
            <div v-else class="chapter-content" :class="{ 'image-page': isImagePage(ch.content), 'fit-width': readerStore.settings.imageFit === 'width' }" v-html="hideLeadingTitle(ch.content, ch.title)" :style="contentStyle" @click.capture="handleContentClick" />
          </section>
          <div v-if="waterfallLoading" class="waterfall-loading">
            <el-icon class="is-loading"><IconLoader2 /></el-icon> 加载中…
          </div>
          <div v-else-if="!hasMoreChapters && waterfallChapters.length > 0" class="waterfall-end">
            — 本书完 —
          </div>
        </template>
      </div>
    </div>

    <!-- Settings Panel -->
    <el-drawer
      v-model="settingsPanelVisible"
      title="阅读设置"
      direction="rtl"
      size="340px"
      :modal-class="'reader-drawer'"
    >
      <div class="settings-panel">
        <!-- 阅读模式 -->
        <div class="setting-group">
          <div class="setting-label">阅读模式</div>
          <div class="mode-options">
            <button
              class="mode-btn"
              :class="{ active: readerStore.settings.pageMode === 'scroll' }"
              @click="setPageMode('scroll')"
            >章节翻页</button>
            <button
              class="mode-btn"
              :class="{ active: readerStore.settings.pageMode === 'waterfall' }"
              @click="setPageMode('waterfall')"
            >瀑布流</button>
          </div>
        </div>

        <!-- 漫画图片：只在当前内容有纯图片页时显示 -->
        <div v-if="hasImagePages" class="setting-group">
          <div class="setting-label">漫画图片</div>
          <div class="mode-options">
            <button
              class="mode-btn"
              :class="{ active: readerStore.settings.imageFit !== 'width' }"
              @click="readerStore.updateSettings({ imageFit: 'height' })"
            >适合高度</button>
            <button
              class="mode-btn"
              :class="{ active: readerStore.settings.imageFit === 'width' }"
              @click="readerStore.updateSettings({ imageFit: 'width' })"
            >适合宽度</button>
          </div>
        </div>

        <!-- 主题 -->
        <div class="setting-group">
          <div class="setting-label">主题</div>
          <div class="theme-options">
            <button
              v-for="(val, key) in readerStore.themes"
              :key="key"
              class="theme-btn"
              :class="{ active: readerStore.settings.theme === key }"
              :style="{ background: val.backgroundColor, color: val.fontColor, border: '2px solid ' + (readerStore.settings.theme === key ? 'var(--accent)' : 'color-mix(in srgb, var(--reader-text) 20%, transparent)') }"
              @click="readerStore.applyTheme(key as ReaderTheme)"
            >{{ val.label }}</button>
          </div>
        </div>

        <!-- 字号 -->
        <div class="setting-group">
          <div class="setting-label">字号 {{ readerStore.settings.fontSize }}px</div>
          <el-slider v-model="readerStore.settings.fontSize" :min="14" :max="30" @change="saveSettings" />
        </div>

        <!-- 行高 -->
        <div class="setting-group">
          <div class="setting-label">行高 {{ readerStore.settings.lineHeight }}</div>
          <el-slider v-model="readerStore.settings.lineHeight" :min="1.4" :max="2.5" :step="0.1" @change="saveSettings" />
        </div>

        <!-- 字间距 -->
        <div class="setting-group">
          <div class="setting-label">字间距 {{ readerStore.settings.letterSpacing }}px</div>
          <el-slider v-model="readerStore.settings.letterSpacing" :min="0" :max="5" :step="0.5" @change="saveSettings" />
        </div>

        <!-- 页面宽度 -->
        <div class="setting-group">
          <div class="setting-label">页面宽度 {{ readerStore.settings.pageWidth }}%</div>
          <el-slider v-model="readerStore.settings.pageWidth" :min="20" :max="98" :step="2" @change="saveSettings" />
        </div>

        <!-- 字体 -->
        <div class="setting-group">
          <div class="setting-label">字体</div>
          <el-select v-model="readerStore.settings.fontFamily" @change="saveSettings" style="width:100%">
            <el-option
              v-for="f in readerStore.fontOptions"
              :key="f.value"
              :label="f.label"
              :value="f.value"
            />
          </el-select>
        </div>

        <!-- 重置 -->
        <el-button size="small" plain class="reset-btn" @click="readerStore.resetSettings()">恢复默认</el-button>

        <div class="shortcut-hint">快捷键：← → 翻章 · ↑ ↓ / 空格 翻屏 · B 加书签</div>
      </div>
    </el-drawer>

    <!-- 听书播放条：底部悬浮；锁屏 / 后台继续播放 -->
    <Transition name="player">
      <div v-if="listenActive" class="listen-bar" @click.stop>
        <div class="listen-info">
          <IconHeadphones :size="18" :stroke-width="1.75" class="listen-icon" />
          <div class="listen-text">
            <div class="listen-title">{{ chapterTitle }}</div>
            <div class="listen-status" :class="{ error: !!listenError }">{{ listenStatus }}</div>
            <div v-if="listenMode === 'browser'" class="listen-hint">想要更自然的声音？可在「AI 设置 → MiniMax」开启听书</div>
          </div>
        </div>
        <div class="listen-controls">
          <button class="listen-btn" title="上一段" @click="listen.prev()"><IconPlayerSkipBack :size="20" :stroke-width="1.75" /></button>
          <button class="listen-btn main" :title="listenPlaying ? '暂停' : '播放'" @click="listen.toggle()">
            <el-icon v-if="listenLoading" class="is-loading"><IconLoader2 /></el-icon>
            <IconPlayerPauseFilled v-else-if="listenPlaying" :size="20" />
            <IconPlayerPlayFilled v-else :size="20" />
          </button>
          <button class="listen-btn" title="下一段" @click="listen.next()"><IconPlayerSkipForward :size="20" :stroke-width="1.75" /></button>
        </div>
        <div class="listen-extra">
          <el-dropdown trigger="click" placement="top" @command="(r: number) => listen.setRate(r)">
            <button class="listen-chip" title="语速">{{ listenRate }}x</button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item v-for="r in LISTEN_RATES" :key="r" :command="r">{{ r }}x</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
          <el-dropdown trigger="click" placement="top" @command="(m: SleepMode) => listen.setSleep(m)">
            <button class="listen-chip" :class="{ on: !!listenSleepMode }" title="定时停止"><IconClock :size="15" :stroke-width="1.75" />{{ sleepLabel }}</button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item :command="0">不定时</el-dropdown-item>
                <el-dropdown-item :command="15">15 分钟后停止</el-dropdown-item>
                <el-dropdown-item :command="30">30 分钟后停止</el-dropdown-item>
                <el-dropdown-item :command="60">60 分钟后停止</el-dropdown-item>
                <el-dropdown-item command="chapter">本章结束后停止</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
          <button class="listen-btn" title="关闭听书" @click="listen.stop()"><IconX :size="18" :stroke-width="1.75" /></button>
        </div>
      </div>
    </Transition>

    <!-- 前情提要卡片：隔几天再打开时自动出现，工具栏随时调出；点按钮才调用 AI -->
    <Transition name="recap">
      <div v-if="recapVisible" class="recap-card" @click.stop>
        <div class="recap-head">
          <IconHistory :size="18" :stroke-width="1.75" class="recap-icon" />
          <div class="recap-heading">
            <div class="recap-title">{{ recapAwayDays !== null ? `上次阅读是 ${awayLabel(recapAwayDays)}` : '前情提要' }}</div>
            <div class="recap-sub">读到：{{ chapterTitle }}</div>
          </div>
          <button class="toc-icon-btn" title="关闭" @click="recapVisible = false"><IconX :size="18" :stroke-width="1.75" /></button>
        </div>
        <p v-if="recapText" class="recap-text">{{ recapText }}</p>
        <p v-else-if="recapError" class="recap-text recap-error">{{ recapError }}</p>
        <div v-if="!recapText" class="recap-actions">
          <button class="end-btn primary" :disabled="recapLoading" @click="loadRecap">
            <el-icon v-if="recapLoading" class="is-loading"><IconLoader2 /></el-icon>
            <IconSparkles v-else :size="16" :stroke-width="1.75" />
            {{ recapLoading ? 'AI 正在回顾…' : 'AI 回顾前情' }}
          </button>
          <span class="recap-hint">概括最近 3 章到当前位置，不剧透</span>
        </div>
        <div v-else-if="recapRange" class="recap-hint">回顾范围：{{ recapRange }}</div>
      </div>
    </Transition>

    <!-- 问书：右侧对话面板，只根据已读内容回答 -->
    <Transition name="ask">
      <div v-if="askVisible" class="toc-layer" @click.self="askVisible = false">
        <aside class="toc-panel ask-panel">
          <div class="ask-head">
            <div>
              <div class="ask-title"><IconSparkles :size="18" :stroke-width="1.75" />问书</div>
              <div class="ask-sub">只根据你已读的内容回答，不会剧透</div>
            </div>
            <button class="toc-icon-btn" title="关闭（Esc）" @click="askVisible = false"><IconX :size="18" :stroke-width="1.75" /></button>
          </div>
          <div class="ask-body" ref="askBodyRef">
            <div v-if="askMessages.length === 0" class="ask-empty">
              <p>可以问人物、事件、伏笔……</p>
              <div class="ask-chips">
                <button v-for="q in ASK_SUGGESTIONS" :key="q" @click="q === '前情提要' ? askRecap() : sendAsk(q)">{{ q }}</button>
              </div>
            </div>
            <div v-for="(m, i) in askMessages" :key="i" class="ask-msg" :class="[m.role, { error: m.error }]">
              <div class="ask-bubble">
                <template v-if="m.pending"><el-icon class="is-loading"><IconLoader2 /></el-icon> 正在翻书…</template>
                <template v-else>{{ m.text }}</template>
              </div>
              <div v-if="m.sources?.length" class="ask-sources">参考：{{ m.sources.map(s => s.title).join('、') }}</div>
            </div>
          </div>
          <form class="ask-input" @submit.prevent="sendAsk()">
            <textarea
              v-model="askDraft"
              rows="2"
              maxlength="500"
              placeholder="问点什么，比如「这个人是谁？」"
              @keydown.enter="onAskEnter"
            />
            <button type="submit" class="ask-send" title="发送（Enter）" :disabled="!askDraft.trim() || askBusy"><IconSend :size="18" :stroke-width="1.75" /></button>
          </form>
        </aside>
      </div>
    </Transition>

    <!-- 目录抽屉：从左侧滑出，浅色遮罩；点遮罩 / Esc / 选章关闭 -->
    <Transition name="toc">
      <div v-if="tocVisible" class="toc-layer" @click.self="tocVisible = false">
        <aside class="toc-panel">
          <div class="toc-head">
            <div class="toc-seg">
              <button :class="{ active: tocTab === 'toc' }" @click="switchTocTab('toc')">目录</button>
              <button :class="{ active: tocTab === 'bookmark' }" @click="switchTocTab('bookmark')">书签</button>
            </div>
            <button class="toc-icon-btn" title="关闭（Esc）" @click="tocVisible = false"><IconX :size="18" :stroke-width="1.75" /></button>
          </div>
          <div class="toc-sub">
            <span class="toc-status">{{ tocTab === 'toc' ? tocStatus : `${reader.bookmarks.value.length} 个书签` }}</span>
            <button v-if="tocTab === 'toc'" class="toc-action" @click="tocReversed = !tocReversed">
              <IconArrowsSort :size="15" :stroke-width="1.75" />{{ tocReversed ? '正序' : '倒序' }}
            </button>
            <button v-else class="toc-action" @click="handleAddBookmark">
              <IconBookmarkPlus :size="15" :stroke-width="1.75" />添加当前位置
            </button>
          </div>
          <div class="toc-body" ref="tocBodyRef">
            <ul v-if="tocTab === 'toc'" class="toc-list">
              <li v-for="row in tocRows" :key="row.index">
                <a
                  class="toc-link"
                  :class="{ current: row.index === reader.currentChapterIndex.value, read: row.index >= 0 && row.index < reader.currentChapterIndex.value, nested: tocTree.hasNesting, group: row.index < 0 }"
                  :style="tocTree.hasNesting ? { paddingLeft: `${4 + row.depth * 18}px` } : undefined"
                  :title="row.title ?? tocTitle(row.index)"
                  @click="row.index < 0 ? toggleTocNode(row.index) : jumpToChapter(row.index)"
                >
                  <!-- 多层目录：有下级的显示箭头，点箭头展开 / 收起，点标题跳转 -->
                  <button
                    v-if="tocTree.hasNesting"
                    class="toc-caret"
                    :class="{ open: row.expanded, leaf: !row.hasChildren }"
                    :tabindex="row.hasChildren ? 0 : -1"
                    :aria-label="row.hasChildren ? (row.expanded ? '收起' : '展开') : undefined"
                    :aria-hidden="!row.hasChildren"
                    @click.stop="row.hasChildren && toggleTocNode(row.index)"
                  ><IconChevronRight :size="14" :stroke-width="2" /></button>
                  <span class="toc-title">{{ row.title ?? tocTitle(row.index) }}</span>
                </a>
              </li>
            </ul>
            <template v-else>
              <div v-if="reader.bookmarks.value.length === 0" class="toc-empty">还没有书签<br>阅读时按 B 或点上方「添加当前位置」</div>
              <ul v-else class="toc-list">
                <li v-for="bm in reader.bookmarks.value" :key="bm.id">
                  <a class="toc-link bookmark" @click="jumpToBookmark(bm.chapter_index, bm.scroll_top)">
                    <span class="toc-title">
                      {{ reader.chapters.value[bm.chapter_index]?.title || `第 ${bm.chapter_index + 1} ${unitLabel}` }}
                      <small class="toc-extra">{{ formatServerTime(bm.created_at) }}<template v-if="bm.note"> · {{ bm.note }}</template></small>
                    </span>
                    <button class="toc-del" title="删除书签" @click.stop="reader.deleteBookmark(bm.id)"><IconTrash :size="16" :stroke-width="1.75" /></button>
                  </a>
                </li>
              </ul>
            </template>
          </div>
        </aside>
      </div>
    </Transition>

    </template><!-- end 章节模式 -->
  </div>
</template>

<script setup lang="ts">
import { ref, shallowRef, computed, watch, onMounted, onBeforeUnmount, onUnmounted, nextTick } from 'vue'
import { formatServerTime } from '@/utils/time'
import { resolveBack } from '@/utils/page-back'
import { buildTocTree, visibleTocRows, tocAncestors } from '@/utils/toc-tree'
import { useRoute, useRouter } from 'vue-router'
import { useReader } from '@/composables/useReader'
import { useReaderStore } from '@/stores/reader'
import { readerApi } from '@/api/reader'
import type { PDFDocumentProxy } from '@/utils/pdf'
import PdfPage from '@/components/PdfPage.vue'
import type { ReaderTheme, ReadingAnchor } from '@/types'
import { readerKeyAction, pageScrollDistance, alignedPageDistance } from '@/utils/reader-keys'
import { readerPalette, hideLeadingTitle, countChapterChars, isDarkReaderTheme, nightToggleTheme, isImagePage } from '@/utils/reader-style'
import { libraryApi } from '@/api/library'
import { settingsApi } from '@/api/settings'
import { useShelfToggle } from '@/composables/useShelfToggle'
import { shouldOfferRecap, daysSince, awayLabel, askHistory, type AskMessage } from '@/utils/reader-ai'
import { useListen, LISTEN_RATES, type SleepMode } from '@/composables/useListen'
import { IconArrowsSort, IconBook2, IconBookmark, IconBooks, IconBookmarkPlus, IconChevronLeft, IconChevronRight, IconList, IconClock, IconHeadphones, IconHistory, IconLoader2, IconMoon, IconPlayerPauseFilled, IconPlayerPlayFilled, IconPlayerSkipBack, IconPlayerSkipForward, IconSend, IconSettings, IconSparkles, IconSun, IconTrash, IconX } from '@tabler/icons-vue'

const route = useRoute()
const router = useRouter()
const readerStore = useReaderStore()
const bookId = route.params.bookId as string
// 书架：工具栏按钮加入 / 移出当前书
const { onShelf, toggle: toggleShelf, refresh: refreshShelf } = useShelfToggle(() => bookId)
const shelfLabel = computed(() => onShelf.value ? '已在书架（点击移出）' : '加入书架')

// 返回：有站内历史则回退；从桌面图标、链接或新标签页直接打开时回到这本书的书页
function goBack() {
  const action = resolveBack(true, !!window.history.state?.back, `/book/${bookId}`)
  if (action?.type === 'push') router.push(action.path)
  else if (action) router.back()
}

const reader = useReader(bookId)
const loading = computed(() => reader.loading.value)
const contentRef = ref<HTMLElement | null>(null)
const toolbarVisible = ref(true)
const settingsPanelVisible = ref(false)

// ── 目录面板 ─────────────────────────────────────────────────
const tocVisible = ref(false)
const tocTab = ref<'toc' | 'bookmark'>('toc')
const tocReversed = ref(false)
const tocBodyRef = ref<HTMLElement | null>(null)

// ── PDF native rendering ─────────────────────────────────────
// isPdf: true 表示使用浏览器原生 iframe 打开（插件未启用时的默认行为）
const isPdf = computed(() => reader.bookFormat.value === 'pdf' && !reader.pdfUsePlugin.value)
const pdfBlobUrl = ref('')
const pdfLoading = ref(false)

async function loadPdfBlob() {
  pdfLoading.value = true
  try {
    const resp = await readerApi.getRaw(bookId)
    const blob = new Blob([resp.data as ArrayBuffer], { type: 'application/pdf' })
    pdfBlobUrl.value = URL.createObjectURL(blob)
  } finally {
    pdfLoading.value = false
  }
}

// ── PDF 逐页渲染（插件模式）────────────────────────────────
// 每页作为一章，沿用章节翻页 / 瀑布流 / 进度 / 书签；正文用 pdf.js 按原版画出，保留图片与版式
const isPdfRender = computed(() => reader.bookFormat.value === 'pdf' && reader.pdfUsePlugin.value)
const unitLabel = computed(() => isPdfRender.value ? '页' : '章')

// 标题区：章节标题 + 元信息（书名 · 作者 · 本章字数）
const bookTitle = ref('')
const bookAuthor = ref('')
const bookFinished = ref(false)
const bookCover = ref('')
const chapterTitle = computed(() => {
  const ch = reader.currentChapter.value
  return ch ? (ch.title || `第 ${ch.index + 1} ${unitLabel.value}`) : ''
})
function chapterMeta(html: string): string {
  return [bookTitle.value, bookAuthor.value, `本章 ${countChapterChars(html)} 字`].filter(Boolean).join(' · ')
}
async function loadBookInfo() {
  try {
    const b = (await libraryApi.get(bookId)).data.data
    bookTitle.value = b?.display_title || b?.title || ''
    bookAuthor.value = b?.author || ''
    bookCover.value = b?.cover_url ? new URL(b.cover_url, location.origin).href : ''
    bookFinished.value = !!b?.is_finished
  } catch { /* 标题区仅作展示，失败不影响阅读 */ }
}
const pdfDoc = shallowRef<PDFDocumentProxy | null>(null)
const pdfDocFailed = ref(false)

async function loadPdfDocument() {
  try {
    // pdf.js 体积较大，只在打开 PDF 时按需加载，不影响其他格式的阅读页
    const [resp, { openPdfDocument }] = await Promise.all([readerApi.getRaw(bookId), import('@/utils/pdf')])
    pdfDoc.value = await openPdfDocument(resp.data as ArrayBuffer)
  } catch (err) {
    console.error('[pdf] load document failed', err)
    pdfDocFailed.value = true
  }
}

// ── Computed styles ──────────────────────────────────────────
// 阅读配色以 CSS 变量提供（--reader-page-bg / --reader-paper-bg / --reader-text …），便于切换阅读主题
// 站点 --accent 的实际色值，用来算阅读器 accent 底上的文字色；站点主题切换时（data-theme 变化）更新
const siteAccent = ref('')
const readSiteAccent = () => { siteAccent.value = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() }
readSiteAccent()
let themeObserver: MutationObserver | null = null
onMounted(() => {
  readSiteAccent()
  themeObserver = new MutationObserver(readSiteAccent)
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
})
onBeforeUnmount(() => themeObserver?.disconnect())

const readerStyle = computed(() => ({
  // 纸张宽度：「页面宽度」百分比，最宽 1120px，并给右侧工具栏留出位置；顶栏与工具栏定位共用
  '--paper-w': `min(${readerStore.settings.pageWidth}%, 1120px, calc(100% - 152px))`,
  ...readerPalette(readerStore.settings.theme, readerStore.settings.backgroundColor, readerStore.settings.fontColor, siteAccent.value),
  color: 'var(--reader-text)',
}))

const paperStyle = computed(() => ({
  width: 'var(--paper-w)',
  '--reader-font': readerStore.settings.fontFamily,
}))

const contentStyle = computed(() => ({
  fontFamily: readerStore.settings.fontFamily,
  fontSize: `${readerStore.settings.fontSize}px`,
  lineHeight: readerStore.settings.lineHeight,
  letterSpacing: `${readerStore.settings.letterSpacing}px`,
}))

// ── Waterfall state ──────────────────────────────────────────
interface WaterfallChapter { index: number; title: string; content: string }
const waterfallChapters = ref<WaterfallChapter[]>([])
// 当前内容里有纯图片页（漫画）时，阅读设置里才显示「漫画图片」适合高度 / 宽度
const hasImagePages = computed(() => readerStore.settings.pageMode === 'waterfall'
  ? waterfallChapters.value.some(ch => isImagePage(ch.content))
  : isImagePage(reader.currentContent.value))
const waterfallLoading = ref(false)
const hasMoreChapters = computed(() => {
  if (!waterfallChapters.value.length) return false
  return waterfallChapters.value[waterfallChapters.value.length - 1].index < reader.chapters.value.length - 1
})

// 瀑布流最多保留的章节数：超出后移除当前阅读位置之前的章节，避免 DOM 无限增长
const WATERFALL_MAX_CHAPTERS = 8

async function trimWaterfallTop() {
  const container = contentRef.value
  if (!container) return
  const excess = waterfallChapters.value.length - WATERFALL_MAX_CHAPTERS
  if (excess <= 0) return
  // 章节按顺序排列，只移除位于当前阅读章节之前的部分
  const removable = waterfallChapters.value
    .slice(0, excess)
    .filter(ch => ch.index < reader.currentChapterIndex.value).length
  if (removable === 0) return

  // 以保留下来的第一章为锚点，比较移除前后它在视口中的位置并修正滚动，
  // 无论浏览器是否已做滚动锚定（overflow-anchor）都不会重复补偿
  const anchorIndex = waterfallChapters.value[removable].index
  const anchorEl = container.querySelector<HTMLElement>(`[data-chapter-index="${anchorIndex}"]`)
  const before = anchorEl?.getBoundingClientRect().top ?? 0
  waterfallChapters.value.splice(0, removable)
  await nextTick()
  const after = anchorEl?.getBoundingClientRect().top ?? 0
  container.scrollTop += after - before
}

// 瀑布流「代数」：每次重置（初始化 / 跳章 / 跳书签）递增，进行中的旧请求返回后据此丢弃，
// 避免后台预加载的旧章节被插进刚清空的列表、导致跳到错误章节
let waterfallGeneration = 0

function resetWaterfall() {
  waterfallGeneration++
  waterfallChapters.value = []
  waterfallLoading.value = false  // 释放旧请求持有的加载锁，让新的加载立即开始
}

async function loadWaterfallChapter(index: number) {
  if (waterfallLoading.value) return
  if (index >= reader.chapters.value.length) return
  const generation = waterfallGeneration
  waterfallLoading.value = true
  try {
    const content = await reader.fetchChapterContent(index)
    if (generation !== waterfallGeneration) return
    waterfallChapters.value.push({
      index,
      title: reader.chapters.value[index]?.title || `第 ${index + 1} 章`,
      content,
    })
  } finally {
    if (generation === waterfallGeneration) waterfallLoading.value = false
  }
}

// If chapter content is shorter than the viewport, the scroll event never fires
// and the next chapter never auto-loads. Keep appending chapters until the
// container is tall enough to be scrollable (with a 300px trigger margin).
async function fillWaterfallIfNeeded() {
  await nextTick()
  await new Promise<void>(r => requestAnimationFrame(() => r()))
  const container = contentRef.value
  if (!container) return
  while (hasMoreChapters.value && !waterfallLoading.value) {
    if (container.scrollHeight > container.clientHeight + 300) break
    const nextIndex = waterfallChapters.value[waterfallChapters.value.length - 1].index + 1
    await loadWaterfallChapter(nextIndex)
    await nextTick()
    await new Promise<void>(r => requestAnimationFrame(() => r()))
  }
}

async function initWaterfall() {
  resetWaterfall()
  const startIndex = reader.currentChapterIndex.value
  await loadWaterfallChapter(startIndex)
  await nextTick()
  if (contentRef.value) contentRef.value.scrollTop = 0
  requestAnimationFrame(() => {
    if (contentRef.value) contentRef.value.scrollTop = 0
  })
  await fillWaterfallIfNeeded()
}

// ── 顶部导航显隐：下滑隐藏、上滑显示，回到顶部时总是显示；点击正文切换 ──
function toggleToolbar() {
  toolbarVisible.value = !toolbarVisible.value
}

let lastScrollTop = 0
let keyPagingUntil = 0  // 方向键翻屏期间不弹出导航，避免盖住衔接的行
function updateToolbarOnScroll(scrollTop: number) {
  const delta = scrollTop - lastScrollTop
  lastScrollTop = scrollTop
  if (Date.now() < keyPagingUntil) return
  if (scrollTop < 64) toolbarVisible.value = true
  else if (delta > 6) toolbarVisible.value = false
  else if (delta < -6) toolbarVisible.value = true
}

// ── Scroll handler ───────────────────────────────────────────
let saveTimer: ReturnType<typeof setTimeout>
let scrollRaf = 0

// ── 章节模式：章内阅读位置 ──────────────────────────────────
// 以「屏幕顶部所在段落的序号 + 该段落已读过的比例」记录位置，与字号、页面宽度、
// 设备无关，也不受网页字体晚加载导致的重排影响（像素 scrollTop 做不到这点）
const ANCHOR_SELECTOR = 'p, h1, h2, h3, h4, h5, h6, li, blockquote, pre, img, figure, table'
const SAVE_DELAY_MS = 1000
const RESTORE_WINDOW_MS = 3000
let restoringPosition = false
let stopRestore: (() => void) | null = null

function getAnchorBlocks(): HTMLElement[] {
  const content = contentRef.value?.querySelector<HTMLElement>('.chapter-content')
  if (!content) return []
  const blocks = Array.from(content.querySelectorAll<HTMLElement>(ANCHOR_SELECTOR))
  return blocks.length > 0 ? blocks : [content]
}

function getCurrentAnchor(): ReadingAnchor {
  const container = contentRef.value
  const blocks = getAnchorBlocks()
  if (!container || blocks.length === 0) return { paragraphIndex: 0, paragraphOffset: 0 }
  const viewTop = container.getBoundingClientRect().top
  for (let i = 0; i < blocks.length; i++) {
    const rect = blocks[i].getBoundingClientRect()
    if (rect.bottom > viewTop) {
      const offset = rect.height > 0 ? (viewTop - rect.top) / rect.height : 0
      return { paragraphIndex: i, paragraphOffset: Math.min(1, Math.max(0, offset)) }
    }
  }
  return { paragraphIndex: blocks.length - 1, paragraphOffset: 1 }
}

function scrollToAnchor(anchor: ReadingAnchor) {
  const container = contentRef.value
  const blocks = getAnchorBlocks()
  if (!container || blocks.length === 0) return
  const block = blocks[Math.min(anchor.paragraphIndex, blocks.length - 1)]
  const rect = block.getBoundingClientRect()
  container.scrollTop += rect.top + rect.height * anchor.paragraphOffset - container.getBoundingClientRect().top
}

async function restoreChapterPosition(anchor: ReadingAnchor) {
  stopRestore?.()
  const container = contentRef.value
  if (!container) return
  container.scrollTop = 0
  if (anchor.paragraphIndex <= 0 && anchor.paragraphOffset <= 0) return

  // 恢复期间忽略滚动事件，避免把恢复过程中的中间位置保存下来
  restoringPosition = true
  const observer = new ResizeObserver(() => scrollToAnchor(anchor))
  const userEvents = ['wheel', 'touchstart', 'mousedown', 'keydown'] as const
  let timer: ReturnType<typeof setTimeout> | undefined
  const stop = () => {
    observer.disconnect()
    clearTimeout(timer)
    userEvents.forEach(e => window.removeEventListener(e, stop))
    restoringPosition = false
    if (stopRestore === stop) stopRestore = null
  }
  stopRestore = stop
  // 用户一旦主动操作就停止自动定位
  userEvents.forEach(e => window.addEventListener(e, stop, { passive: true }))

  await nextTick()
  await document.fonts.ready  // 网页字体加载完成后再定位，否则重排会使位置偏移
  if (stopRestore !== stop) return
  scrollToAnchor(anchor)
  // 图片等内容晚加载会改变布局：一段时间内随正文尺寸变化重新定位
  const content = contentRef.value?.querySelector('.chapter-content')
  if (content) observer.observe(content)
  timer = setTimeout(stop, RESTORE_WINDOW_MS)
}

function saveChapterPosition(onHide = false) {
  if (!contentRef.value || reader.loading.value || restoringPosition) return
  const anchor = getCurrentAnchor()
  if (onHide) reader.saveProgressOnHide(contentRef.value.scrollTop, anchor)
  else reader.saveProgress(contentRef.value.scrollTop, anchor)
}

// 切换章节前调用：取消尚未执行的保存与正在进行的位置恢复
function resetChapterPositionTracking() {
  clearTimeout(saveTimer)
  stopRestore?.()
}

function handleVisibilityChange() {
  if (document.visibilityState !== 'hidden') return
  if (isPdf.value || readerStore.settings.pageMode !== 'scroll') return
  clearTimeout(saveTimer)
  saveChapterPosition(true)
}

function handleScroll() {
  if (!contentRef.value) return
  if (!restoringPosition) updateToolbarOnScroll(contentRef.value.scrollTop)

  if (readerStore.settings.pageMode === 'waterfall') {
    // 每帧最多处理一次，避免每个 scroll 事件都遍历章节 DOM
    if (scrollRaf) return
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = 0
      if (contentRef.value) handleWaterfallScroll(contentRef.value.scrollTop)
    })
  } else {
    if (restoringPosition || reader.loading.value) return
    // 延迟保存，并绑定滚动时所在的章节：期间若已切换章节则放弃，避免把旧位置记到新章节上
    const chapterAtScroll = reader.currentChapterIndex.value
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      if (chapterAtScroll === reader.currentChapterIndex.value) saveChapterPosition()
    }, SAVE_DELAY_MS)
  }
}

function handleWaterfallScroll(scrollTop: number) {
  const container = contentRef.value!
  const chapterEls = container.querySelectorAll<HTMLElement>('[data-chapter-index]')
  const viewportMid = scrollTop + container.clientHeight / 2
  let visibleIdx = reader.currentChapterIndex.value
  for (const el of chapterEls) {
    if (el.offsetTop <= viewportMid) {
      visibleIdx = parseInt(el.getAttribute('data-chapter-index') || '0')
    }
  }

  // When entering a new chapter, immediately save (chapterIdx, scrollTop=0).
  // This ensures exit-right-after-chapter-entry always restores to chapter beginning.
  if (visibleIdx !== reader.currentChapterIndex.value) {
    reader.currentChapterIndex.value = visibleIdx
    reader.saveProgress(0)  // fire-and-forget
  }

  // Auto-load next chapter when near bottom
  const nearBottom = scrollTop + container.clientHeight >= container.scrollHeight - 300
  if (nearBottom && hasMoreChapters.value && !waterfallLoading.value) {
    const nextIndex = waterfallChapters.value[waterfallChapters.value.length - 1].index + 1
    loadWaterfallChapter(nextIndex).then(trimWaterfallTop).then(() => fillWaterfallIfNeeded())
  }
}

// ── EPUB internal link interception ─────────────────────────
// Build a map from href basename to chapter index for EPUB link navigation.
// EPUB internal links look like "part0004.html" or "text/part0004.html".
// We normalise to just the filename to handle both forms.
function buildHrefIndexMap(): Map<string, number> {
  const map = new Map<string, number>()
  for (const ch of reader.chapters.value) {
    if (ch.href) {
      map.set(ch.href, ch.index)
      // Also index by basename only (strip directory prefix)
      const base = ch.href.split('/').pop()
      if (base && base !== ch.href) map.set(base, ch.index)
    }
  }
  return map
}

function handleContentClick(e: MouseEvent) {
  const target = (e.target as HTMLElement).closest('a')
  if (!target) return
  const href = target.getAttribute('href')
  if (!href) return
  // Allow external links to open normally
  if (/^https?:\/\//i.test(href)) return
  // Strip anchor to get the file path
  const hrefBase = href.split('#')[0]
  if (!hrefBase) return
  e.preventDefault()
  e.stopPropagation()
  const hrefMap = buildHrefIndexMap()
  // Try full path first, then basename
  const base = hrefBase.split('/').pop() || hrefBase
  const idx = hrefMap.get(hrefBase) ?? hrefMap.get(base)
  if (idx !== undefined) {
    jumpToChapter(idx)
  }
}

// ── Chapter navigation (scroll mode) ────────────────────────
async function goToPrevChapter() {
  resetChapterPositionTracking()
  await reader.prevChapter()
  await nextTick()
  if (contentRef.value) contentRef.value.scrollTop = 0
}

async function goToNextChapter() {
  resetChapterPositionTracking()
  await reader.nextChapter()
  await nextTick()
  if (contentRef.value) contentRef.value.scrollTop = 0
}

async function jumpToChapter(index: number) {
  tocVisible.value = false
  resetChapterPositionTracking()
  if (readerStore.settings.pageMode === 'waterfall') {
    // In waterfall, reset to the selected chapter
    reader.currentChapterIndex.value = index
    resetWaterfall()
    await loadWaterfallChapter(index)
    await nextTick()
    if (contentRef.value) contentRef.value.scrollTop = 0
    await fillWaterfallIfNeeded()
  } else {
    // 被更新的切章请求取代时，不保存进度也不调整滚动
    if (!await reader.loadChapter(index)) return
    await reader.saveProgress(0)
    await nextTick()
    if (contentRef.value) contentRef.value.scrollTop = 0
  }
}

// 瀑布流模式下容器里同时有多个章节，书签保存相对当前章节顶部的偏移
function getWaterfallChapterTop(index: number): number {
  const el = contentRef.value?.querySelector<HTMLElement>(`[data-chapter-index="${index}"]`)
  return el ? el.offsetTop : 0
}

async function handleAddBookmark() {
  const scrollTop = contentRef.value?.scrollTop || 0
  const offset = readerStore.settings.pageMode === 'waterfall'
    ? getWaterfallChapterTop(reader.currentChapterIndex.value)
    : 0
  await reader.addBookmark(Math.max(0, scrollTop - offset))
}

async function jumpToBookmark(chapterIndex: number, scrollTop: number) {
  tocVisible.value = false
  if (readerStore.settings.pageMode === 'waterfall') {
    reader.currentChapterIndex.value = chapterIndex
    resetWaterfall()
    await loadWaterfallChapter(chapterIndex)
    await nextTick()
    await document.fonts.ready
    if (contentRef.value) {
      contentRef.value.scrollTop = getWaterfallChapterTop(chapterIndex) + scrollTop
    }
    await fillWaterfallIfNeeded()
    return
  }
  // 不同章节才重新加载；同章节只需滚动，跳过会导致 scrollTop 归零的 loading 切换
  if (chapterIndex !== reader.currentChapterIndex.value) {
    if (!await reader.loadChapter(chapterIndex)) return
  }
  await nextTick()
  // 等待网络字体渲染完成，否则字体换行导致布局偏移后 scrollTop 失效
  await document.fonts.ready
  const el = contentRef.value
  if (!el) return
  // 读取 scrollHeight 强制同步 layout，再赋值
  void el.scrollHeight
  el.scrollTop = scrollTop
  // 再补一帧兜底（字体 fallback 可能还有一次 reflow）
  requestAnimationFrame(() => {
    el.scrollTop = scrollTop
  })
}

const bookProgress = computed(() => {
  const total = reader.chapters.value.length
  return total ? `${((reader.currentChapterIndex.value + 1) / total) * 100}%` : '0%'
})
// 多层目录（套装 EPUB、TXT 分卷）按树折叠显示；单层目录与原来的平铺列表一致
const tocTree = computed(() => buildTocTree(reader.chapters.value))
const tocExpanded = ref(new Set<number>())
const tocRows = computed(() => visibleTocRows(tocTree.value, tocExpanded.value, tocReversed.value))

function tocTitle(index: number) {
  const title = reader.chapters.value[index]?.title
  if (title) return title
  // 没有标题的页挂在有标题的条目下（漫画 EPUB：话 → 各页），显示为该条目内的页码
  const node = tocTree.value[tocTree.value.pos.get(index) ?? -1]
  if (node && node.parent !== null && node.parent >= 0) return `第 ${index - node.parent + 1} 页`
  return `第 ${index + 1} ${unitLabel.value}`
}

function toggleTocNode(index: number) {
  const next = new Set(tocExpanded.value)
  if (next.has(index)) next.delete(index)
  else next.add(index)
  tocExpanded.value = next
}

// 打开目录时只展开当前章节所在的那一支（分组行的 index 为负数，TXT「第一部 小丑」这类不是章节的分组）
function expandTocToCurrent() {
  if (!tocTree.value.hasNesting) return
  tocExpanded.value = new Set(tocAncestors(tocTree.value, reader.currentChapterIndex.value))
}
const tocStatus = computed(() =>
  [bookFinished.value ? '已完结' : '', `共${reader.chapters.value.length}${unitLabel.value}`].filter(Boolean).join(' · '))

// 点「目录 / 书签」：同一个 Tab 再点一次关闭，否则打开并切到该 Tab
function openToc(tab: 'toc' | 'bookmark') {
  if (tocVisible.value && tocTab.value === tab) {
    tocVisible.value = false
    return
  }
  tocTab.value = tab
  tocVisible.value = true
  if (tab === 'toc') expandTocToCurrent()
  scrollTocToCurrent()
}

function switchTocTab(tab: 'toc' | 'bookmark') {
  tocTab.value = tab
  if (tab === 'toc') expandTocToCurrent()
  scrollTocToCurrent()
}

// 打开时把当前章节滚到可视区域中间
function scrollTocToCurrent() {
  nextTick(() => {
    if (tocTab.value === 'toc') {
      tocBodyRef.value?.querySelector<HTMLElement>('.toc-link.current')?.scrollIntoView({ block: 'center', behavior: 'instant' })
    } else if (tocBodyRef.value) {
      tocBodyRef.value.scrollTop = 0
    }
  })
}

// ── AI：前情提要 / 问书（只用当前位置之前的内容）──────────────
const aiReady = ref(false)
const recapVisible = ref(false)
const recapAwayDays = ref<number | null>(null)
const recapLoading = ref(false)
const recapText = ref('')
const recapError = ref('')
const recapRange = ref('')
let recapKey = ''
const askVisible = ref(false)
const askMessages = ref<AskMessage[]>([])
const askDraft = ref('')
const askBusy = ref(false)
const askBodyRef = ref<HTMLElement | null>(null)
const ASK_SUGGESTIONS = ['前情提要', '上一章讲了什么？', '现在出场的主要人物有哪些？']

// 当前阅读位置：章节 + 屏幕顶部所在段落（瀑布流在当前章节的区块里找）
function currentReadingPosition() {
  const chapterIndex = reader.currentChapterIndex.value
  if (readerStore.settings.pageMode === 'scroll') return { chapterIndex, paragraphIndex: getCurrentAnchor().paragraphIndex }
  const container = contentRef.value
  const content = container?.querySelector<HTMLElement>(`[data-chapter-index="${chapterIndex}"] .chapter-content`)
  if (!container || !content) return { chapterIndex, paragraphIndex: 0 }
  const viewTop = container.getBoundingClientRect().top
  const blocks = Array.from(content.querySelectorAll<HTMLElement>(ANCHOR_SELECTOR))
  const i = blocks.findIndex(b => b.getBoundingClientRect().bottom > viewTop)
  return { chapterIndex, paragraphIndex: i < 0 ? Math.max(0, blocks.length - 1) : i }
}

function aiErrorMessage(err: unknown, fallback: string): string {
  const e = err as { response?: { data?: { message?: string } }; code?: string }
  if (e.code === 'ECONNABORTED') return 'AI 响应超时，请稍后再试'
  return e.response?.data?.message || fallback
}

async function fetchRecap(): Promise<{ text: string; range: string }> {
  const pos = currentReadingPosition()
  const resp = await readerApi.recap(bookId, pos.chapterIndex, pos.paragraphIndex)
  const data = resp.data.data!
  const range = data.chapters.length > 1 ? `${data.chapters[0]} — ${data.chapters[data.chapters.length - 1]}` : (data.chapters[0] || '')
  return { text: data.content, range }
}

function toggleRecap() {
  if (recapVisible.value) { recapVisible.value = false; return }
  // 位置变了就重新回顾
  const pos = currentReadingPosition()
  const key = `${pos.chapterIndex}:${pos.paragraphIndex}`
  if (key !== recapKey) { recapText.value = ''; recapError.value = ''; recapRange.value = '' }
  recapAwayDays.value = null
  recapVisible.value = true
}

async function loadRecap() {
  if (recapLoading.value) return
  recapLoading.value = true
  recapError.value = ''
  try {
    const pos = currentReadingPosition()
    const r = await fetchRecap()
    recapText.value = r.text
    recapRange.value = r.range
    recapKey = `${pos.chapterIndex}:${pos.paragraphIndex}`
  } catch (err) {
    recapError.value = aiErrorMessage(err, '生成前情提要失败')
  } finally {
    recapLoading.value = false
  }
}

function openAsk() {
  askVisible.value = !askVisible.value
}

function scrollAskToBottom() {
  nextTick(() => {
    const el = askBodyRef.value
    if (el) el.scrollTop = el.scrollHeight
  })
}

// 追加一问一答：先显示「正在翻书」，结果回来后替换
async function runAsk(question: string, call: () => Promise<{ text: string; sources?: AskMessage['sources'] }>) {
  askBusy.value = true
  askMessages.value.push({ role: 'user', text: question }, { role: 'ai', text: '', pending: true })
  const reply = askMessages.value[askMessages.value.length - 1]
  scrollAskToBottom()
  try {
    const r = await call()
    Object.assign(reply, { text: r.text, sources: r.sources, pending: false })
  } catch (err) {
    Object.assign(reply, { text: aiErrorMessage(err, '问书失败，请稍后再试'), pending: false, error: true })
  } finally {
    askBusy.value = false
    scrollAskToBottom()
  }
}

function sendAsk(preset?: string) {
  const question = (preset ?? askDraft.value).trim()
  if (!question || askBusy.value) return
  if (!preset) askDraft.value = ''
  const history = askHistory(askMessages.value)
  const pos = currentReadingPosition()
  return runAsk(question, async () => {
    const resp = await readerApi.ask(bookId, { question, ...pos, history })
    return { text: resp.data.data!.answer, sources: resp.data.data!.sources }
  })
}

function askRecap() {
  if (askBusy.value) return
  return runAsk('前情提要', async () => ({ text: (await fetchRecap()).text }))
}

// Enter 发送，Shift+Enter 换行；输入法选词时的回车不发送
function onAskEnter(e: KeyboardEvent) {
  if (e.shiftKey || e.isComposing) return
  e.preventDefault()
  sendAsk()
}

// ── 听书：开启了 MiniMax 听书用 MiniMax 语音，否则用浏览器自带语音 ────
const ttsReady = ref(false)
const browserSpeech = typeof window !== 'undefined' && 'speechSynthesis' in window
const listenAvailable = computed(() => (ttsReady.value || browserSpeech) && !isPdfRender.value)

// 当前章节的段落元素（与阅读位置同一套段落）；瀑布流取当前章节的区块
function listenChapter() {
  const idx = reader.currentChapterIndex.value
  const content = readerStore.settings.pageMode === 'scroll'
    ? contentRef.value?.querySelector<HTMLElement>('.chapter-content')
    : contentRef.value?.querySelector<HTMLElement>(`[data-chapter-index="${idx}"] .chapter-content`)
  if (!content) return null
  const blocks = Array.from(content.querySelectorAll<HTMLElement>(ANCHOR_SELECTOR))
  return { title: reader.chapters.value[idx]?.title || chapterTitle.value, blocks: blocks.length ? blocks : [content] }
}

// 从屏幕上第一个完整可见的段落开始念（避开顶栏；进度锚点可能是大半已滚出屏幕的段落）
function listenStartBlock(): number {
  const blocks = listenChapter()?.blocks || []
  const container = contentRef.value
  if (!container || blocks.length === 0) return 0
  const nav = container.querySelector<HTMLElement>('.reader-nav')
  const navBottom = toolbarVisible.value && nav ? nav.getBoundingClientRect().bottom : container.getBoundingClientRect().top
  const i = blocks.findIndex(b => !b.hidden && b.getBoundingClientRect().top >= navBottom - 4)
  // 长段落占满整屏时，下一段在屏幕之外：从当前这段开始
  if (i >= 0 && blocks[i].getBoundingClientRect().top < window.innerHeight * 0.6) return i
  return currentReadingPosition().paragraphIndex
}

const listen = useListen({
  bookId,
  chapter: listenChapter,
  startBlock: listenStartBlock,
  nextChapter: async () => {
    const next = reader.currentChapterIndex.value + 1
    if (next >= reader.chapters.value.length) return false
    await jumpToChapter(next)
    await nextTick()
    return true
  },
  meta: () => ({ title: chapterTitle.value, artist: [bookTitle.value, bookAuthor.value].filter(Boolean).join(' · '), artwork: bookCover.value || undefined }),
  useAi: () => ttsReady.value,
})
const {
  active: listenActive, playing: listenPlaying, loading: listenLoading, error: listenError,
  rate: listenRate, sleepMode: listenSleepMode, sleepLeft: listenSleepLeft, mode: listenMode,
} = listen

const sleepLabel = computed(() => {
  if (listenSleepMode.value === 'chapter') return '本章结束'
  return listenSleepMode.value ? listenSleepLeft.value : '定时'
})
const listenStatus = computed(() => {
  if (listenError.value) return listenError.value
  if (listenLoading.value) return '正在合成语音…'
  // 浏览器语音时提示可换用 MiniMax 获得更自然的声音
  const engine = listenMode.value === 'browser' ? '浏览器语音 · ' : ''
  if (!listenPlaying.value) return `${engine}已暂停`
  if (listenSleepMode.value === 'chapter') return `${engine}正在朗读 · 本章结束后停止`
  return listenSleepMode.value ? `${engine}正在朗读 · ${listenSleepLeft.value} 后停止` : `${engine}正在朗读`
})

function toggleListen() {
  if (listenActive.value) listen.stop()
  else listen.start()
}

// 章节翻页模式下手动换章：从新章节开头接着念（听书自己换章时跳过）
watch(() => reader.currentContent.value, () => {
  if (readerStore.settings.pageMode !== 'scroll' || !listenActive.value || listen.isAdvancing()) return
  nextTick(() => listen.restartFromChapterTop())
})

// 「夜间」按钮：浅色主题切到夜间，深色主题切回靛青
const nightMode = computed(() => isDarkReaderTheme(readerStore.settings.theme))
function toggleNight() {
  readerStore.applyTheme(nightToggleTheme(readerStore.settings.theme))
}

// ── Settings ─────────────────────────────────────────────────
function saveSettings() {
  readerStore.updateSettings(readerStore.settings)
}

async function setPageMode(mode: 'scroll' | 'waterfall') {
  resetChapterPositionTracking()
  listen.stop()
  readerStore.updateSettings({ pageMode: mode })
  if (mode === 'waterfall') {
    await initWaterfall()
  } else {
    // Reload current chapter in scroll mode
    await reader.loadChapter(reader.currentChapterIndex.value)
    await nextTick()
    if (contentRef.value) contentRef.value.scrollTop = 0
  }
}

// ── Lifecycle ────────────────────────────────────────────────
// 取屏幕坐标处文字所在行的顶部（Chrome / Safari 用 caretRangeFromPoint，Firefox 用 caretPositionFromPoint）
function lineTopAtPoint(x: number, y: number, container: Element): number | null {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
  }
  let node: Node | null = null
  let offset = 0
  if (doc.caretPositionFromPoint) {
    const pos = doc.caretPositionFromPoint(x, y)
    if (pos) { node = pos.offsetNode; offset = pos.offset }
  } else if (document.caretRangeFromPoint) {
    const r = document.caretRangeFromPoint(x, y)
    if (r) { node = r.startContainer; offset = r.startOffset }
  }
  if (!node || node.nodeType !== Node.TEXT_NODE || !container.contains(node)) return null
  const len = node.textContent?.length ?? 0
  if (len === 0) return null
  const range = document.createRange()
  const start = Math.min(offset, len - 1)
  range.setStart(node, start)
  range.setEnd(node, start + 1)
  const rect = range.getClientRects()[0]
  return rect && rect.height > 0 ? rect.top : null
}

// 下翻：把距屏幕底部约两行的那一行对齐到顶部；找不到文字（如 PDF 页面图）时按固定距离
function textAlignedPageDistance(el: HTMLElement, lineHeightPx: number): number {
  const fallback = pageScrollDistance(el.clientHeight, lineHeightPx)
  const box = el.getBoundingClientRect()
  const contents = [...el.querySelectorAll<HTMLElement>('.chapter-content')]
  const target = box.bottom - lineHeightPx * 1.5
  // 测量点可能落在段落间距里，浏览器会返回远处的文字：在目标附近多试几个点，
  // 只接受确实位于「底部倒数第二行」附近的行，否则按固定距离翻
  for (const dy of [0, -lineHeightPx / 2, lineHeightPx / 2, -lineHeightPx]) {
    const y = target + dy
    const content = contents.find(c => { const r = c.getBoundingClientRect(); return r.top <= y && r.bottom >= y })
    if (!content) continue
    const lineTop = lineTopAtPoint(content.getBoundingClientRect().left + lineHeightPx, y, content)
    if (lineTop != null && lineTop >= target - lineHeightPx * 1.5 && lineTop <= target + lineHeightPx * 0.5) {
      return alignedPageDistance(lineTop, box.top, el.clientHeight)
    }
  }
  return fallback
}

function handleKeydown(e: KeyboardEvent) {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
  if ((e.target as HTMLElement | null)?.isContentEditable) return
  // 原生 PDF（浏览器内置查看器）或侧边抽屉打开时不处理
  if (e.key === 'Escape' && (tocVisible.value || askVisible.value)) {
    tocVisible.value = false
    askVisible.value = false
    return
  }
  if (isPdf.value || settingsPanelVisible.value || tocVisible.value || askVisible.value) return
  const action = readerKeyAction(e)
  if (!action) return
  e.preventDefault()
  const current = reader.currentChapterIndex.value
  const last = reader.chapters.value.length - 1
  const waterfall = readerStore.settings.pageMode === 'waterfall'
  switch (action) {
    case 'prevChapter':
      if (current > 0) waterfall ? jumpToChapter(current - 1) : goToPrevChapter()
      break
    case 'nextChapter':
      if (current < last) waterfall ? jumpToChapter(current + 1) : goToNextChapter()
      break
    case 'pageDown':
    case 'pageUp': {
      const el = contentRef.value
      if (!el) break
      // 顶部导航会盖住正文：翻屏时收起，且平滑滚动期间不因上滑重新弹出，保证衔接的行可见
      toolbarVisible.value = false
      keyPagingUntil = Date.now() + 800
      // 按屏翻页并保留两行正文作为衔接（行高随当前字号 / 行距变化）
      const lineHeightPx = readerStore.settings.fontSize * readerStore.settings.lineHeight
      const distance = action === 'pageDown'
        ? textAlignedPageDistance(el, lineHeightPx)
        : pageScrollDistance(el.clientHeight, lineHeightPx)
      el.scrollBy({ top: action === 'pageDown' ? distance : -distance, behavior: 'smooth' })
      break
    }
    case 'bookmark':
      if (!e.repeat) handleAddBookmark()  // 按住不放不重复添加
      break
  }
}

onMounted(async () => {
  window.addEventListener('keydown', handleKeydown)
  document.addEventListener('visibilitychange', handleVisibilityChange)
  loadBookInfo()
  refreshShelf()
  const aiStatus = settingsApi.getAiStatus().then(r => {
    aiReady.value = !!r.data.data?.configured
    ttsReady.value = !!r.data.data?.tts_enabled
  }).catch(() => {})
  await readerStore.loadPrefs()
  await reader.loadChapters()

  if (isPdf.value) {
    await loadPdfBlob()
    return
  }
  // 文件下载与进度读取并行，页面在文档就绪后自动渲染
  if (isPdfRender.value) loadPdfDocument()

  await reader.loadProgress()
  reader.loadBookmarks()
  // 隔了几天再打开：提示前情提要（不自动调用 AI）
  aiStatus.then(() => {
    const p = reader.progress.value
    if (shouldOfferRecap(p, aiReady.value)) {
      recapAwayDays.value = daysSince(p.updatedAt)
      recapVisible.value = true
    }
  })

  if (readerStore.settings.pageMode === 'waterfall') {
    await initWaterfall()
  } else {
    // 打开时用户若已切到别的章节，不再恢复旧进度位置
    if (!await reader.loadChapter(reader.progress.value.chapterIndex)) return
    await restoreChapterPosition({
      paragraphIndex: reader.progress.value.paragraphIndex ?? 0,
      paragraphOffset: reader.progress.value.paragraphOffset ?? 0,
    })
  }
})

onBeforeUnmount(() => {
  clearTimeout(saveTimer)
  // 位置尚未恢复完成就离开时不保存，避免用 0 覆盖原有进度
  const wasRestoring = restoringPosition
  stopRestore?.()
  if (!isPdf.value && !reader.loading.value && !wasRestoring) {
    if (readerStore.settings.pageMode === 'scroll') saveChapterPosition()
    else reader.saveProgress(0)
  }
})

onUnmounted(() => {
  cancelAnimationFrame(scrollRaf)
  window.removeEventListener('keydown', handleKeydown)
  document.removeEventListener('visibilitychange', handleVisibilityChange)
  if (pdfBlobUrl.value) URL.revokeObjectURL(pdfBlobUrl.value)
  pdfDoc.value?.loadingTask.destroy()
})
</script>

<style scoped>
.reader-page {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transition: background-color 0.3s ease, color 0.3s ease;
}

/* ── 阅读区：浅灰底 + 居中白色卡片（与网站靛青主题一致）── */
.reader-content {
  flex: 1;
  overflow-y: auto;
  overflow-anchor: none;
  background: var(--reader-page-bg);
  transition: background-color 0.3s ease;
}
/* 滚动条跟随阅读配色（全站滚动条轨道用的是网站主题底色，会在右侧露出一条异色） */
.reader-content::-webkit-scrollbar-track { background: var(--reader-page-bg); }
.reader-content::-webkit-scrollbar-thumb { background: color-mix(in srgb, var(--reader-text) 22%, transparent); }
.reader-content::-webkit-scrollbar-thumb:hover { background: var(--reader-text-secondary); }

/* 顶栏：横跨全屏的毛玻璃条，吸顶；下滑隐藏、上滑显示 */
.reader-nav {
  position: sticky;
  top: 0;
  z-index: 10;
  background: color-mix(in srgb, var(--reader-paper-bg) 82%, transparent);
  backdrop-filter: saturate(1.4) blur(12px);
  border-bottom: 1px solid var(--reader-divider);
  font-family: var(--font-sans);
  transition: transform 300ms ease;
}
.reader-nav.hidden { transform: translateY(-100%); }
.nav-inner {
  width: var(--paper-w);
  height: 56px;
  margin: 0 auto;
  display: flex;
  align-items: center;
  gap: 10px;
}
.nav-title {
  flex: 1;
  min-width: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--reader-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.nav-progress {
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  color: var(--reader-text-secondary);
  white-space: nowrap;
}
/* 全书进度细条 */
.nav-bar {
  position: absolute;
  left: 0;
  right: 0;
  bottom: -1px;
  height: 2px;
}
.nav-bar i {
  display: block;
  height: 100%;
  background: var(--reader-accent);
  transition: width 0.3s ease;
}
.nav-actions { display: none; gap: 2px; }
.nav-btn,
.side-tool,
.end-btn {
  border: none;
  background: transparent;
  color: var(--reader-text-secondary);
  cursor: pointer;
  font-family: var(--font-sans);
  transition: color 0.15s ease, background-color 0.15s ease, border-color 0.15s ease;
}
.nav-btn {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.nav-btn:hover { color: var(--reader-text); background: var(--reader-hover-bg); }

/* 纸张：白色卡片，细边框 + 柔和阴影 */
.paper {
  position: relative;
  margin: 28px auto 64px;
  min-height: calc(100% - 120px);
  padding: 48px 72px 56px;
  background: var(--reader-paper-bg);
  border: 1px solid var(--reader-divider);
  border-radius: 16px;
  box-shadow: 0 1px 2px rgba(26, 36, 64, 0.04), 0 4px 16px rgba(26, 36, 64, 0.05);
  transition: width 0.2s ease, background-color 0.3s ease;
}

/* 右侧工具栏：纸张右外侧的竖向胶囊，垂直居中 */
.side-tools {
  position: fixed;
  top: 50%;
  left: calc(50% + var(--paper-w) / 2 + 16px);
  transform: translateY(-50%);
  z-index: 30;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 6px;
  background: var(--reader-panel-bg);
  border: 1px solid var(--reader-divider);
  border-radius: 14px;
  box-shadow: var(--reader-panel-shadow);
}
.side-tool {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.side-tool:hover { color: var(--reader-text); background: var(--reader-hover-bg); }
.side-tool.on { color: var(--reader-accent); background: var(--reader-accent-weak); }
.side-sep {
  width: 20px;
  height: 1px;
  margin: 4px 0;
  background: var(--reader-divider);
}

/* 章节标题区：左对齐，上方强调色小标「第 N 章」，下方分隔线 */
.chapter-head {
  padding-bottom: 24px;
  border-bottom: 1px solid var(--reader-divider);
}
.chapter-eyebrow {
  font-family: var(--font-sans);
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.06em;
  color: var(--reader-accent);
}
.chapter-heading {
  margin: 8px 0 0;
  font-family: var(--reader-font);
  font-size: 30px;
  line-height: 1.35;
  font-weight: 700;
  color: var(--reader-text);
}
.chapter-meta {
  margin-top: 10px;
  font-family: var(--font-sans);
  font-size: 13px;
  color: var(--reader-text-secondary);
}

/* 正文：段距用 em，随字号同比缩放 */
.chapter-content {
  margin-top: 1.2em;
  color: var(--reader-text);
  transition: font-size 0.2s ease, line-height 0.2s ease;
}
.chapter-content :deep(p) {
  margin: 0.9em 0 0;
  text-indent: 2em;
}
/* 正文图片不超出纸张：EPUB 常写死内联宽高（如 width:1200px），这里覆盖 */
.chapter-content :deep(img) {
  max-width: 100% !important;
  height: auto !important;
}
.chapter-content :deep(svg) {
  max-width: 100%;
  height: auto;
}
/* 纯图片页（漫画）：整页缩放到一屏内居中显示，去掉内联外边距与缩进 */
.chapter-content.image-page { margin-top: 0; }
.chapter-content.image-page :deep(p) { margin: 0; text-indent: 0; }
.chapter-content.image-page :deep(img),
.chapter-content.image-page :deep(svg) {
  display: block;
  width: auto !important;
  max-height: calc(100vh - 96px) !important;
  margin: 0 auto !important;
}
.chapter-content.image-page :deep(svg) { width: 100% !important; }
/* 适合宽度：铺满纸张宽度，不限高度（上下滚动看） */
.chapter-content.image-page.fit-width :deep(img),
.chapter-content.image-page.fit-width :deep(svg) {
  width: 100% !important;
  max-height: none !important;
}

/* 章末导航：上一章 / 目录 为描边按钮，下一章为主色按钮 */
.chapter-end {
  display: flex;
  justify-content: center;
  gap: 12px;
  margin-top: 56px;
  padding-top: 32px;
  border-top: 1px solid var(--reader-divider);
}
.end-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 40px;
  padding: 0 18px;
  border: 1px solid var(--reader-divider);
  border-radius: 10px;
  font-size: 14px;
  font-weight: 500;
  color: var(--reader-text-2);
}
.end-btn:hover:not(:disabled) { color: var(--reader-accent); border-color: var(--reader-accent); }
.end-btn.primary {
  border-color: var(--reader-accent);
  background: var(--reader-accent);
  color: var(--reader-on-accent);
}
.end-btn.primary:hover:not(:disabled) { color: var(--reader-on-accent); filter: brightness(1.08); }
.end-btn:disabled { opacity: 0.4; cursor: not-allowed; }

/* PDF 逐页渲染：失败提示居中显示 */
.pdf-chapter { margin-top: 0; }
.pdf-chapter .pdf-error { padding: 80px 0; }

/* ── 瀑布流：章节之间用分隔线，第一章不加 ── */
.waterfall-chapter + .waterfall-chapter {
  margin-top: 64px;
  padding-top: 48px;
  border-top: 1px solid var(--reader-divider);
}
/* 漫画连续两页之间只留窄缝，不加分隔线 */
.waterfall-chapter:has(> .image-page) + .waterfall-chapter:has(> .image-page:first-child) {
  margin-top: 12px;
  padding-top: 0;
  border-top: none;
}
.waterfall-loading,
.waterfall-end {
  text-align: center;
  padding: 32px 0;
  font-size: 13px;
  color: var(--reader-text-secondary);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

/* ── 目录抽屉：左侧滑出 ── */
.toc-layer {
  position: fixed;
  inset: 0;
  z-index: 40;
  background: rgba(15, 23, 42, 0.18);
}
.toc-panel {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: min(400px, 100%);
  display: flex;
  flex-direction: column;
  background: var(--reader-panel-bg);
  box-shadow: var(--reader-panel-shadow);
  color: var(--reader-text);
  font-family: var(--font-sans);
}
.toc-enter-active,
.toc-leave-active { transition: opacity 200ms ease; }
.toc-enter-active .toc-panel,
.toc-leave-active .toc-panel { transition: transform 200ms ease; }
.toc-enter-from,
.toc-leave-to { opacity: 0; }
.toc-enter-from .toc-panel,
.toc-leave-to .toc-panel { transform: translateX(-24px); }

.toc-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 16px 0 20px;
}
/* 分段切换：目录 / 书签 */
.toc-seg {
  display: inline-flex;
  padding: 3px;
  border-radius: 10px;
  background: var(--reader-active-bg);
}
.toc-seg button {
  min-width: 72px;
  height: 32px;
  padding: 0 14px;
  border: none;
  border-radius: 8px;
  background: transparent;
  font-family: inherit;
  font-size: 14px;
  font-weight: 500;
  color: var(--reader-text-secondary);
  cursor: pointer;
  transition: background-color 0.15s ease, color 0.15s ease;
}
.toc-seg button.active {
  background: var(--reader-panel-bg);
  color: var(--reader-text);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}
.toc-icon-btn {
  width: 34px;
  height: 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 10px;
  background: transparent;
  color: var(--reader-text-secondary);
  cursor: pointer;
}
.toc-icon-btn:hover { color: var(--reader-text); background: var(--reader-hover-bg); }
.toc-sub {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px 10px 20px;
  border-bottom: 1px solid var(--reader-divider);
}
.toc-status {
  font-size: 13px;
  color: var(--reader-text-secondary);
  white-space: nowrap;
}
.toc-action {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 8px;
  border: none;
  border-radius: 8px;
  background: transparent;
  font-family: inherit;
  font-size: 13px;
  color: var(--reader-text-2);
  cursor: pointer;
  white-space: nowrap;
}
.toc-action:hover { color: var(--reader-accent); background: var(--reader-hover-bg); }

.toc-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
  padding: 8px 10px 24px;
}
.toc-body::-webkit-scrollbar { width: 6px; }
.toc-body::-webkit-scrollbar-track { background: transparent; }
.toc-body::-webkit-scrollbar-thumb { background: color-mix(in srgb, var(--reader-text) 16%, transparent); border-radius: 3px; }

/* 单列列表；当前章节：强调色浅底 + 左侧竖条（同网站侧栏选中样式） */
.toc-list { list-style: none; margin: 0; padding: 0; }
.toc-link {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 12px;
  border-radius: 8px;
  font-size: 14px;
  line-height: 22px;
  color: var(--reader-text);
  cursor: pointer;
}
.toc-link:hover { background: var(--reader-hover-bg); }
.toc-link:active { background: var(--reader-active-bg); }
.toc-link.read { color: var(--reader-text-secondary); }
.toc-link.current {
  color: var(--reader-accent);
  background: var(--reader-accent-weak);
  font-weight: 600;
}
.toc-link.current::before {
  content: '';
  position: absolute;
  left: 0;
  top: 8px;
  bottom: 8px;
  width: 3px;
  border-radius: 3px;
  background: var(--reader-accent);
}
.toc-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.toc-link.bookmark .toc-title { white-space: normal; }
.toc-link.nested { gap: 2px; }
.toc-caret {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--reader-text-secondary);
  cursor: pointer;
  transition: transform 0.15s ease;
}
.toc-caret:hover { background: var(--reader-active-bg); color: var(--reader-text); }
.toc-caret.open { transform: rotate(90deg); }
/* 没有下级的条目留出同样宽度，标题对齐 */
.toc-caret.leaf { visibility: hidden; pointer-events: none; }
/* 不是章节的分组行（如 TXT「第一部 小丑」）：点整行展开 / 收起 */
.toc-link.group { color: var(--reader-text-secondary); font-weight: 600; }
.toc-extra {
  display: block;
  margin-top: 2px;
  font-size: 12px;
  color: var(--reader-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.toc-del {
  flex-shrink: 0;
  display: inline-flex;
  padding: 5px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--reader-text-secondary);
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s ease;
}
.toc-link:hover .toc-del,
.toc-del:focus-visible { opacity: 1; }
.toc-del:hover { color: var(--danger); background: var(--reader-active-bg); }
.toc-empty {
  padding: 64px 16px;
  text-align: center;
  font-size: 13px;
  line-height: 1.8;
  color: var(--reader-text-secondary);
}

/* ── 听书 ── */
/* 正在朗读的段落 */
.chapter-content :deep(.tts-reading) {
  background: var(--reader-accent-weak);
  border-radius: 6px;
  box-shadow: 0 0 0 6px var(--reader-accent-weak);
  transition: background-color 0.2s ease;
}
/* 播放条出现时给正文底部留出空间 */
.paper.listening { padding-bottom: 140px; }
.listen-bar {
  position: fixed;
  left: 50%;
  bottom: calc(20px + env(safe-area-inset-bottom));
  z-index: 35;
  width: min(720px, calc(100% - 24px));
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px 10px 16px;
  background: var(--reader-panel-bg);
  border: 1px solid var(--reader-divider);
  border-radius: 16px;
  box-shadow: var(--reader-panel-shadow);
  font-family: var(--font-sans);
  color: var(--reader-text);
}
.player-enter-active,
.player-leave-active { transition: opacity 200ms ease, transform 200ms ease; }
.player-enter-from,
.player-leave-to { opacity: 0; transform: translate(-50%, 12px); }
.listen-info { flex: 1; min-width: 0; display: flex; align-items: center; gap: 10px; }
.listen-icon { flex-shrink: 0; color: var(--reader-accent); }
.listen-text { min-width: 0; }
.listen-title {
  font-size: 14px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.listen-status {
  margin-top: 2px;
  font-size: 12px;
  color: var(--reader-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.listen-status.error { color: var(--danger); }
.listen-hint {
  margin-top: 1px;
  font-size: 11px;
  color: var(--reader-text-secondary);
  opacity: 0.85;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.listen-controls,
.listen-extra { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
.listen-btn {
  width: 36px;
  height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 10px;
  background: transparent;
  color: var(--reader-text-2);
  cursor: pointer;
}
.listen-btn:hover { color: var(--reader-text); background: var(--reader-hover-bg); }
.listen-btn.main {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: var(--reader-accent);
  color: var(--reader-on-accent);
}
.listen-btn.main:hover { color: var(--reader-on-accent); background: var(--reader-accent); filter: brightness(1.08); }
.listen-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 30px;
  padding: 0 10px;
  border: 1px solid var(--reader-divider);
  border-radius: 999px;
  background: transparent;
  font-family: inherit;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: var(--reader-text-2);
  cursor: pointer;
}
.listen-chip:hover,
.listen-chip.on { color: var(--reader-accent); border-color: var(--reader-accent); }
.nav-btn.on { color: var(--reader-accent); }
/* 听书按钮的「AI」角标：使用 MiniMax AI 语音时显示，与浏览器语音区分 */
.side-tool,
.nav-btn { position: relative; }
.ai-badge {
  position: absolute;
  right: 3px;
  bottom: 4px;
  padding: 0 3px;
  border-radius: 4px;
  background: var(--reader-accent);
  box-shadow: 0 0 0 1.5px var(--reader-panel-bg);
  color: var(--reader-on-accent);
  font-family: var(--font-sans);
  font-size: 9px;
  font-weight: 700;
  line-height: 13px;
  letter-spacing: 0.02em;
  pointer-events: none;
}

/* ── 前情提要卡片：悬浮在顶栏下方，不随正文滚动 ── */
.recap-card {
  position: fixed;
  top: 72px;
  left: 50%;
  z-index: 35;
  width: min(560px, calc(100% - 24px));
  transform: translateX(-50%);
  padding: 16px 16px 16px 18px;
  background: var(--reader-panel-bg);
  border: 1px solid var(--reader-divider);
  border-radius: 14px;
  box-shadow: var(--reader-panel-shadow);
  font-family: var(--font-sans);
  color: var(--reader-text);
}
.recap-enter-active,
.recap-leave-active { transition: opacity 200ms ease, transform 200ms ease; }
.recap-enter-from,
.recap-leave-to { opacity: 0; transform: translate(-50%, -8px); }
.recap-head { display: flex; align-items: flex-start; gap: 10px; }
.recap-icon { flex-shrink: 0; margin-top: 2px; color: var(--reader-accent); }
.recap-heading { flex: 1; min-width: 0; }
.recap-title { font-size: 15px; font-weight: 600; }
.recap-sub {
  margin-top: 2px;
  font-size: 13px;
  color: var(--reader-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.recap-text {
  margin: 12px 0 0;
  max-height: 40vh;
  overflow: auto;
  font-family: var(--reader-font);
  font-size: 15px;
  line-height: 1.8;
  color: var(--reader-text-2);
}
.recap-error { font-family: var(--font-sans); font-size: 13px; color: var(--danger); }
.recap-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; margin-top: 14px; }
.recap-actions .end-btn { height: 36px; padding: 0 14px; }
.recap-hint { margin-top: 10px; font-size: 12px; color: var(--reader-text-secondary); }
.recap-actions .recap-hint { margin-top: 0; }

/* ── 问书：右侧对话面板（复用目录抽屉的外层与配色）── */
.ask-panel { left: auto; right: 0; width: min(420px, 100%); }
.ask-enter-active,
.ask-leave-active { transition: opacity 200ms ease; }
.ask-enter-active .ask-panel,
.ask-leave-active .ask-panel { transition: transform 200ms ease; }
.ask-enter-from,
.ask-leave-to { opacity: 0; }
.ask-enter-from .ask-panel,
.ask-leave-to .ask-panel { transform: translateX(24px); }
.ask-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 20px 16px 14px 20px;
  border-bottom: 1px solid var(--reader-divider);
}
.ask-title { display: flex; align-items: center; gap: 6px; font-size: 16px; font-weight: 600; }
.ask-title svg { color: var(--reader-accent); }
.ask-sub { margin-top: 4px; font-size: 12px; color: var(--reader-text-secondary); }
.ask-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.ask-body::-webkit-scrollbar { width: 6px; }
.ask-body::-webkit-scrollbar-track { background: transparent; }
.ask-body::-webkit-scrollbar-thumb { background: color-mix(in srgb, var(--reader-text) 16%, transparent); border-radius: 3px; }
.ask-empty { margin: auto 0; text-align: center; font-size: 13px; color: var(--reader-text-secondary); }
.ask-chips { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; margin-top: 12px; }
.ask-chips button {
  padding: 6px 12px;
  border: 1px solid var(--reader-divider);
  border-radius: 999px;
  background: transparent;
  font-family: inherit;
  font-size: 13px;
  color: var(--reader-text-2);
  cursor: pointer;
}
.ask-chips button:hover { color: var(--reader-accent); border-color: var(--reader-accent); }
.ask-msg { display: flex; flex-direction: column; max-width: 88%; }
.ask-msg.user { align-self: flex-end; align-items: flex-end; }
.ask-msg.ai { align-self: flex-start; }
.ask-bubble {
  padding: 9px 12px;
  border-radius: 12px;
  font-size: 14px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
}
.ask-msg.user .ask-bubble { background: var(--reader-accent); color: var(--reader-on-accent); border-bottom-right-radius: 4px; }
.ask-msg.ai .ask-bubble { background: var(--reader-active-bg); color: var(--reader-text); border-bottom-left-radius: 4px; }
.ask-msg.ai.error .ask-bubble { color: var(--danger); }
.ask-bubble .el-icon { vertical-align: -2px; }
.ask-sources { margin-top: 4px; font-size: 12px; color: var(--reader-text-secondary); }
.ask-input {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  margin: 0 12px 12px;
  padding: 8px 8px 8px 12px;
  border: 1px solid var(--reader-divider);
  border-radius: 12px;
  background: var(--reader-paper-bg);
}
.ask-input:focus-within { border-color: var(--reader-accent); }
.ask-input textarea {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  resize: none;
  background: transparent;
  font-family: inherit;
  font-size: 14px;
  line-height: 1.6;
  color: var(--reader-text);
}
.ask-input textarea::placeholder { color: var(--reader-text-secondary); }
.ask-send {
  flex-shrink: 0;
  width: 34px;
  height: 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 9px;
  background: var(--reader-accent);
  color: var(--reader-on-accent);
  cursor: pointer;
}
.ask-send:disabled { opacity: 0.35; cursor: not-allowed; }

/* 窄屏：纸张占满宽度，工具栏收进顶栏 */
@media (max-width: 768px) {
  .reader-content { --paper-w: 100%; }
  .paper { width: 100% !important; }
  .side-tools { display: none; }
  .nav-actions { display: flex; }
  .nav-inner { padding: 0 8px; }
}
/* 手机（<640px）：纸张去掉卡片外框 */
@media (max-width: 639px) {
  .paper {
    margin: 0;
    min-height: calc(100% - 56px);
    padding: 28px 20px 48px;
    border: none;
    border-radius: 0;
    box-shadow: none;
  }
  .nav-inner { gap: 4px; }
  .chapter-heading { font-size: 24px; }
  /* PDF 页面按原版缩放，尽量占满屏幕宽度 */
  .paper.pdf-wrapper { padding: 12px 6px 16px; }
  .toc-del { opacity: 1; }
  /* 顶栏按钮多，进度数字收起（顶栏底部的进度条仍在） */
  .nav-progress { display: none; }
  /* 播放条：信息一行，按钮一行 */
  .listen-bar { flex-wrap: wrap; gap: 8px; bottom: calc(10px + env(safe-area-inset-bottom)); }
  .listen-info { flex-basis: 100%; }
  .listen-controls { order: 2; }
  .listen-extra { order: 3; margin-left: auto; }
  .paper.listening { padding-bottom: 180px; }
}

/* ── Settings panel ── */
.settings-panel {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 8px 0;
}
.setting-group { display: flex; flex-direction: column; gap: 10px; }
.setting-label { font-size: 13px; color: var(--text-2); font-weight: 500; }

.mode-options { display: flex; gap: 8px; }
.mode-btn {
  flex: 1;
  padding: 8px;
  border-radius: var(--radius-md);
  border: 2px solid color-mix(in srgb, var(--reader-text) 20%, transparent);
  cursor: pointer;
  font-size: 13px;
  background: transparent;
  color: var(--text-1);
  transition: all 0.2s ease;
}
.mode-btn.active { border-color: var(--accent); color: var(--accent); }
.reset-btn { margin-top: 8px; border-radius: var(--radius-md); }

.theme-options {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}
.theme-btn {
  padding: 8px 4px;
  border-radius: var(--radius-md);
  cursor: pointer;
  font-size: 12px;
  font-family: var(--font-sans);
  transition: all 0.2s ease;
  text-align: center;
}

/* ── Progress ── */
.progress-info { font-size: 13px; color: var(--text-2); }

.content-loading { padding: 20px 0; }

/* ── PDF viewer ── */
.pdf-topbar {
  position: fixed;
  top: 0; left: 0; right: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  background: rgba(11, 16, 32, 0.92);
  backdrop-filter: blur(12px);
}

.pdf-topbar-title {
  font-size: 14px;
  color: var(--text-1);
}

.pdf-viewer-area {
  position: fixed;
  inset: 0;
  padding-top: 48px; /* below topbar */
  display: flex;
  align-items: center;
  justify-content: center;
  background: #525659;
}

.pdf-frame {
  width: 100%;
  height: 100%;
  border: none;
}

.pdf-loading,
.pdf-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  color: #ccc;
  font-size: 15px;
}

.pdf-loading .el-icon {
  font-size: 32px;
}

.shortcut-hint {
  margin-top: 16px;
  font-size: 12px;
  color: var(--text-2);
}
</style>
