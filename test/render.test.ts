import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderEntryPage, renderPage, renderPlaceholderPage, escapeHtml, type RenderInput } from '../lib/render.ts';

const BASE: RenderInput = {
  track: 'dev',
  label: 'unified-portal-app',
  versionName: '1.0.0',
  versionCode: '1',
  packageName: 'com.anonymous.unifiedportalapp',
  apkFileName: 'dev-unified-portal-app-1.0.0-1-20260901-1130.apk',
  apkUrl: 'https://apk.example.com/dev/dev-unified-portal-app-1.0.0-1-20260901-1130.apk',
  sizeBytes: 112 * 1024 * 1024,
  builtAt: new Date('2026-08-20T02:41:12+08:00'),
  publishedAt: new Date('2026-09-01T11:30:00+08:00'),
  gitBranch: 'main',
  gitCommit: 'a3f9c1e',
  gitDirty: false,
  qrSvg: '<svg id="qr"></svg>',
};

test('页面含版本号、versionCode、包名与下载链接', () => {
  const html = renderPage(BASE);
  assert.match(html, /1\.0\.0/);
  assert.match(html, /versionCode\s*1/);
  assert.match(html, /com\.anonymous\.unifiedportalapp/);
  assert.match(html, /dev-unified-portal-app-1\.0\.0-1-20260901-1130\.apk/);
});

test('页面显著显示档名，UAT 与 Release 显示互斥提示，Dev 不显示', () => {
  assert.match(renderPage(BASE), />Dev</);
  assert.ok(!renderPage(BASE).includes('同一台设备不能同时安装'));
  assert.match(renderPage({ ...BASE, track: 'uat' }), />UAT</);
  assert.match(renderPage({ ...BASE, track: 'uat' }), /同一台设备不能同时安装/);
  assert.match(renderPage({ ...BASE, track: 'release' }), />Release</);
  assert.match(renderPage({ ...BASE, track: 'release' }), /同一台设备不能同时安装/);
});

test('二维码 SVG 被内联进页面，没有外部脚本或 CDN 依赖', () => {
  const html = renderPage(BASE);
  assert.match(html, /<svg id="qr"><\/svg>/);
  assert.ok(!/<script\s+src=/i.test(html), '不得引用外部脚本');
  assert.ok(!/https?:\/\/(cdn|unpkg|fonts)\./i.test(html), '不得依赖 CDN');
});

test('git 信息展示出来，方便对上是哪次构建', () => {
  const html = renderPage(BASE);
  assert.match(html, /main/);
  assert.match(html, /a3f9c1e/);
});

test('工作区脏时页面上明确标出，避免误判包的来源', () => {
  const html = renderPage({ ...BASE, gitDirty: true });
  assert.match(html, /dirty|未提交/i);
});

test('没有 git 信息时页面照常渲染，不出现 undefined', () => {
  const html = renderPage({ ...BASE, gitBranch: undefined, gitCommit: undefined });
  assert.ok(!html.includes('undefined'), '页面不得出现 undefined');
});

test('label 中的 HTML 被转义，不会注入标签', () => {
  const html = renderPage({ ...BASE, label: '<img src=x onerror=alert(1)>' });
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

test('入口页列出三个英文档名与中文说明', () => {
  const html = renderEntryPage();
  for (const track of ['Dev', 'UAT', 'Release']) assert.match(html, new RegExp(track));
  assert.match(html, /开发人员|测试人员|发布人员/);
});

test('占位页明确提示尚未发布', () => {
  assert.match(renderPlaceholderPage('release'), /Release/);
  assert.match(renderPlaceholderPage('release'), /尚未发布/);
});
