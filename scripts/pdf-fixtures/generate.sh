#!/usr/bin/env bash
# 用各种工具生成 PDF 兼容性测试样本 → backend/tests/fixtures/pdf-tools/
#   ./scripts/pdf-fixtures/generate.sh            全部生成
#   ./scripts/pdf-fixtures/generate.sh reportlab  只生成指定一组（reportlab / chrome / calibre）
#
# 只需要 docker；正文复用 scripts/epub-fixtures/book.json（自撰短文，每章带唯一标记），每章一页。
# 国内网络可设置：PIP_INDEX_URL、DEBIAN_MIRROR（如 mirrors.aliyun.com）；镜像名可用 PY_IMAGE / CALIBRE_IMAGE 覆盖
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
EPUB="$ROOT/scripts/epub-fixtures"
OUT="$ROOT/backend/tests/fixtures/pdf-tools"
BUILD="$HERE/build"
U="$(id -u):$(id -g)"
NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
PY_IMAGE=${PY_IMAGE:-python:3.11-slim}
CALIBRE_IMAGE=${CALIBRE_IMAGE:-lscr.io/linuxserver/calibre:latest}

mkdir -p "$OUT" "$BUILD"
ONLY="${1:-all}"
want() { [[ "$ONLY" == all || "$ONLY" == "$1" ]]; }
meta() { printf '{\n  "tool": "%s",\n  "version": "%s",\n  "generated_at": "%s"\n}\n' "$1" "$2" "$NOW" > "$OUT/$1.json"; echo "  ✓ $OUT/$1.pdf（$2）"; }

# python 容器（root）：apt 装中文字体 / qpdf / chromium，pip 装 reportlab、pillow；产物最后改回当前用户
debrun() {
  docker run --rm -e PIP_INDEX_URL="${PIP_INDEX_URL:-}" -e DEBIAN_MIRROR="${DEBIAN_MIRROR:-}" \
    -v "$HERE:/work" -v "$EPUB:/epub:ro" -v "$OUT:/out" -w /work "$PY_IMAGE" sh -c "
    set -e
    if [ -n \"\$DEBIAN_MIRROR\" ]; then sed -i \"s#deb.debian.org#\$DEBIAN_MIRROR#g\" /etc/apt/sources.list.d/debian.sources; fi
    apt-get update -qq >/dev/null && apt-get install -y -qq $1 >/dev/null
    $2
    chown -R $U /out /work/build"
}

echo "== 准备输入（book.html）"
docker run --rm -u "$U" -e HOME=/tmp -e PYTHONPATH=/work/build/pylib ${PIP_INDEX_URL:+-e PIP_INDEX_URL="$PIP_INDEX_URL"} \
  -v "$EPUB:/epub:ro" -v "$HERE:/work" -w /work "$PY_IMAGE" sh -c \
  "pip install -q --disable-pip-version-check --target /work/build/pylib pillow && python /epub/prepare.py /work/build"
# 打印用：每章另起一页
sed 's#</head>#<style>h1{page-break-before:always} h1:first-of-type{page-break-before:auto}</style></head>#' "$BUILD/book.html" > "$BUILD/book-print.html"

if want reportlab; then
  echo "== reportlab（CID 不嵌入 / 嵌入 TTF / 扫描版）+ qpdf 加密"
  debrun "fonts-wqy-microhei qpdf" "
    pip install -q --disable-pip-version-check reportlab pillow
    F=/usr/share/fonts/truetype/wqy/wqy-microhei.ttc
    mkdir -p /work/build/fonts && cp \$F /work/build/fonts/
    python gen_reportlab.py /epub/book.json cid /out/reportlab-cid.pdf
    python gen_reportlab.py /epub/book.json ttf /out/reportlab-ttf.pdf \$F
    python gen_reportlab.py /epub/book.json scanned /out/scanned.pdf \$F
    qpdf --encrypt '' owner-pass 256 --print=none --extract=n -- /out/reportlab-ttf.pdf /out/qpdf-owner.pdf
    qpdf --encrypt user-pass owner-pass 256 -- /out/reportlab-ttf.pdf /out/qpdf-user.pdf
    python -c 'import reportlab; print(reportlab.Version)' > /work/build/reportlab.version
    qpdf --version | head -1 > /work/build/qpdf.version"
  RL="reportlab $(cat "$BUILD/reportlab.version")"
  meta reportlab-cid "$RL（STSong-Light，不嵌入）"; meta reportlab-ttf "$RL（嵌入文泉驿微米黑）"; meta scanned "$RL（整页图片）"
  meta qpdf-owner "$(cat "$BUILD/qpdf.version")，只有权限密码"; meta qpdf-user "$(cat "$BUILD/qpdf.version")，打开密码 user-pass"
fi

if want chrome; then
  echo "== Chromium 无头打印"
  debrun "chromium fonts-wqy-microhei" "
    chromium --headless --no-sandbox --disable-gpu --no-pdf-header-footer --print-to-pdf=/out/chrome.pdf file:///work/build/book-print.html 2>/dev/null
    chromium --version > /work/build/chrome.version"
  meta chrome "$(cat "$BUILD/chrome.version")"
fi

if want calibre; then
  echo "== Calibre ebook-convert"
  [ -f "$BUILD/fonts/wqy-microhei.ttc" ] || { echo "先运行 reportlab 一组（准备中文字体）"; exit 1; }
  docker run --rm --entrypoint "" -v "$HERE:/work" -v "$OUT:/out" -v "$BUILD/fonts:/usr/share/fonts/wqy:ro" -w /work/build "$CALIBRE_IMAGE" sh -c "
    fc-cache -f >/dev/null 2>&1 || true
    /opt/calibre/ebook-convert book.html /out/calibre.pdf --title '兼容性样本书' --authors '简单书房测试' --language zh >/dev/null &&
    chown $U /out/calibre.pdf"
  meta calibre "$(docker run --rm --entrypoint "" "$CALIBRE_IMAGE" /opt/calibre/ebook-convert --version | head -1)"
fi

echo "完成。样本：$OUT"
