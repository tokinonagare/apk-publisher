import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  appVariantForTrack,
  bumpConfigText,
  formatDryRunPlan,
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
const isDevVariant = process.env.APP_VARIANT === 'development'

const config: ExpoConfig = {
  name: isDevVariant ? 'Unified Portal (Dev)' : 'Unified Portal',
  slug: 'unified-portal-app',
  version: '1.0.8',
  scheme: 'unifiedportal',
  android: {
    // 注释里的 versionCode 1 是干扰项（Expo 默认值 1 的说明文字）。
    // 当前显式值为 9，对应本次发布的 version 1.0.8。
    versionCode: 9,
    package: isDevVariant ? 'ae.gov.adaa.unifiedportal.dev' : 'ae.gov.adaa.unifiedportal',
  },
};
`;

test('track → APP_VARIANT 映射：只有 dev 设 development，uat/release 不设走缺省交付包名', () => {
  assert.equal(appVariantForTrack('dev'), 'development');
  assert.equal(appVariantForTrack('uat'), undefined);
  assert.equal(appVariantForTrack('release'), undefined);
});

test('从源码文本读出 versionCode 与 version（注释里的干扰值不能被读出来）', () => {
  assert.equal(readVersionCode(SAMPLE), 9);
  assert.equal(readVersionName(SAMPLE), '1.0.8');
  assert.deepEqual(readConfigVersions(SAMPLE), { version: '1.0.8', versionCode: 9 });
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

test('参数解析：两种 track 写法、--version 可选、--dry-run 可选', () => {
  assert.deepEqual(parseReleaseArgs(['--track', 'dev']), { track: 'dev', dryRun: false });
  assert.deepEqual(parseReleaseArgs(['--track=uat']), { track: 'uat', dryRun: false });
  assert.deepEqual(parseReleaseArgs(['--track', 'release', '--version', '1.0.9']),
    { track: 'release', version: '1.0.9', dryRun: false });
  assert.deepEqual(parseReleaseArgs(['--track=dev', '--version=1.0.9', '--dry-run']),
    { track: 'dev', version: '1.0.9', dryRun: true });
});

test('commit message 是中文且写清版本号变化', () => {
  const msg = releaseCommitMessage({
    track: 'dev', oldVersion: '1.0.8', newVersion: '1.0.8', oldVersionCode: 9, newVersionCode: 10,
  });
  assert.match(msg, /versionCode 9 → 10/);
  assert.match(msg, /保持不变/);
  const msg2 = releaseCommitMessage({
    track: 'dev', oldVersion: '1.0.8', newVersion: '1.0.9', oldVersionCode: 9, newVersionCode: 10,
  });
  assert.match(msg2, /version 1\.0\.8 → 1\.0\.9/);
});

test('dry-run 计划行含关键值', () => {
  const lines = formatDryRunPlan({
    track: 'dev', appVariant: 'development',
    oldVersion: '1.0.8', newVersion: '1.0.8', oldVersionCode: 9, newVersionCode: 10,
  });
  const text = lines.join('\n');
  assert.match(text, /track: dev/);
  assert.match(text, /APP_VARIANT: development/);
  assert.match(text, /versionCode: 9 → 10/);
  assert.match(text, /publish\.sh --track dev/);
});
