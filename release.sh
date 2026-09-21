#!/usr/bin/env bash
#
# 端到端发布：改版本号 → 提交 → prebuild → gradle 构建 → 调 publish.sh 发布。
#
#   ./release.sh --track dev|uat|release [--version 1.0.9] [--dry-run]
#
# 七步（顺序固定）：
#   1. 在 app 仓当前分支跑 git pull --rebase（不切分支）
#   2. 检查 app.config.ts 必须干净，否则硬失败；其余文件允许 dirty
#   3. android.versionCode +1；传了 --version 就同时改顶层 version
#   4. 只提交 app.config.ts 这一个文件（不 push）
#   5. 按 track 设 APP_VARIANT 跑 npx expo prebuild --platform android
#   6. 在 android/ 下跑 ./gradlew assembleRelease
#   7. 调本仓 ./publish.sh --track <同一个档> <刚构建出的 apk>
#
# 副作用说明：它会改 app 仓并产生一个本地 commit，但绝不 push。
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
[ -f "$HERE/config.local.sh" ] && . "$HERE/config.local.sh"

APP_REPO="${APK_APP_REPO:-}"

die() { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }
step() { printf '\033[36m▸\033[0m %s\n' "$*"; }
ok()   { printf '\033[32m✓\033[0m %s\n' "$*"; }

NODE="node --experimental-strip-types"
CLI="$HERE/lib/cli.ts"
CONFIG_FILE="app.config.ts"
APK_OUT="android/app/build/outputs/apk/release/app-release.apk"

[ -n "$APP_REPO" ] || die "缺少配置：APK_APP_REPO。把 config.example.sh 复制成 config.local.sh 并填写，或用环境变量提供。"
[ -d "$APP_REPO" ] || die "app 仓路径不存在: $APP_REPO"

# ── 0. 参数解析（判定逻辑在 lib/release.ts，shell 只取结果与退出码） ──────────
ARGS_JSON="$($NODE -e 'console.log(JSON.stringify(process.argv.slice(1)))' -- "$@")"
PARSED="$(printf '%s' "$ARGS_JSON" | $NODE "$CLI" release-args)" || die "参数错误（见上方 Node 报错）。用法：./release.sh --track dev|uat|release [--version 1.0.9] [--dry-run]"
TRACK="$($NODE -e 'console.log(JSON.parse(process.argv[1]).track)' "$PARSED")"
VERSION_ARG="$($NODE -e 'const p=JSON.parse(process.argv[1]); console.log(p.version ?? "")' "$PARSED")"
DRY_RUN="$($NODE -e 'console.log(JSON.parse(process.argv[1]).dryRun ? "true" : "false")' "$PARSED")"
APP_VARIANT="$(printf '%s' "$TRACK" | $NODE "$CLI" app-variant)"

# ── 1. 当前分支 pull --rebase（不切分支） ─────────────────────────────────────
BRANCH="$(git -C "$APP_REPO" rev-parse --abbrev-ref HEAD)"
step "同步 app 仓（${BRANCH}）：git pull --rebase"
if [ "$DRY_RUN" = true ]; then
  echo "  dry-run：跳过 git pull --rebase"
else
  git -C "$APP_REPO" pull --rebase || die "git pull --rebase 失败，先手工处理 app 仓的状态再发版"
fi

# ── 2. app.config.ts 必须干净（其余文件允许 dirty） ───────────────────────────
if ! git -C "$APP_REPO" diff --quiet -- "$CONFIG_FILE"; then
  die "app.config.ts 有未提交的改动，发版会把它一起提交进去（提交信息写的是版本号 +1）。先处理掉 app.config.ts 的改动再发版。"
fi
if ! git -C "$APP_REPO" diff --cached --quiet -- "$CONFIG_FILE"; then
  die "app.config.ts 有已暂存未提交的改动，发版会把它一起提交进去（提交信息写的是版本号 +1）。先处理掉 app.config.ts 的改动再发版。"
fi

# ── 3. 读出旧版本号，算出新版本号 ─────────────────────────────────────────────
VERSIONS_JSON="$($NODE "$CLI" config-versions <"$APP_REPO/$CONFIG_FILE")"
OLD_VERSION="$($NODE -e 'console.log(JSON.parse(process.argv[1]).version)' "$VERSIONS_JSON")"
OLD_CODE="$($NODE -e 'console.log(JSON.parse(process.argv[1]).versionCode)' "$VERSIONS_JSON")"
NEW_CODE=$((OLD_CODE + 1))
if [ -n "$VERSION_ARG" ]; then NEW_VERSION="$VERSION_ARG"; else NEW_VERSION="$OLD_VERSION"; fi

if [ "$DRY_RUN" = true ]; then
  step "dry-run：以下步骤均未执行"
  printf '  track: %s\n' "$TRACK"
  if [ -n "$APP_VARIANT" ]; then printf '  APP_VARIANT: %s\n' "$APP_VARIANT";
  else printf '  APP_VARIANT: （不设，走缺省交付包名）\n'; fi
  printf '  version: %s → %s\n' "$OLD_VERSION" "$NEW_VERSION"
  printf '  versionCode: %s → %s\n' "$OLD_CODE" "$NEW_CODE"
  if [ -n "$APP_VARIANT" ]; then printf '  构建命令：APP_VARIANT=%s npx expo prebuild --platform android（cwd: <APP_REPO>）\n' "$APP_VARIANT";
  else printf '  构建命令：npx expo prebuild --platform android（cwd: <APP_REPO>）\n'; fi
  printf '  构建命令：./gradlew assembleRelease（cwd: <APP_REPO>/android）\n'
  printf '  发布命令：./publish.sh --track %s <APP_REPO>/%s\n' "$TRACK" "$APK_OUT"
  ok "dry-run 结束，app 仓未被修改"
  exit 0
fi

# ── 3–4. 改写 app.config.ts → 读回验证 → 只提交这一个文件（不 push） ──────────
step "改版本号：versionCode $OLD_CODE → $NEW_CODE$([ "$NEW_VERSION" != "$OLD_VERSION" ] && echo "，version $OLD_VERSION → $NEW_VERSION")"
BUMP_VERSION=""
if [ "$NEW_VERSION" != "$OLD_VERSION" ]; then BUMP_VERSION="$NEW_VERSION"; fi
BUMP_JSON="$($NODE -e '
  const fs = require("node:fs");
  const source = fs.readFileSync(process.argv[1], "utf8");
  const versionCode = Number(process.argv[2]);
  const version = process.argv[3] === "" ? undefined : process.argv[3];
  console.log(JSON.stringify({ source, versionCode, version }));
' "$APP_REPO/$CONFIG_FILE" "$NEW_CODE" "$BUMP_VERSION")"
printf '%s' "$BUMP_JSON" | $NODE "$CLI" bump-config >"$APP_REPO/$CONFIG_FILE.new"
mv "$APP_REPO/$CONFIG_FILE.new" "$APP_REPO/$CONFIG_FILE"

VERIFY_JSON="$($NODE "$CLI" config-versions <"$APP_REPO/$CONFIG_FILE")"
GOT_VERSION="$($NODE -e 'console.log(JSON.parse(process.argv[1]).version)' "$VERIFY_JSON")"
GOT_CODE="$($NODE -e 'console.log(JSON.parse(process.argv[1]).versionCode)' "$VERIFY_JSON")"
[ "$GOT_CODE" = "$NEW_CODE" ] || die "改写后读回 versionCode 是 ${GOT_CODE}，期望 ${NEW_CODE}，已停止（文件已改、尚未提交，请手工检查）"
[ "$GOT_VERSION" = "$NEW_VERSION" ] || die "改写后读回 version 是 ${GOT_VERSION}，期望 ${NEW_VERSION}，已停止（文件已改、尚未提交，请手工检查）"
ok "已改写并验证：version ${GOT_VERSION}，versionCode ${GOT_CODE}"

COMMIT_JSON="$($NODE -e 'console.log(JSON.stringify({ track: process.argv[1], oldVersion: process.argv[2], newVersion: process.argv[3], oldVersionCode: Number(process.argv[4]), newVersionCode: Number(process.argv[5]) }))' "$TRACK" "$OLD_VERSION" "$NEW_VERSION" "$OLD_CODE" "$NEW_CODE")"
COMMIT_MSG="$(printf '%s' "$COMMIT_JSON" | $NODE "$CLI" release-commit-message)"
git -C "$APP_REPO" commit -m "$COMMIT_MSG" -- "$CONFIG_FILE"
ok "已提交（本地，未 push）：$COMMIT_MSG"

# ── 5. prebuild（android/ 是 gitignored 产物，会被清空重建，这是预期的） ──────
step "prebuild：npx expo prebuild --platform android"
if [ -n "$APP_VARIANT" ]; then
  (cd "$APP_REPO" && APP_VARIANT="$APP_VARIANT" npx expo prebuild --platform android)
else
  (cd "$APP_REPO" && npx expo prebuild --platform android)
fi
ok "prebuild 完成"

# ── 6. gradle 构建 ────────────────────────────────────────────────────────────
step "构建：./gradlew assembleRelease"
(cd "$APP_REPO/android" && ./gradlew assembleRelease)
APK_ABS="$APP_REPO/$APK_OUT"
[ -f "$APK_ABS" ] || die "构建完成但找不到产物: $APK_ABS"
ok "构建完成：$APK_ABS"

# ── 7. 发布（同一个 track） ───────────────────────────────────────────────────
step "发布：./publish.sh --track $TRACK"
"$HERE/publish.sh" --track "$TRACK" "$APK_ABS"
