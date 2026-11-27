#!/usr/bin/env bash
# 用各种电子书制作工具生成 EPUB 兼容性测试样本 → backend/tests/fixtures/epub-tools/
#   ./scripts/epub-fixtures/generate.sh            全部生成
#   ./scripts/epub-fixtures/generate.sh pandoc     只生成指定工具（epub4j / pandoc / ebooklib / epubgen / calibre）
#
# 只需要 docker；样本和对应的 <工具>.json（工具版本、生成时间）一起提交，测试本身不依赖 docker。
# 正文来自 book.json（自撰短文，每章带唯一标记），工具输入由 prepare.py 生成。
# 国内网络可设置：PIP_INDEX_URL、NPM_REGISTRY（npm 源）、MAVEN_MIRROR（Maven 中央库镜像地址）；镜像名可用 PY_IMAGE / MVN_IMAGE / PANDOC_IMAGE / NODE_IMAGE / CALIBRE_IMAGE 覆盖
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
OUT="$ROOT/backend/tests/fixtures/epub-tools"
BUILD="$HERE/build"
U="$(id -u):$(id -g)"
NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

PY_IMAGE=${PY_IMAGE:-python:3.11-slim}
MVN_IMAGE=${MVN_IMAGE:-maven:3.9-eclipse-temurin-21}
PANDOC_IMAGE=${PANDOC_IMAGE:-pandoc/core:3.6}
NODE_IMAGE=${NODE_IMAGE:-node:22-slim}
CALIBRE_IMAGE=${CALIBRE_IMAGE:-lscr.io/linuxserver/calibre:latest}

mkdir -p "$OUT" "$BUILD"
ONLY="${1:-all}"
want() { [[ "$ONLY" == all || "$ONLY" == "$1" ]]; }
meta() { # 工具 版本
  printf '{\n  "tool": "%s",\n  "version": "%s",\n  "generated_at": "%s"\n}\n' "$1" "$2" "$NOW" > "$OUT/$1.json"
  echo "  ✓ $OUT/$1.epub（$2）"
}
pyrun() { # 在 python 容器里跑：先装依赖到 build/pylib，再执行命令
  docker run --rm -u "$U" -e HOME=/tmp -e PYTHONPATH=/work/build/pylib ${PIP_INDEX_URL:+-e PIP_INDEX_URL="$PIP_INDEX_URL"} \
    -v "$HERE:/work" -v "$OUT:/out" -w /work "$PY_IMAGE" sh -c "$1"
}

echo "== 准备输入（book.md / book.html / cover.jpg）"
pyrun "pip install -q --disable-pip-version-check --target /work/build/pylib pillow ebooklib && python prepare.py /work/build"

if want epub4j; then
  echo "== epub4j 4.2.3（so-novel 同款）"
  MVN_SETTINGS=""
  if [[ -n "${MAVEN_MIRROR:-}" ]]; then
    printf '<settings><mirrors><mirror><id>m</id><mirrorOf>central</mirrorOf><url>%s</url></mirror></mirrors></settings>' "$MAVEN_MIRROR" > "$BUILD/settings.xml"
    MVN_SETTINGS="-s /work/build/settings.xml"
  fi
  docker run --rm -u "$U" -e HOME=/tmp -v "$HERE:/work" -v "$OUT:/out" -w /work/epub4j "$MVN_IMAGE" sh -c "
    mvn -q -B $MVN_SETTINGS -Dmaven.repo.local=/work/build/m2 dependency:copy-dependencies -DoutputDirectory=/work/build/epub4j-deps &&
    java -cp '/work/build/epub4j-deps/*' Gen.java /work/book.json /work/build/cover.jpg /out/epub4j.epub"
  meta epub4j "epub4j-core 4.2.3"
fi

if want pandoc; then
  echo "== pandoc（EPUB3 / EPUB2）"
  for v in 3 2; do
    docker run --rm -u "$U" -v "$HERE:/work" -v "$OUT:/out" -w /work/build "$PANDOC_IMAGE" \
      book.md -o "/out/pandoc-epub$v.epub" -t "epub$v" --split-level=1 \
      --metadata title="兼容性样本书" --metadata author="简单书房测试" --metadata lang=zh-CN \
      --epub-cover-image=cover.jpg
    meta "pandoc-epub$v" "$(docker run --rm "$PANDOC_IMAGE" --version | head -1)"
  done
fi

if want ebooklib; then
  echo "== Python ebooklib"
  pyrun "python gen_ebooklib.py book.json build/cover.jpg /out/ebooklib.epub"
  meta ebooklib "ebooklib $(pyrun "python -c 'import importlib.metadata as m; print(m.version(\"ebooklib\"))'")"
fi

if want epubgen; then
  echo "== Node epub-gen-memory"
  docker run --rm -u "$U" -e HOME=/tmp -e npm_config_cache=/work/build/npm-cache ${NPM_REGISTRY:+-e npm_config_registry="$NPM_REGISTRY"} \
    -v "$HERE:/work" -v "$OUT:/out" -w /work/build "$NODE_IMAGE" sh -c "
    [ -d node_modules/epub-gen-memory ] || npm install --no-save --no-fund --no-audit epub-gen-memory >/dev/null &&
    cp ../gen_epubgen.mjs . && node gen_epubgen.mjs ../book.json cover.jpg /out/epubgen.epub"
  meta epubgen "epub-gen-memory $(node -p "require('$BUILD/node_modules/epub-gen-memory/package.json').version" 2>/dev/null || echo '?')"
fi

if want calibre; then
  echo "== Calibre ebook-convert（镜像较大，第一次需要下载）"
  docker run --rm --entrypoint "" -v "$HERE:/work" -v "$OUT:/out" -w /work/build "$CALIBRE_IMAGE" sh -c "
    /opt/calibre/ebook-convert book.html /out/calibre.epub --cover cover.jpg \
      --title '兼容性样本书' --authors '简单书房测试' --language zh >/dev/null &&
    chown $U /out/calibre.epub"
  meta calibre "$(docker run --rm --entrypoint "" "$CALIBRE_IMAGE" /opt/calibre/ebook-convert --version | head -1)"
fi

echo "完成。样本：$OUT"
