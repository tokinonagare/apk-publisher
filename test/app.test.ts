import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  apkIdentityMismatch,
  appHrefPrefix,
  appLabel,
  appPath,
  appPlaceholderNote,
  APPS,
  DEFAULT_APP,
  packagePrefix,
  parseApp,
  tenantEnvValue,
} from '../lib/app.ts';

test('只接受 adaa、uaeaa 两个应用', () => {
  assert.equal(parseApp('adaa'), 'adaa');
  assert.equal(parseApp('uaeaa'), 'uaeaa');
  assert.throws(() => parseApp('adaa2'), /adaa、uaeaa/);
  assert.throws(() => parseApp('UAEAA'), /用法/); // 大小写不宽容：应用名同时是目录名
  assert.throws(() => parseApp(undefined), /--app/);
});

test('缺省应用必须是 adaa（app 仓的 yarn publish:apk 不传 --app）', () => {
  assert.equal(DEFAULT_APP, 'adaa');
  assert.ok(APPS.includes(DEFAULT_APP));
});

test('应用标签用大写，页面上与包名前缀对得上', () => {
  assert.equal(appLabel('adaa'), 'ADAA');
  assert.equal(appLabel('uaeaa'), 'UAEAA');
});

test('槽位路径：缺省应用直接住在档位根目录，其余应用各占一层子目录', () => {
  // 🔴 这条断言守的是「已流传出去的 ADAA 直链不能失效」：
  // 测试人员手机里存的二维码指向 /dev/dev-*.apk，给它加一层 /adaa/ 就全 404。
  assert.equal(appPath('dev', 'adaa'), 'dev');
  assert.equal(appPath('release', 'adaa'), 'release');
  assert.equal(appPath('dev', 'uaeaa'), 'dev/uaeaa');
  assert.equal(appPath('uat', 'uaeaa'), 'uat/uaeaa');
});

test('下载链接前缀：缺省应用没有前缀，其它应用带自己那层目录', () => {
  // 页面在 <track>/index.html，包在 <track>/<app>/ 时链接必须带前缀，否则点了 404。
  assert.equal(appHrefPrefix('adaa'), '');
  assert.equal(appHrefPrefix('uaeaa'), 'uaeaa/');
});

test('包名前缀只到租户那一段，三档后缀都归 app 仓的表管', () => {
  assert.equal(packagePrefix('adaa'), 'ae.gov.adaa.');
  assert.equal(packagePrefix('uaeaa'), 'ae.gov.uaeaa.');
});

test('APP_TENANT 取值与 app 仓 #387 的租户表一致（大写，未知值在 app 仓会 throw）', () => {
  assert.equal(tenantEnvValue('adaa'), 'ADAA');
  assert.equal(tenantEnvValue('uaeaa'), 'UAEAA');
});

test('身份守卫：包名必须属于要发的那个应用', () => {
  // 同档三种的包名都要放过——守卫只看租户那一段。
  assert.equal(apkIdentityMismatch('ae.gov.adaa.unifiedportal', 'adaa'), null);
  assert.equal(apkIdentityMismatch('ae.gov.adaa.unifiedportal.dev', 'adaa'), null);
  assert.equal(apkIdentityMismatch('ae.gov.uaeaa.unifiedportal.uat', 'uaeaa'), null);
  // 🔴 这一格是本次改动新引入的失误面：把 ADAA 的包发进 UAEAA 槽位，
  // 页面上标题与二维码指向两家不同的后端，而装上之前没有任何东西报错。
  const mismatch = apkIdentityMismatch('ae.gov.adaa.unifiedportal.dev', 'uaeaa');
  assert.ok(mismatch);
  assert.match(mismatch, /要发往 --app uaeaa/);
  assert.match(mismatch, /它看起来是 adaa（ADAA）的包/);
  const unknown = apkIdentityMismatch('com.example.other', 'adaa');
  assert.ok(unknown);
  assert.match(unknown, /不以 ae\.gov\.adaa\. 开头/);
});

test('占位提示按应用给出', () => {
  assert.equal(appPlaceholderNote('uaeaa'), 'UAEAA 尚未发布 APK。');
});

test('CLI：不传 --app 时落缺省应用，传非法值硬失败', () => {
  const cli = fileURLToPath(new URL('../lib/cli.ts', import.meta.url));
  const run = (input: string, args: string[]) =>
    execFileSync(process.execPath, ['--experimental-strip-types', cli, ...args], { input, encoding: 'utf8' }).trim();

  assert.equal(run('', ['app']), DEFAULT_APP);
  assert.equal(run('uaeaa', ['app']), 'uaeaa');
  assert.throws(() => run('nope', ['app']), /adaa、uaeaa/);
  assert.equal(run('', ['default-app']), DEFAULT_APP);
  assert.deepEqual(run('', ['apps']).split('\n'), [...APPS]);
});

test('CLI：check-identity 通过时静默退 0，不符时打出那句话并非零退出', () => {
  const cli = fileURLToPath(new URL('../lib/cli.ts', import.meta.url));
  const run = (input: string) => {
    try {
      const out = execFileSync(process.execPath, ['--experimental-strip-types', cli, 'check-identity'], {
        input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
      });
      return { code: 0, out: out.trim() };
    } catch (e) {
      return { code: (e as { status?: number }).status ?? -1, out: ((e as { stdout?: string }).stdout ?? '').trim() };
    }
  };
  const ok = run('{"packageName":"ae.gov.uaeaa.unifiedportal.dev","app":"uaeaa"}');
  assert.deepEqual(ok, { code: 0, out: '' });
  const bad = run('{"packageName":"ae.gov.adaa.unifiedportal","app":"uaeaa"}');
  assert.equal(bad.code, 1);
  assert.match(bad.out, /它看起来是 adaa（ADAA）的包/);
});

test('CLI：slot-paths 列出档位 × 应用的全部槽位', () => {
  const cli = fileURLToPath(new URL('../lib/cli.ts', import.meta.url));
  const rows = execFileSync(process.execPath, ['--experimental-strip-types', cli, 'slot-paths'], {
    encoding: 'utf8',
  })
    .trim()
    .split('\n');
  assert.equal(rows.length, 3 * APPS.length);
  assert.equal(rows[0], 'dev\tadaa\tdev');
  assert.ok(rows.includes('dev\tuaeaa\tdev/uaeaa'));
  assert.ok(rows.includes('release\tuaeaa\trelease/uaeaa'));
});
