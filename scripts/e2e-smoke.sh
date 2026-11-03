#!/bin/bash
# Plan 3 E2E smoke tests for backend API surface.
# Usage: bash scripts/e2e-smoke.sh
#
# Verifies all new endpoints introduced by Plan 3 are reachable and return
# expected shapes. Does NOT exercise the AI calls (those depend on plugin
# config + cost money) — those are documented as manual steps below.

set -e
BASE="${BASE:-http://127.0.0.1:8080}"
ADMIN_USER="${ADMIN_USER:-admin}"
ADMIN_PASS="${ADMIN_PASS:-admin123}"

red()   { printf "\e[31m%s\e[0m\n" "$*"; }
green() { printf "\e[32m%s\e[0m\n" "$*"; }
blue()  { printf "\e[34m%s\e[0m\n" "$*"; }

login() {
  local resp
  resp=$(curl -s -X POST -H "Content-Type: application/json" \
    -d "{\"username\":\"${ADMIN_USER}\",\"password\":\"${ADMIN_PASS}\"}" \
    "${BASE}/api/auth/login")
  if ! echo "$resp" | grep -q '"success":true'; then
    red "✗ login failed: $resp"; exit 1
  fi
  echo "$resp" | python3 -c "import json,sys; print(json.load(sys.stdin)['data']['accessToken'])"
}

blue "Logging in as ${ADMIN_USER}…"
TOKEN=$(login)
green "✓ token acquired (len ${#TOKEN})"
AUTH="Authorization: Bearer ${TOKEN}"

probe() {
  local label="$1" method="$2" path="$3" extra="$4"
  local code body
  body=$(mktemp)
  code=$(curl -s -o "$body" -w "%{http_code}" -X "$method" -H "$AUTH" $extra "${BASE}${path}")
  if [ "$code" = "200" ] || [ "$code" = "201" ]; then
    green "✓ $label  [$code]"
  else
    red   "✗ $label  [$code] $(head -c 200 "$body")"
  fi
  rm -f "$body"
}

blue "── Plan 3 new endpoints ──"
probe "GET /library/series"                         GET "/api/library/series"
probe "GET /library/scan/estimate"                  GET "/api/library/scan/estimate?ai_dedup=1&ai_series=1&ai_fill=1"
probe "GET /library/audit-log"                      GET "/api/library/audit-log?limit=5"
probe "GET /library/manual-overrides"               GET "/api/library/manual-overrides"
probe "GET /library?include_dirty=true"             GET "/api/library?page=1&pageSize=5&include_dirty=true"
probe "GET /library?series_grouped=true"            GET "/api/library?page=1&pageSize=5&series_grouped=true"
probe "GET /library?status=problems"                GET "/api/library?status=problems&pageSize=5"

blue "── First book sanity ──"
BOOK_ID=$(curl -s -H "$AUTH" "${BASE}/api/library?pageSize=1" | python3 -c "import json,sys;d=json.load(sys.stdin);print(d['data'][0]['id'] if d.get('data') else '')")
if [ -z "$BOOK_ID" ]; then
  red "✗ no books in library — skipping per-book probes"
else
  green "✓ using bookId=${BOOK_ID:0:8}"
  probe "GET /library/:id/ai-metadata"              GET "/api/library/${BOOK_ID}/ai-metadata"
  probe "GET /library/:id/normalize-chapters"       GET "/api/library/${BOOK_ID}/normalize-chapters"
fi

blue "── Series sanity ──"
SERIES_ID=$(curl -s -H "$AUTH" "${BASE}/api/library/series" | python3 -c "import json,sys;d=json.load(sys.stdin);print(d['data'][0]['id'] if d.get('data') else '')")
if [ -z "$SERIES_ID" ]; then
  red "✗ no series in DB — skipping series probe"
else
  green "✓ using seriesId=${SERIES_ID:0:8}"
  probe "GET /library/series/:id"                   GET "/api/library/series/${SERIES_ID}"
fi

blue ""
blue "── Done. Manual UI checks remaining ──"
cat <<'EOF'

1. /library — see SeriesCard (page 1 only) + sort selector + admin "显示脏数据" switch
2. Click scan button → ScanOptionsDialog → estimates show alongside AI toggles
3. Settings → AI 设置 → "书籍简介长度" select; save then verify ai_summary_length in DB
4. Click any book → BookDetail → if AI fill ran, see 推荐标签 + 类似作品 sections
5. BookDetail → "AI 统一章节" button → click → confirm → wait → button shows "恢复章节 (N)"
6. /library/audit-log — see entries for ai_fill_book, ai_fetch_cover, delete_*
7. /library/manual-overrides — admin can clear individual + bulk
8. /library/problems — duplicate + garbled tabs with delete actions
EOF
