/**
 * 生成下载页。
 *
 * 纯函数：给定一份发布信息，吐出一整个自包含的 HTML 字符串。
 * 页面不引用任何外部脚本、样式或字体——二维码是内联 SVG，样式是内联 <style>。
 * 这样服务器上不需要跑任何进程，nginx 直接发这一个文件即可。
 */

import { formatBytes } from './naming.ts';

export interface RenderInput {
  label: string;
  versionName: string;
  versionCode: string;
  packageName: string;
  apkFileName: string;
  apkUrl: string;
  sizeBytes: number;
  builtAt: Date;
  publishedAt: Date;
  gitBranch?: string | undefined;
  gitCommit?: string | undefined;
  gitDirty?: boolean | undefined;
  /** 已经渲染好的二维码 SVG，指向 apkUrl */
  qrSvg: string;
}

export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatTime(at: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())} ` +
    `${p(at.getHours())}:${p(at.getMinutes())}`
  );
}

/** 元信息表格的一行；value 已在此处转义。 */
function row(name: string, value: string): string {
  return `<div class="row"><dt>${escapeHtml(name)}</dt><dd>${escapeHtml(value)}</dd></div>`;
}

export function renderPage(input: RenderInput): string {
  const {
    label, versionName, versionCode, packageName,
    apkFileName, apkUrl, sizeBytes, builtAt, publishedAt,
    gitBranch, gitCommit, gitDirty, qrSvg,
  } = input;

  // git 信息可能拿不到（比如从仓库外的路径发布），拿不到就整行不渲染，
  // 而不是渲染出 "undefined"。
  const buildRow = gitCommit
    ? row('构建来源', `${gitBranch ?? '?'} @ ${gitCommit}${gitDirty ? ' (dirty·含未提交改动)' : ''}`)
    : '';

  const dirtyBanner = gitDirty
    ? `<p class="warn">⚠️ 此包构建自含未提交改动的工作区（dirty），与任何 commit 都不完全对应</p>`
    : '';

  return `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(label)} ${escapeHtml(versionName)} · 测试包下载</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: #f6f7f9; --card: #fff; --fg: #1a1d21; --muted: #6b7280;
    --line: #e5e7eb; --accent: #2563eb; --accent-fg: #fff; --warn: #b45309;
    --warn-bg: #fef3c7;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0f1216; --card: #171b21; --fg: #e8eaed; --muted: #9aa2ad;
      --line: #2a3038; --accent: #3b82f6; --accent-fg: #fff; --warn: #fbbf24;
      --warn-bg: #3a2f10;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 1.5rem 1rem 3rem; background: var(--bg); color: var(--fg);
    font: 15px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans SC", sans-serif;
    display: flex; justify-content: center;
  }
  .card {
    background: var(--card); border: 1px solid var(--line); border-radius: 14px;
    padding: 1.75rem 1.5rem; max-width: 26rem; width: 100%;
  }
  h1 { font-size: 1.15rem; margin: 0 0 .25rem; }
  .version { font-size: 2rem; font-weight: 650; letter-spacing: -.02em; margin: 0 0 .1rem; }
  .code { color: var(--muted); font-size: .9rem; margin: 0 0 1.5rem; }
  .qr {
    display: flex; justify-content: center; padding: 1rem;
    background: #fff; border-radius: 10px; border: 1px solid var(--line);
  }
  .qr svg { width: 100%; height: auto; max-width: 15rem; display: block; }
  .hint { text-align: center; color: var(--muted); font-size: .85rem; margin: .75rem 0 1.25rem; }
  a.dl {
    display: block; text-align: center; background: var(--accent); color: var(--accent-fg);
    text-decoration: none; padding: .85rem; border-radius: 10px; font-weight: 600;
  }
  a.dl:active { opacity: .8; }
  dl { margin: 1.5rem 0 0; border-top: 1px solid var(--line); }
  .row { display: flex; gap: 1rem; padding: .55rem 0; border-bottom: 1px solid var(--line); font-size: .875rem; }
  dt { color: var(--muted); flex: 0 0 5.5rem; margin: 0; }
  dd { margin: 0; flex: 1; word-break: break-all; }
  .warn {
    background: var(--warn-bg); color: var(--warn); padding: .6rem .8rem;
    border-radius: 8px; font-size: .85rem; margin: 0 0 1.25rem;
  }
  footer { color: var(--muted); font-size: .8rem; margin-top: 1.25rem; line-height: 1.5; }
</style>
<div class="card">
  <h1>${escapeHtml(label)}</h1>
  <p class="version">${escapeHtml(versionName)}</p>
  <p class="code">versionCode ${escapeHtml(versionCode)}</p>
  ${dirtyBanner}
  <div class="qr">${qrSvg}</div>
  <p class="hint">用手机相机扫码安装</p>
  <a class="dl" href="./${encodeURIComponent(apkFileName)}">下载 APK · ${escapeHtml(formatBytes(sizeBytes))}</a>
  <dl>
    ${row('包名', packageName)}
    ${row('构建时间', formatTime(builtAt))}
    ${row('发布时间', formatTime(publishedAt))}
    ${buildRow}
  </dl>
  <footer>
    安装前请在系统设置中允许「安装未知来源应用」。<br>
    若提示「应用未安装」，多为签名与已装版本冲突，卸载旧版后重试。
  </footer>
</div>
<!-- ${escapeHtml(apkUrl)} -->
`;
}
