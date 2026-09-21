/**
 * release.sh 的 dry-run 冒烟测试。
 *
 * 【为什么破例】本仓测试按惯例只断言 lib/ 纯函数，不碰文件系统与网络。
 * 但 release.sh 是 bash 脚本，纯函数测试覆盖不到它——实测踩过一类错：
 * macOS 自带 bash 3.2 下 `$VAR` 后紧跟全角标点会被当成变量名的一部分，
 * `set -u` 直接报 `unbound variable`，脚本压根跑不起来，而 shellcheck 对此是
 * rc=0 干净的（静态检查拦不住）。这条测试跑一次真实的
 * `./release.sh --track dev --dry-run`，接住的正是"脚本在目标 shell 下跑不起来"这一类。
 *
 * 【副作用】dry-run 设计上不改任何东西（脚本内跳过 pull / 改写 / 提交 / 构建 / 上传），
 * 测试仍前后各取一次 app 仓 `status --porcelain` 并断言逐字相同， double-check。
 *
 * 【跳过条件】它依赖本机 `config.local.sh`（内有 app 仓路径）存在。
 * CI 或别人 clone 下来没有这个文件时跳过（t.skip），而不是变红。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(HERE);
const RELEASE_SH = join(ROOT, 'release.sh');
const CONFIG_LOCAL = join(ROOT, 'config.local.sh');

function appRepo(): string {
  const out = execFileSync('bash', ['-c', `. "${CONFIG_LOCAL}" && printf '%s' "$APK_APP_REPO"`], {
    encoding: 'utf8',
  });
  assert.match(out, /./, 'config.local.sh 里读不到 APK_APP_REPO');
  return out;
}

function appRepoStatus(repo: string): string {
  return execFileSync('git', ['-C', repo, 'status', '--porcelain'], { encoding: 'utf8' });
}

test(
  'release.sh dry-run 可跑通且无副作用',
  { timeout: 120000 },
  (t) => {
    if (!existsSync(CONFIG_LOCAL)) {
      t.skip('没有 config.local.sh（CI/他人 clone），跳过冒烟测试');
      return;
    }
    const repo = appRepo();
    const before = appRepoStatus(repo);
    // 期望的新旧 versionCode 从 app 仓现状读出，不硬编码（11 会随发版递增）。
    const current = Number(
      execFileSync('bash', ['-c', `. "${CONFIG_LOCAL}" && node --experimental-strip-types lib/cli.ts config-versions < "$APK_APP_REPO/app.config.ts" | node -e 'console.log(JSON.parse(require("node:fs").readFileSync(0,"utf8")).versionCode)'`], {
        cwd: ROOT,
        encoding: 'utf8',
      }).trim(),
    );
    assert.ok(Number.isInteger(current), `读出的 versionCode 非法: ${current}`);

    const output = execFileSync('bash', [RELEASE_SH, '--track', 'dev', '--dry-run'], {
      cwd: ROOT,
      encoding: 'utf8',
    });

    assert.match(output, /track: dev/);
    assert.match(output, /APP_VARIANT: development/);
    assert.match(output, new RegExp(`versionCode: ${current} → ${current + 1}`));
    assert.match(output, /未执行|未被修改/);

    const after = appRepoStatus(repo);
    assert.equal(after, before, 'dry-run 必须真的什么都不改');
  },
);
