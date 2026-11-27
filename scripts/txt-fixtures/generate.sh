#!/usr/bin/env bash
# 用各种工具生成 TXT 兼容性测试样本 → backend/tests/fixtures/txt-tools/
#   ./scripts/txt-fixtures/generate.sh            全部生成
#   ./scripts/txt-fixtures/generate.sh calibre    只生成指定工具（calibre / pandoc）
#
# 只需要 docker；正文复用 scripts/epub-fixtures/book.json（自撰短文，每章带唯一标记）。
# 各种编码 / 换行 / 标题写法的用例在 backend/tests/plugins/txt-compat.test.ts 里现场生成，不在这里。
# 国内网络可设置 PIP_INDEX_URL；镜像名可用 PY_IMAGE / PANDOC_IMAGE / CALIBRE_IMAGE 覆盖
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
EPUB="$ROOT/scripts/epub-fixtures"
OUT="$ROOT/backend/tests/fixtures/txt-tools"
BUILD="$HERE/build"
U="$(id -u):$(id -g)"
NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
PY_IMAGE=${PY_IMAGE:-python:3.11-slim}
PANDOC_IMAGE=${PANDOC_IMAGE:-pandoc/core:3.6}
CALIBRE_IMAGE=${CALIBRE_IMAGE:-lscr.io/linuxserver/calibre:latest}

mkdir -p "$OUT" "$BUILD"
ONLY="${1:-all}"
want() { [[ "$ONLY" == all || "$ONLY" == "$1" ]]; }
meta() { printf '{\n  "tool": "%s",\n  "version": "%s",\n  "generated_at": "%s"\n}\n' "$1" "$2" "$NOW" > "$OUT/$1.json"; echo "  ✓ $OUT/$1.txt（$2）"; }

echo "== 准备输入（book.md / book.html）"
docker run --rm -u "$U" -e HOME=/tmp -e PYTHONPATH=/work/build/pylib ${PIP_INDEX_URL:+-e PIP_INDEX_URL="$PIP_INDEX_URL"} \
  -v "$EPUB:/epub:ro" -v "$HERE:/work" -w /work "$PY_IMAGE" sh -c \
  "pip install -q --disable-pip-version-check --target /work/build/pylib pillow 2>/dev/null; python /epub/prepare.py /work/build"

if want calibre; then
  echo "== Calibre ebook-convert → TXT"
  docker run --rm --entrypoint "" -v "$HERE:/work" -v "$OUT:/out" -w /work/build "$CALIBRE_IMAGE" sh -c "
    /opt/calibre/ebook-convert book.html /out/calibre.txt --title '兼容性样本书' --authors '简单书房测试' >/dev/null &&
    chown $U /out/calibre.txt"
  meta calibre "$(docker run --rm --entrypoint "" "$CALIBRE_IMAGE" /opt/calibre/ebook-convert --version | head -1)"
fi

if want pandoc; then
  echo "== pandoc → plain"
  docker run --rm -u "$U" -v "$HERE:/work" -v "$OUT:/out" -w /work/build "$PANDOC_IMAGE" book.md -t plain -o /out/pandoc.txt
  meta pandoc "$(docker run --rm "$PANDOC_IMAGE" --version | head -1)"
fi

echo "完成。样本：$OUT"
