import fs from 'fs';
import path from 'path';
import { marked } from 'marked';

// 开发时在仓库根目录 docs/，Docker 镜像中复制到 /app/docs/（dist 的上一级）
const CANDIDATES = [
  path.join(__dirname, '../../docs/api.md'),
  path.join(__dirname, '../../../docs/api.md'),
];

/** 读取 API 文档（docs/api.md），找不到时返回 null */
export function readApiDocs(): string | null {
  for (const file of CANDIDATES) {
    if (fs.existsSync(file)) return fs.readFileSync(file, 'utf-8');
  }
  return null;
}

/** 把文档渲染成独立的 HTML 页面（文档是仓库内自己维护的，不含用户输入） */
export function renderApiDocsPage(markdown: string): string {
  const body = marked.parse(markdown, { async: false }) as string;
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>easyReader API</title>
<style>
  :root { --bg: #eef1f6; --card: #fff; --border: #e8ecf4; --text: #1a2440; --muted: #5b6785; --accent: #4338ca; --code: #f4f6fb; }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #12151d; --card: #1a1f2b; --border: #2a3142; --text: #e3e7f0; --muted: #9aa3b8; --accent: #8b87f0; --code: #222838; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.7 "Noto Sans SC", system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 960px; margin: 24px auto; padding: 24px 32px; background: var(--card); border: 1px solid var(--border); border-radius: 16px; }
  h1, h2, h3 { line-height: 1.35; }
  h1 { margin-top: 0; }
  h2 { margin-top: 2em; padding-bottom: .3em; border-bottom: 1px solid var(--border); }
  h3 { margin-top: 1.6em; }
  a { color: var(--accent); }
  code { overflow-wrap: anywhere; background: var(--code); padding: .1em .35em; border-radius: 4px; font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  pre { background: var(--code); padding: 12px 14px; border-radius: 8px; overflow-x: auto; }
  pre code { padding: 0; background: none; overflow-wrap: normal; }
  table { border-collapse: collapse; width: 100%; display: block; overflow-x: auto; }
  th, td { border: 1px solid var(--border); padding: 6px 10px; text-align: left; vertical-align: top; }
  th { background: var(--code); white-space: nowrap; }
  blockquote { margin: 1em 0; padding: .2em 1em; border-left: 4px solid var(--accent); color: var(--muted); }
  @media (max-width: 640px) { main { margin: 0; padding: 16px; border-radius: 0; border: none; } }
</style>
</head>
<body><main>
${body}
</main></body>
</html>`;
}
