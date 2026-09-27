/**
 * CLI 组装整页的端到端（不碰网络：只跑本地 Node + qrcode）。
 *
 * 覆盖的是「publish.sh 把 JSON 交给 CLI，CLI 要把同档另一个应用的包也拼进页面」
 * 这一段编排逻辑——纯函数测试够不到，shell 测试又不该在这里引入 ssh。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('../lib/cli.ts', import.meta.url));
const ADAA_NAME = 'dev-unified-portal-app-1.0.16-19-20260901-1130.apk';

function render(input: unknown): string {
  return execFileSync(process.execPath, ['--experimental-strip-types', CLI, 'render'], {
    input: JSON.stringify(input),
    encoding: 'utf8',
  });
}

const PUBLISHED_UAEAA = {
  track: 'dev',
  base: 'https://apk.example.com',
  published: {
    app: 'uaeaa',
    label: 'UAEAA Unified Portal',
    versionName: '1.0.2',
    versionCode: '7',
    packageName: 'ae.gov.uaeaa.unifiedportal.dev',
    apkFileName: 'dev-uaeaa-unified-portal-1.0.2-7-20260901-1200.apk',
    sizeBytes: 1048576,
    builtAt: 1_760_000_000_000,
    publishedAt: '2026-09-01T12:00:00+08:00',
    gitBranch: 'main',
    gitCommit: 'abc1234',
    gitDirty: false,
  },
  slots: {
    adaa: [
      { name: ADAA_NAME, sizeBytes: 2097152, mtimeMs: 1_760_000_100_000 },
      { name: 'dev-unified-portal-app-1.0.15-18-20260828-0900.apk', sizeBytes: 1, mtimeMs: 1 },
    ],
    uaeaa: [{ name: 'dev-uaeaa-unified-portal-1.0.2-7-20260901-1200.apk', sizeBytes: 1048576, mtimeMs: 2 }],
  },
};

test('发 UAEAA 时，页面上 ADAA 那一组从扫描结果里拼出来', () => {
  const html = render(PUBLISHED_UAEAA);
  assert.match(html, /<svg/i);
  // 两个应用各一个二维码。
  assert.equal(html.match(/<svg/g)?.length, 2);
  // 本次发布的走真实元信息：包名与构建时间都在。
  assert.match(html, /ae\.gov\.uaeaa\.unifiedportal\.dev/);
  assert.match(html, /构建时间/);
  // 另一侧取槽位里 mtime 最新的那个包。
  assert.match(html, new RegExp(ADAA_NAME.replace(/\./g, '\\.')));
  assert.ok(!html.includes('1.0.15'), '不得选到更旧的那个包');
  assert.match(html, /信息取自文件名/);
});

test('直链按槽位拼：ADAA 在档位根目录，UAEAA 在自己的子目录', () => {
  const html = render(PUBLISHED_UAEAA);
  assert.match(html, new RegExp(`https://apk\\.example\\.com/dev/dev-unified-portal-app-1\\.0\\.16-19-20260901-1130\\.apk`));
  assert.match(html, /https:\/\/apk\.example\.com\/dev\/uaeaa\/dev-uaeaa-unified-portal-1\.0\.2-7-20260901-1200\.apk/);
});

test('下载按钮的相对路径要能从页面所在目录解析到包（否则点了 404）', () => {
  const html = render(PUBLISHED_UAEAA);
  // 页面在 dev/index.html：ADAA 与它同目录，UAEAA 在 dev/uaeaa/ 下，链接必须带那层前缀。
  const hrefs = [...html.matchAll(/href="\.\/([^"]+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual(hrefs, [
    'dev-unified-portal-app-1.0.16-19-20260901-1130.apk',
    'uaeaa/dev-uaeaa-unified-portal-1.0.2-7-20260901-1200.apk',
  ]);
});

test('另一侧槽位是空的：显示尚未发布，本页只有一个二维码', () => {
  const html = render({ ...PUBLISHED_UAEAA, slots: { ...PUBLISHED_UAEAA.slots, adaa: [] } });
  assert.equal(html.match(/<svg/g)?.length, 1);
  assert.match(html, /还没有 ADAA 的包/);
  assert.ok(!html.includes('undefined'), '页面不得出现 undefined');
});

test('另一侧的文件名不合规则：按尚未发布处理，不猜版本号', () => {
  const html = render({
    ...PUBLISHED_UAEAA,
    slots: { ...PUBLISHED_UAEAA.slots, adaa: [{ name: 'handmade.apk', sizeBytes: 5, mtimeMs: 9 }] },
  });
  assert.match(html, /还没有 ADAA 的包/);
});

test('apk-lines 把 find 的输出转成 JSON', () => {
  const out = execFileSync(process.execPath, ['--experimental-strip-types', CLI, 'apk-lines'], {
    input: `${ADAA_NAME}\t2097152\t1760000100.5\n`,
    encoding: 'utf8',
  });
  assert.deepEqual(JSON.parse(out), [{ name: ADAA_NAME, sizeBytes: 2097152, mtimeMs: 1_760_000_100_500 }]);
});

test('apk-lines 对空输入给出空数组（新档第一次发布时就是这个状态）', () => {
  const out = execFileSync(process.execPath, ['--experimental-strip-types', CLI, 'apk-lines'], {
    input: '',
    encoding: 'utf8',
  });
  assert.deepEqual(JSON.parse(out), []);
});

test('app-path：缺省应用落档根，其它应用落子目录', () => {
  const out = (input: unknown, cmd: string) =>
    execFileSync(process.execPath, ['--experimental-strip-types', CLI, cmd], {
      input: JSON.stringify(input),
      encoding: 'utf8',
    }).trim();
  assert.equal(out({ track: 'uat', app: 'adaa' }, 'app-path'), 'uat');
  assert.equal(out({ track: 'uat', app: 'uaeaa' }, 'app-path'), 'uat/uaeaa');
  assert.equal(out({ remoteDir: '/var/www/apk-publisher', track: 'dev' }, 'track-dir'), '/var/www/apk-publisher/dev');
});
