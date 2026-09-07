#!/usr/bin/env bash
#
# 把一个 Android APK 发布到自建的内测分发站（地址见 config.local.sh）
#
#   ./publish.sh                 # 用默认的 release APK
#   ./publish.sh path/to/app.apk # 或指定文件
#   ./publish.sh --prune-only    # 只清理服务器上的旧包，不发布
#
# 服务器上没有任何常驻进程：这个脚本在本地把 index.html 连同 APK 一起生成好推上去，
# nginx 直接当静态文件发。
set -euo pipefail

# ── 配置 ────────────────────────────────────────────────────────────────────
# 部署目标（服务器地址、密钥路径、域名）不写进这个文件——仓库是公开的。
# 首次使用：cp config.example.sh config.local.sh，填上自己的值。
# config.local.sh 已 gitignore；也可以改用同名的 APK_* 环境变量，环境变量优先。
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
[ -f "$HERE/config.local.sh" ] && . "$HERE/config.local.sh"

SSH_KEY="${APK_SSH_KEY:-}"
SSH_HOST="${APK_SSH_HOST:-}"
BASE_URL="${APK_BASE_URL:-}"
APP_REPO="${APK_APP_REPO:-}"
REMOTE_DIR="${APK_REMOTE_DIR:-/var/www/apk-publisher}"
KEEP="${APK_KEEP:-3}"                       # 服务器上保留多少个历史包
DEFAULT_APK="${APK_DEFAULT_APK:-$APP_REPO/android/app/build/outputs/apk/release/app-release.apk}"

NODE="node --experimental-strip-types"
CLI="$HERE/lib/cli.ts"
SSH=(ssh -i "$SSH_KEY" -o BatchMode=yes -o LogLevel=ERROR)
SCP=(scp -i "$SSH_KEY" -o BatchMode=yes -o LogLevel=ERROR)

# ── rsync 进度 flag 探测 ─────────────────────────────────────────────────────
# --info=progress2（GNU rsync）能在传输过程中持续输出进度，且在非 TTY 下同样生效。
# macOS 自带的是 openrsync，不支持该 flag，但 --progress 同样在非 TTY 下工作。
# 这里探测一次，后续 APK 上传统一使用探测到的 flag，避免硬编码可能不存在的选项。
if rsync --info=progress2 --version >/dev/null 2>&1; then
  RSYNC_PROGRESS_FLAG="--info=progress2"
else
  RSYNC_PROGRESS_FLAG="--progress"
fi

die() { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }
step() { printf '\033[36m▸\033[0m %s\n' "$*"; }
ok()   { printf '\033[32m✓\033[0m %s\n' "$*"; }

MISSING=()
[ -n "$SSH_KEY" ]  || MISSING+=(APK_SSH_KEY)
[ -n "$SSH_HOST" ] || MISSING+=(APK_SSH_HOST)
[ -n "$BASE_URL" ] || MISSING+=(APK_BASE_URL)
[ -n "$APP_REPO" ] || MISSING+=(APK_APP_REPO)
if [ ${#MISSING[@]} -gt 0 ]; then
  die "缺少配置：${MISSING[*]}
把 config.example.sh 复制成 config.local.sh 并填写，或用环境变量提供。"
fi

# ── 1. 定位 APK ─────────────────────────────────────────────────────────────
PRUNE_ONLY=false
if [ "${1:-}" = "--prune-only" ]; then PRUNE_ONLY=true; shift; fi

APK="${1:-$DEFAULT_APK}"
[ "$PRUNE_ONLY" = true ] || [ -f "$APK" ] || die "APK 不存在: $APK
先打包再发布，例如： (cd $APP_REPO && ./gradlew -p android assembleRelease)"
APK="$(cd "$(dirname "$APK")" && pwd)/$(basename "$APK")"

# ── 发布：读元信息 → 上传 APK → 生成并上传下载页 ─────────────────────────────
publish_release() {
# ── 2. 定位 aapt2 ───────────────────────────────────────────────────────────
SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Library/Android/sdk}}"
AAPT="$(ls -d "$SDK"/build-tools/*/aapt2 2>/dev/null | sort -V | tail -1 || true)"
[ -n "$AAPT" ] && [ -x "$AAPT" ] || die "找不到 aapt2。请设置 ANDROID_HOME 指向 Android SDK。"

# ── 3. 读 APK 元信息 ────────────────────────────────────────────────────────
step "读取 APK 元信息"
eval "$("$AAPT" dump badging "$APK" | $NODE "$CLI" info)"
read -r SIZE_BYTES BUILT_AT_MS <<<"$($NODE -e '
  const s = require("node:fs").statSync(process.argv[1]);
  console.log(s.size, Math.floor(s.mtimeMs));
' "$APK")"
ok "$APK_LABEL $APK_VERSION_NAME (versionCode $APK_VERSION_CODE) · $((SIZE_BYTES / 1024 / 1024)) MB"

# ── 4. 读 git 信息（拿不到就不显示，不阻断发布）──────────────────────────────
GIT_BRANCH=""; GIT_COMMIT=""; GIT_DIRTY=false
if git -C "$APP_REPO" rev-parse --git-dir >/dev/null 2>&1; then
  GIT_BRANCH="$(git -C "$APP_REPO" branch --show-current 2>/dev/null || echo '')"
  GIT_COMMIT="$(git -C "$APP_REPO" rev-parse --short HEAD 2>/dev/null || echo '')"
  if [ -n "$(git -C "$APP_REPO" status --porcelain 2>/dev/null)" ]; then GIT_DIRTY=true; fi
  ok "构建来源 ${GIT_BRANCH:-?} @ ${GIT_COMMIT:-?}$([ "$GIT_DIRTY" = true ] && echo ' (dirty)')"
fi

# ── 5. 目标文件名 ───────────────────────────────────────────────────────────
PUBLISHED_AT="$(date +%Y-%m-%dT%H:%M:%S%z)"
APK_NAME="$($NODE "$CLI" name <<JSON
{"label":"$APK_LABEL","versionName":"$APK_VERSION_NAME","versionCode":"$APK_VERSION_CODE","publishedAt":"$PUBLISHED_AT"}
JSON
)"
APK_URL="$BASE_URL/$APK_NAME"

# ── 6. 磁盘检查：留出两倍包大小的余量再传 ───────────────────────────────────
step "检查服务器剩余空间"
AVAIL_KB="$("${SSH[@]}" "$SSH_HOST" "df -Pk '$REMOTE_DIR' | awk 'NR==2{print \$4}'")"
NEED_KB=$(( SIZE_BYTES / 1024 * 2 ))
[ "$AVAIL_KB" -gt "$NEED_KB" ] || die "服务器剩余空间不足：可用 $((AVAIL_KB/1024)) MB，需要 $((NEED_KB/1024)) MB。
先清理再发布（这台机器被 CI 缓存写满过一次）。"
ok "可用 $((AVAIL_KB / 1024)) MB"

# ── 7. 上传：先传 .part 再原子改名，避免有人下到半截文件 ─────────────────────
# 改用 rsync 而非 scp 的原因：scp 的进度条只在 stdout 为 TTY 时才显示；
# 当上层以管道/重定向方式调用（yarn wrapper、CI）时 scp 完全静默，
# 而 rsync --progress / --info=progress2 在非 TTY 下同样会持续吐进度行。
# RSYNC_PROGRESS_FLAG 已在脚本启动阶段探测设置（见上方注释）。
step "上传 $APK_NAME"
rsync -e "ssh -i \"$SSH_KEY\" -o BatchMode=yes -o LogLevel=ERROR" \
  "$RSYNC_PROGRESS_FLAG" \
  "$APK" "$SSH_HOST:$REMOTE_DIR/$APK_NAME.part"
"${SSH[@]}" "$SSH_HOST" "mv -f '$REMOTE_DIR/$APK_NAME.part' '$REMOTE_DIR/$APK_NAME' && chmod 644 '$REMOTE_DIR/$APK_NAME'"
ok "上传完成"

# ── 8. 生成并上传下载页 ─────────────────────────────────────────────────────
step "生成下载页"
PAGE="$(mktemp -t apk-index)"
trap 'rm -f "$PAGE"' EXIT
$NODE "$CLI" render >"$PAGE" <<JSON
{
  "label": $($NODE -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$APK_LABEL"),
  "versionName": "$APK_VERSION_NAME",
  "versionCode": "$APK_VERSION_CODE",
  "packageName": "$APK_PACKAGE",
  "apkFileName": "$APK_NAME",
  "apkUrl": "$APK_URL",
  "sizeBytes": $SIZE_BYTES,
  "builtAt": $BUILT_AT_MS,
  "publishedAt": "$PUBLISHED_AT",
  "gitBranch": $([ -n "$GIT_BRANCH" ] && printf '"%s"' "$GIT_BRANCH" || echo null),
  "gitCommit": $([ -n "$GIT_COMMIT" ] && printf '"%s"' "$GIT_COMMIT" || echo null),
  "gitDirty": $GIT_DIRTY
}
JSON
"${SCP[@]}" "$PAGE" "$SSH_HOST:$REMOTE_DIR/index.html.part"
"${SSH[@]}" "$SSH_HOST" "mv -f '$REMOTE_DIR/index.html.part' '$REMOTE_DIR/index.html' && chmod 644 '$REMOTE_DIR/index.html'"

# SELinux 是 Enforcing：新文件若标签不对，nginx 读不到，会表现成 404 而不是 403。
"${SSH[@]}" "$SSH_HOST" "sudo restorecon -R '$REMOTE_DIR'" || die "restorecon 失败，页面可能返回 404"
ok "下载页已更新"
}

# ── 清理：服务器上只留最近 $KEEP 个包 ───────────────────────────────────────
prune_old() {
step "清理旧版本（保留最近 $KEEP 个）"
FILES_JSON="$("${SSH[@]}" "$SSH_HOST" \
  "find '$REMOTE_DIR' -maxdepth 1 -name '*.apk' -printf '%f\t%T@\n'" \
  | $NODE -e '
    const rows = require("node:fs").readFileSync(0, "utf8").trim().split("\n").filter(Boolean);
    const files = rows.map((r) => {
      const [name, t] = r.split("\t");
      return { name, mtimeMs: Math.round(parseFloat(t) * 1000) };
    });
    console.log(JSON.stringify({ files, keep: Number(process.argv[1]) }));
  ' "$KEEP")"
STALE="$(printf '%s' "$FILES_JSON" | $NODE "$CLI" stale)"
if [ -n "$STALE" ]; then
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    "${SSH[@]}" "$SSH_HOST" "rm -f '$REMOTE_DIR/$f'"
    printf '  删除 %s\n' "$f"
  done <<<"$STALE"
else
  echo "  无需清理"
fi
}

# ── 主流程 ──────────────────────────────────────────────────────────────────
# 中断的上传会留下 .part 残骸。它们不匹配 *.apk，永远轮不到 prune_old 清理，
# 会一直占着盘——这台机器就是被这类没人回收的东西写满过一次的。
# 只删一小时前的，避免误伤另一个正在进行的上传。
step "清理中断残留"
"${SSH[@]}" "$SSH_HOST" "find '$REMOTE_DIR' -maxdepth 1 -name '*.part' -mmin +60 -delete" || true

if [ "$PRUNE_ONLY" = false ]; then
  publish_release
fi

prune_old

if [ "$PRUNE_ONLY" = false ]; then
  echo
  $NODE "$CLI" qr-terminal "$APK_URL"
  printf '\033[1m下载页\033[0m  %s\n' "$BASE_URL"
  printf '\033[1m直链  \033[0m  %s\n' "$APK_URL"
fi
