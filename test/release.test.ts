import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  appVariantForTrack,
  bumpConfigText,
  parseReleaseArgs,
  readConfigVersions,
  readVersionCode,
  readVersionName,
  releaseCommitMessage,
  withVersionCode,
  withVersionName,
} from '../lib/release.ts';

/** 取自真实 app.config.ts 的结构（顶层 version + android 块内 versionCode，另有注释里的版本号干扰项）。 */
const SAMPLE = `// 这条注释里有个 version 1.0.0，是干扰项，不能被读出来。
const BACKEND_VARIANTS = {
  development: { package: 'ae.gov.adaa.unifiedportal.dev', name: 'Unified Portal (Dev)', host: '10.224.0.34' },
  uat: { package: 'ae.gov.adaa.unifiedportal.uat', name: 'Unified Portal (UAT)', host: 'unified-uat.adaa.gov.ae' },
  production: { package: 'ae.gov.adaa.unifiedportal', name: 'Unified Portal', host: 'unified.adaa.gov.ae' },
}

const config: ExpoConfig = {
  name: VARIANT.name,
  slug: 'unified-portal-app',
  version: '1.0.8',
  scheme: 'unifiedportal',
  android: {
    // 注释里的 versionCode 1 是干扰项（Expo 默认值 1 的说明文字）。
    // 当前显式值为 9，对应本次发布的 version 1.0.8。
    versionCode: 9,
    package: VARIANT.package,
  },
};
`;

test('track → APP_VARIANT 映射：三档都显式给值（app 仓 #348 起 uat 有自己的包名与 host）', () => {
  assert.equal(appVariantForTrack('dev'), 'development');
  assert.equal(appVariantForTrack('uat'), 'uat');
  assert.equal(appVariantForTrack('release'), 'production');
  // 🔴 回归守卫：本仓曾把 uat 映射成 undefined（不设变量 = 交付档），
  // 于是 --track uat 构建出的是连生产 host 的交付包，页面上还不报错。
  assert.notEqual(appVariantForTrack('uat'), appVariantForTrack('release'));
});

test('从源码文本读出 versionCode 与 version（注释里的干扰值不能被读出来）', () => {
  assert.equal(readVersionCode(SAMPLE), 9);
  assert.equal(readVersionName(SAMPLE), '1.0.8');
  assert.deepEqual(readConfigVersions(SAMPLE), { version: '1.0.8', versionCode: 9 });
});

test('注释里带冒号的 versionCode 不能被读出来或改写（行首锚定）', () => {
  const src = `android: {
    // 上一版 versionCode: 888，已弃用
    versionCode: 9,
  },
`;
  assert.equal(readVersionCode(src), 9);
  const out = withVersionCode(src, 10);
  assert.match(out, /\/\/ 上一版 versionCode: 888，已弃用/);
  assert.match(out, /^[ \t]*versionCode: 10,/m);
  assert.equal(readVersionCode(out), 10);
});

test('改写 versionCode 只动 android 块内那一处', () => {
  const out = withVersionCode(SAMPLE, 10);
  assert.equal(readVersionCode(out), 10);
  assert.equal(readVersionName(out), '1.0.8');
  // 注释里的干扰文字原样保留
  assert.match(out, /Expo 默认值 1/);
  assert.match(out, /versionCode: 10/);
});

test('改写 version 只动顶层那一处', () => {
  const out = withVersionName(SAMPLE, '1.0.9');
  assert.equal(readVersionName(out), '1.0.9');
  assert.equal(readVersionCode(out), 9);
  // 注释里的干扰版本号原样保留
  assert.match(out, /version 1\.0\.0/);
  assert.match(out, /version 1\.0\.8/);
});

test('bump：versionCode 必换，version 只在传了时才换', () => {
  const kept = bumpConfigText(SAMPLE, { versionCode: 10 });
  assert.equal(readVersionCode(kept), 10);
  assert.equal(readVersionName(kept), '1.0.8');
  const changed = bumpConfigText(SAMPLE, { versionCode: 10, version: '1.0.9' });
  assert.equal(readVersionCode(changed), 10);
  assert.equal(readVersionName(changed), '1.0.9');
});

test('--track 必须显式传：缺省与非法都硬失败', () => {
  assert.throws(() => parseReleaseArgs([]), /缺少 --track/);
  assert.throws(() => parseReleaseArgs(['--dry-run']), /缺少 --track/);
  assert.throws(() => parseReleaseArgs(['--track', 'prod']), /dev、uat、release/);
  assert.throws(() => parseReleaseArgs(['--wat', 'dev']), /未知参数/);
});

test('--app 可选，缺省落 adaa；两种写法都支持，非法值硬失败', () => {
  assert.equal(parseReleaseArgs(['--track', 'dev']).app, 'adaa');
  assert.equal(parseReleaseArgs(['--track', 'dev', '--app', 'uaeaa']).app, 'uaeaa');
  assert.equal(parseReleaseArgs(['--track=dev', '--app=uaeaa']).app, 'uaeaa');
  assert.throws(() => parseReleaseArgs(['--track', 'dev', '--app', 'adaa3']), /adaa、uaeaa/);
  assert.throws(() => parseReleaseArgs(['--track', 'dev', '--app']), /缺少 --app 的值/);
});

test('参数解析：两种 track 写法、--version 可选、--dry-run 可选', () => {
  assert.deepEqual(parseReleaseArgs(['--track', 'dev']), { track: 'dev', app: 'adaa', dryRun: false });
  assert.deepEqual(parseReleaseArgs(['--track=uat']), { track: 'uat', app: 'adaa', dryRun: false });
  assert.deepEqual(parseReleaseArgs(['--track', 'release', '--version', '1.0.9']),
    { track: 'release', app: 'adaa', version: '1.0.9', dryRun: false });
  assert.deepEqual(parseReleaseArgs(['--track=dev', '--version=1.0.9', '--dry-run']),
    { track: 'dev', app: 'adaa', version: '1.0.9', dryRun: true });
});

test('commit message 是中文、写明是哪个应用推的计数器', () => {
  const msg = releaseCommitMessage({
    track: 'dev', app: 'adaa', oldVersion: '1.0.8', newVersion: '1.0.8', oldVersionCode: 9, newVersionCode: 10,
  });
  assert.match(msg, /发版（dev · adaa）/);
  assert.match(msg, /versionCode 9 → 10/);
  assert.match(msg, /保持不变/);
  const msg2 = releaseCommitMessage({
    track: 'dev', app: 'uaeaa', oldVersion: '1.0.8', newVersion: '1.0.9', oldVersionCode: 9, newVersionCode: 10,
  });
  assert.match(msg2, /发版（dev · uaeaa）/);
  assert.match(msg2, /version 1\.0\.8 → 1\.0\.9/);
});
