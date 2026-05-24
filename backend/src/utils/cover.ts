import https from 'https';
import http from 'http';
import fs from 'fs';
import path from 'path';

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../../data');
const COVERS_DIR = path.join(DATA_DIR, 'covers');

if (!fs.existsSync(COVERS_DIR)) {
  fs.mkdirSync(COVERS_DIR, { recursive: true });
}

function request(url: string, headers: Record<string, string> = {}, redirects = 4): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === 'https:' ? https : http;
    const req = lib.request({
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        ...headers,
      },
      timeout: 12000,
    }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode!) && res.headers.location && redirects > 0) {
        const next = res.headers.location.startsWith('http')
          ? res.headers.location
          : `${parsed.protocol}//${parsed.hostname}${res.headers.location}`;
        res.resume();
        resolve(request(next, headers, redirects - 1));
        return;
      }
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

interface DoubanSuggest {
  url?: string;
  pic?: string;
  title?: string;
  author_name?: string;
  year?: string;
}

function saveDebug(bookId: string, info: Record<string, unknown>) {
  try {
    fs.writeFileSync(path.join(COVERS_DIR, `${bookId}.json`), JSON.stringify(info, null, 2));
  } catch (e) {
    console.error('[cover] 写调试文件失败:', e);
  }
}

export async function fetchAndSaveCover(title: string, bookId: string): Promise<string | undefined> {
  const debug: Record<string, unknown> = {
    title,
    bookId,
    coversDir: COVERS_DIR,
    startedAt: new Date().toISOString(),
  };

  // 第一次写入，确认函数被调用且目录可写
  saveDebug(bookId, debug);

  try {
    // Step 1: 豆瓣 suggest API
    const apiUrl = `https://book.douban.com/j/subject_suggest?q=${encodeURIComponent(title)}`;
    debug.apiUrl = apiUrl;
    saveDebug(bookId, debug);

    const buf = await request(apiUrl, {
      'Accept': 'application/json, text/javascript, */*',
      'Referer': 'https://book.douban.com/',
    });

    const rawText = buf.toString('utf-8');
    debug.rawResponse = rawText;
    debug.rawLength = rawText.length;
    saveDebug(bookId, debug);

    let suggestions: DoubanSuggest[] = [];
    try {
      suggestions = JSON.parse(rawText);
    } catch (e) {
      debug.parseError = String(e);
      saveDebug(bookId, debug);
      return undefined;
    }

    debug.suggestionCount = Array.isArray(suggestions) ? suggestions.length : 'not array';
    debug.suggestions = suggestions;
    saveDebug(bookId, debug);

    if (!Array.isArray(suggestions) || suggestions.length === 0) return undefined;

    const item = suggestions.find(s => s.pic && !s.pic.includes('book-default'));
    debug.selectedItem = item ?? null;
    saveDebug(bookId, debug);

    if (!item?.pic) return undefined;

    // Step 2: 换大图 URL
    const imgUrl = item.pic
      .replace('/spic/', '/lpic/')
      .replace('/view/subject/s/', '/view/subject/l/')
      .replace('/view/subject/m/', '/view/subject/l/');
    debug.imgUrl = imgUrl;
    saveDebug(bookId, debug);

    // Step 3: 下载图片
    const imgBuf = await request(imgUrl, {
      'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
      'Referer': 'https://book.douban.com/',
    });

    debug.downloadedBytes = imgBuf.length;
    saveDebug(bookId, debug);

    if (imgBuf.length < 1024) {
      debug.downloadError = '内容过小';
      debug.downloadedContent = imgBuf.toString('utf-8').slice(0, 300);
      saveDebug(bookId, debug);
      return undefined;
    }

    const ext = imgUrl.match(/\.(jpg|jpeg|png|webp)/i)?.[1] ?? 'jpg';
    const filename = `${bookId}.${ext}`;
    fs.writeFileSync(path.join(COVERS_DIR, filename), imgBuf);

    debug.result = `/covers/${filename}`;
    saveDebug(bookId, debug);

    return `/covers/${filename}`;

  } catch (e) {
    debug.fatalError = String(e);
    debug.errorStack = (e instanceof Error) ? e.stack : undefined;
    saveDebug(bookId, debug);
    return undefined;
  }
}
