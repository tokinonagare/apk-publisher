import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBadging } from '../lib/apk-info.ts';

// 真实 aapt2 输出的片段（取自 unified-portal-app 的 release 包）
const REAL = `package: name='com.anonymous.unifiedportalapp' versionCode='1' versionName='1.0.0' platformBuildVersionName='16' platformBuildVersionCode='36' compileSdkVersion='36'
sdkVersion:'24'
targetSdkVersion:'36'
application-label:'unified-portal-app'
application-label-en:'unified-portal-app'
native-code: 'arm64-v8a' 'armeabi-v7a'
`;

test('从真实 aapt2 输出解析出四个字段', () => {
  assert.deepEqual(parseBadging(REAL), {
    packageName: 'com.anonymous.unifiedportalapp',
    versionCode: '1',
    versionName: '1.0.0',
    label: 'unified-portal-app',
  });
});

test('versionName 含空格与中文也能取全', () => {
  const out = `package: name='com.x.y' versionCode='42' versionName='2.1.0 beta'
application-label:'统一门户 App'`;
  const info = parseBadging(out);
  assert.equal(info.versionName, '2.1.0 beta');
  assert.equal(info.label, '统一门户 App');
  assert.equal(info.versionCode, '42');
});

test('label 缺失时回退到包名，而不是留空', () => {
  const out = `package: name='com.x.y' versionCode='7' versionName='1.0'`;
  assert.equal(parseBadging(out).label, 'com.x.y');
});

test('缺少 package 行时响亮报错，不静默返回空对象', () => {
  assert.throws(() => parseBadging('application-label:\'x\'\n'), /package/i);
});

test('versionCode 缺失时报错', () => {
  assert.throws(() => parseBadging(`package: name='com.x.y' versionName='1.0'`), /versionCode/i);
});
