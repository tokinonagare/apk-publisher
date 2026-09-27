import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  renderEntryPage,
  renderPage,
  renderPlaceholderPage,
  escapeHtml,
  type RenderInput,
  type SlotApk,
  type SlotInput,
} from '../lib/render.ts';
import type { App } from '../lib/app.ts';

const ADAA_APK: SlotApk = {
  label: 'unified-portal-app',
  versionName: '1.0.0',
  versionCode: '1',
  packageName: 'ae.gov.adaa.unifiedportal.dev',
  apkFileName: 'dev-unified-portal-app-1.0.0-1-20260901-1130.apk',
  apkUrl: 'https://apk.example.com/dev/dev-unified-portal-app-1.0.0-1-20260901-1130.apk',
  apkHref: 'dev-unified-portal-app-1.0.0-1-20260901-1130.apk',
  sizeBytes: 112 * 1024 * 1024,
  builtAt: new Date('2026-08-20T02:41:12+08:00'),
  publishedAt: new Date('2026-09-01T11:30:00+08:00'),
  gitBranch: 'main',
  gitCommit: 'a3f9c1e',
  gitDirty: false,
  derived: false,
};

const UAEAA_APK: SlotApk = {
  ...ADAA_APK,
  label: 'uaeaa-unified-portal',
  apkFileName: 'dev-uaeaa-unified-portal-1.0.0-1-20260901-1140.apk',
  apkUrl: 'https://apk.example.com/dev/uaeaa/dev-uaeaa-unified-portal-1.0.0-1-20260901-1140.apk',
  apkHref: 'uaeaa/dev-uaeaa-unified-portal-1.0.0-1-20260901-1140.apk',
  // 另一侧的信息来自文件名解析：没有 packageName / builtAt / git，且带 derived 标记。
  packageName: undefined,
  builtAt: undefined,
  gitBranch: undefined,
  gitCommit: undefined,
  gitDirty: undefined,
  derived: true,
};

function slot(app: App, apk: SlotApk | null): SlotInput {
  return { app, apk, qrSvg: apk ? `<svg id="qr-${app}"></svg>` : '' };
}

const BASE: RenderInput = { track: 'dev', apps: [slot('adaa', ADAA_APK), slot('uaeaa', UAEAA_APK)] };

test('页面含版本号、versionCode、包名与下载链接', () => {
  const html = renderPage(BASE);
  assert.match(html, /1\.0\.0/);
  assert.match(html, /versionCode\s*1/);
  assert.match(html, /ae\.gov\.adaa\.unifiedportal\.dev/);
  assert.match(html, /dev-unified-portal-app-1\.0\.0-1-20260901-1130\.apk/);
});

test('一页两组码：两个应用各自有二维码，且各指自己的 APK', () => {
  const html = renderPage(BASE);
  assert.match(html, /<svg id="qr-adaa"><\/svg>/);
  assert.match(html, /<svg id="qr-uaeaa"><\/svg>/);
  assert.match(html, /ADAA/);
  assert.match(html, /UAEAA/);
  // 两个下载按钮的 href 必须分开，且各自带上自己那层目录——页面在 dev/，
  // UAEAA 的包在 dev/uaeaa/，少了前缀点了就是 404。
  assert.match(html, /href="\.\/dev-unified-portal-app-1\.0\.0-1-20260901-1130\.apk"/);
  assert.match(html, /href="\.\/uaeaa\/dev-uaeaa-unified-portal-1\.0\.0-1-20260901-1140\.apk"/);
});

test('ADAA 的链接仍在档位根目录，UAEAA 在自己的子目录（旧码不能失效）', () => {
  const html = renderPage(BASE);
  assert.match(
    html,
    /https:\/\/apk\.example\.com\/dev\/dev-unified-portal-app-1\.0\.0-1-20260901-1130\.apk/,
  );
  assert.match(
    html,
    /https:\/\/apk\.example\.com\/dev\/uaeaa\/dev-uaeaa-unified-portal-1\.0\.0-1-20260901-1140\.apk/,
  );
});

test('从文件名读回来的那一侧标明来源，且不假装知道构建时间', () => {
  const html = renderPage(BASE);
  assert.match(html, /信息取自文件名/);
  assert.match(html, /构建时间/); // ADAA 那一侧仍有构建时间
  const rows = html.split('构建时间');
  // ADAA 有构建时间那一行，UAEAA 没有：整页只出现一次。
  assert.equal(rows.length - 1, 1, '派生侧不得渲染构建时间行');
});

test('另一侧没有包时显示尚未发布，页面其余部分照常', () => {
  const html = renderPage({ track: 'dev', apps: [slot('adaa', ADAA_APK), slot('uaeaa', null)] });
  assert.match(html, /UAEAA<\/h2>/);
  assert.match(html, /还没有 UAEAA 的包/);
  assert.match(html, /<svg id="qr-adaa"><\/svg>/);
  assert.ok(!html.includes('undefined'), '页面不得出现 undefined');
});

test('页面显著显示档名', () => {
  assert.match(renderPage(BASE), />Dev</);
  assert.match(renderPage({ ...BASE, track: 'uat' }), />UAT</);
  assert.match(renderPage({ ...BASE, track: 'release' }), />Release</);
});

test('三档都说明包名互不相同、可并存（不再有「切换前卸载」的错误提示）', () => {
  for (const track of ['dev', 'uat', 'release'] as const) {
    const html = renderPage({ ...BASE, track });
    assert.match(html, /并存安装/);
    assert.ok(!html.includes('同一台设备不能同时安装'), `${track} 档不得出现旧互斥提示`);
    assert.ok(!html.includes('切换前请先卸载'), `${track} 档不得要求先卸载`);
  }
});

test('二维码 SVG 被内联进页面，没有外部脚本或 CDN 依赖', () => {
  const html = renderPage(BASE);
  assert.match(html, /<svg id="qr-adaa"><\/svg>/);
  assert.ok(!/<script\s+src=/i.test(html), '不得引用外部脚本');
  assert.ok(!/https?:\/\/(cdn|unpkg|fonts)\./i.test(html), '不得依赖 CDN');
});

test('git 信息展示出来，方便对上是哪次构建', () => {
  const html = renderPage(BASE);
  assert.match(html, /main/);
  assert.match(html, /a3f9c1e/);
});

test('工作区脏时页面上明确标出，避免误判包的来源', () => {
  const html = renderPage({
    track: 'dev',
    apps: [slot('adaa', { ...ADAA_APK, gitDirty: true }), slot('uaeaa', null)],
  });
  assert.match(html, /dirty|未提交/i);
});

test('没有 git 信息时页面照常渲染，不出现 undefined', () => {
  const html = renderPage({
    track: 'dev',
    apps: [slot('adaa', { ...ADAA_APK, gitBranch: undefined, gitCommit: undefined }), slot('uaeaa', null)],
  });
  assert.ok(!html.includes('undefined'), '页面不得出现 undefined');
});

test('label 中的 HTML 被转义，不会注入标签', () => {
  const html = renderPage({
    track: 'dev',
    apps: [slot('adaa', { ...ADAA_APK, label: '<img src=x onerror=alert(1)>' }), slot('uaeaa', null)],
  });
  assert.ok(!html.includes('<img src=x'), '原始标签不得进入页面');
  assert.match(html, /&lt;img/);
});

test('escapeHtml 覆盖五个危险字符', () => {
  assert.equal(escapeHtml(`<>&"'`), '&lt;&gt;&amp;&quot;&#39;');
});

test('包大小以人类可读形式出现', () => {
  assert.match(renderPage(BASE), /112\.0 MB/);
});

test('页面声明 utf-8 与移动端 viewport', () => {
  const html = renderPage(BASE);
  assert.match(html, /charset=["']?utf-8/i);
  assert.match(html, /name=["']viewport["']/i);
});

test('入口页列出三个英文档名与中文说明，并说明每档有两个应用', () => {
  const html = renderEntryPage();
  for (const track of ['Dev', 'UAT', 'Release']) assert.match(html, new RegExp(track));
  assert.match(html, /开发人员|测试人员|发布人员/);
  assert.match(html, /ADAA.*UAEAA/);
});

test('占位页对每个应用都明确提示尚未发布', () => {
  const html = renderPlaceholderPage('release');
  assert.match(html, /Release/);
  assert.match(html, /尚未发布/);
  assert.match(html, /ADAA 尚未发布 APK/);
  assert.match(html, /UAEAA 尚未发布 APK/);
});
