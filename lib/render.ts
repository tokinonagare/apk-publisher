/**
 * 生成下载页。
 *
 * 纯函数：给定一份档位信息（含该档位下所有应用），吐出一整个自包含的 HTML 字符串。
 * 页面不引用任何外部脚本、样式或字体——二维码是内联 SVG，样式是内联 <style>。
 * 这样服务器上不需要跑任何进程，nginx 直接发这一个文件即可。
 *
 * 一个档位一页、一页多个应用（ADAA / UAEAA），每个应用一组版本信息 + 二维码 + 下载按钮。
 * 「本次只发其中一个应用」时，另一个应用的信息由调用方扫服务器目录得到（见 cli.ts）。
 */

import { formatBytes } from './naming.ts';
import { APPS, appLabel, appPlaceholderNote, type App } from './app.ts';
import { TRACKS, installCoexistenceNotice, trackLabel, trackPlaceholder, type Track } from './track.ts';

/** 一个应用在这一档里的当前包；缺字段表示这个包不在本地、信息只能从文件名读。 */
export interface SlotApk {
  label: string;
  versionName: string;
  versionCode: string;
  apkFileName: string;
  apkUrl: string;
  /** 相对档位页目录的下载路径（非缺省应用要带上自己那层子目录，否则 404）。 */
  apkHref: string;
  sizeBytes: number;
  /** true = 元信息解析自文件名，不是 aapt2 读出来的（构建时间因此拿不到）。 */
  derived: boolean;
  packageName?: string | undefined;
  builtAt?: Date | undefined;
  publishedAt?: Date | undefined;
  gitBranch?: string | undefined;
  gitCommit?: string | undefined;
  gitDirty?: boolean | undefined;
}

export interface SlotInput {
  app: App;
  apk: SlotApk | null;
  /** 已经渲染好的二维码 SVG；apk 为 null 时是空串。 */
  qrSvg: string;
}

export interface RenderInput {
  track: Track;
  apps: SlotInput[];
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

/** 一个应用的整组信息；apk 为 null 时渲染「尚未发布」占位。 */
function renderSlot(slot: SlotInput): string {
  const name = appLabel(slot.app);
  const apk = slot.apk;
  if (!apk) {
    return `<section class="app">
  <h2>${escapeHtml(name)}</h2>
  <p class="empty">这一档还没有 ${escapeHtml(name)} 的包。</p>
</section>
`;
  }

  const buildRow = apk.gitCommit
    ? row('构建来源', `${apk.gitBranch ?? '?'} @ ${apk.gitCommit}${apk.gitDirty ? ' (dirty·含未提交改动)' : ''}`)
    : '';
  const dirtyBanner = apk.gitDirty
    ? `<p class="warn">⚠️ 此包构建自含未提交改动的工作区（dirty），与任何 commit 都不完全对应</p>`
    : '';
  // 从文件名读回来的那一侧拿不到构建时间，也不该假装有 git 信息——
  // 标一句「取自文件名」，读页面的人才知道这一侧的可信度低一档。
  const derivedNote = apk.derived
    ? `<p class="derived">此应用的信息取自文件名（本次未重新解析该 APK）</p>`
    : '';

  return `<section class="app">
  <h2>${escapeHtml(name)}<span class="app-label">${escapeHtml(apk.label)}</span></h2>
  <p class="version">${escapeHtml(apk.versionName)}</p>
  <p class="code">versionCode ${escapeHtml(apk.versionCode)}</p>
  ${dirtyBanner}${derivedNote}
  <div class="qr">${slot.qrSvg}</div>
  <p class="hint">用手机相机扫码安装</p>
  <a class="dl" href="./${apk.apkHref}">下载 APK · ${escapeHtml(formatBytes(apk.sizeBytes))}</a>
  <dl>
    ${apk.packageName ? row('包名', apk.packageName) : ''}
    ${apk.builtAt ? row('构建时间', formatTime(apk.builtAt)) : ''}
    ${apk.publishedAt ? row('发布时间', formatTime(apk.publishedAt)) : ''}
    ${buildRow}
  </dl>
  <!-- ${escapeHtml(apk.apkUrl)} -->
</section>
`;
}

export function renderPage(input: RenderInput): string {
  const { track, apps } = input;
  const badge = trackLabel(track);
  const coexistence = installCoexistenceNotice();
  const sections = apps.map(renderSlot).join('\n');

  return `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(badge)} · ${escapeHtml(apps.map((a) => appLabel(a.app)).join(' / '))} 测试包下载</title>
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
  .badge { display: inline-block; background: var(--accent); color: var(--accent-fg); padding: .25rem .6rem; border-radius: 999px; font-weight: 700; font-size: .8rem; margin-bottom: .65rem; }
  .lead { color: var(--muted); font-size: .9rem; margin: 0 0 1.25rem; }
  .app { border-top: 1px solid var(--line); padding-top: 1.25rem; margin-top: 1.25rem; }
  .app h2 { font-size: 1rem; margin: 0 0 .5rem; display: flex; align-items: baseline; gap: .5rem; }
  .app-label { color: var(--muted); font-weight: 400; font-size: .82rem; }
  .version { font-size: 1.8rem; font-weight: 650; letter-spacing: -.02em; margin: 0 0 .1rem; }
  .code { color: var(--muted); font-size: .9rem; margin: 0 0 1rem; }
  .empty { color: var(--muted); font-size: .9rem; margin: 0; }
  .qr {
    display: flex; justify-content: center; padding: 1rem;
    background: #fff; border-radius: 10px; border: 1px solid var(--line);
  }
  .qr svg { width: 100%; height: auto; max-width: 13rem; display: block; }
  .hint { text-align: center; color: var(--muted); font-size: .85rem; margin: .6rem 0 1rem; }
  a.dl {
    display: block; text-align: center; background: var(--accent); color: var(--accent-fg);
    text-decoration: none; padding: .8rem; border-radius: 10px; font-weight: 600;
  }
  a.dl:active { opacity: .8; }
  dl { margin: 1.1rem 0 0; border-top: 1px solid var(--line); }
  .row { display: flex; gap: 1rem; padding: .5rem 0; border-bottom: 1px solid var(--line); font-size: .85rem; }
  dt { color: var(--muted); flex: 0 0 5.5rem; margin: 0; }
  dd { margin: 0; flex: 1; word-break: break-all; }
  .warn {
    background: var(--warn-bg); color: var(--warn); padding: .6rem .8rem;
    border-radius: 8px; font-size: .85rem; margin: 0 0 1rem;
  }
  .derived { color: var(--muted); font-size: .78rem; margin: 0 0 1rem; }
  footer { color: var(--muted); font-size: .8rem; margin-top: 1.5rem; line-height: 1.5; }
</style>
<div class="card">
  <div class="badge">${escapeHtml(badge)}</div>
  <h1>${escapeHtml(apps.map((a) => appLabel(a.app)).join(' / '))} 测试包下载</h1>
  <p class="lead">下面每个应用一个二维码，扫对应应用的那个。</p>
  <p class="warn">${escapeHtml(coexistence)}</p>
${sections}  <footer>
    安装前请在系统设置中允许「安装未知来源应用」。<br>
    若提示「应用未安装」，多为签名与已装版本冲突，卸载旧版后重试。
  </footer>
</div>
`;
}

export function renderPlaceholderPage(track: Track): string {
  const label = trackLabel(track);
  const lines = APPS.map((app) => `<p>${escapeHtml(appPlaceholderNote(app))}</p>`).join('\n    ');
  return `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(label)} · 尚未发布</title>
<style>
  :root { color-scheme: light dark; --bg:#f6f7f9; --fg:#1a1d21; --muted:#6b7280; }
  @media (prefers-color-scheme: dark) { :root { --bg:#0f1216; --fg:#e8eaed; --muted:#9aa2ad; } }
  body { margin:0; min-height:100vh; display:grid; place-items:center; background:var(--bg); color:var(--fg); font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans SC",sans-serif; }
  main { text-align:center; padding:2rem; } h1 { margin:0 0 .5rem; } p { color:var(--muted); }
</style>
<main><h1>${escapeHtml(label)}</h1>
    <p>${escapeHtml(trackPlaceholder(track))}</p>
    ${lines}
</main>
`;
}

export function renderEntryPage(): string {
  const descriptions: Record<Track, string> = {
    dev: '给开发人员验证日常开发版本',
    uat: '给测试人员验证 UAT 环境版本',
    release: '给发布人员验证生产版本',
  };
  const links = TRACKS.map((track) => `<a class="track" href="./${track}/"><strong>${trackLabel(track)}</strong><span>${descriptions[track]}</span></a>`).join('\n');
  return `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Unified Portal APK 下载</title>
<style>
  :root { color-scheme: light dark; --bg:#f6f7f9; --card:#fff; --fg:#1a1d21; --muted:#6b7280; --line:#e5e7eb; --accent:#2563eb; }
  @media (prefers-color-scheme: dark) { :root { --bg:#0f1216; --card:#171b21; --fg:#e8eaed; --muted:#9aa2ad; --line:#2a3038; --accent:#3b82f6; } }
  body { margin:0; min-height:100vh; display:grid; place-items:center; background:var(--bg); color:var(--fg); font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans SC",sans-serif; }
  main { width:min(32rem,calc(100% - 2rem)); } h1 { margin:0 0 1.5rem; } .track { display:flex; justify-content:space-between; align-items:center; gap:1rem; padding:1rem 1.1rem; margin:.75rem 0; background:var(--card); border:1px solid var(--line); border-radius:12px; color:var(--fg); text-decoration:none; } .track strong { color:var(--accent); font-size:1.1rem; } .track span { color:var(--muted); text-align:right; font-size:.9rem; }
  p.note { color:var(--muted); font-size:.9rem; margin:1.25rem 0 0; }
</style>
<main><h1>Unified Portal APK 下载</h1>${links}
<p class="note">每一档都含 ADAA 与 UAEAA 两个应用的下载二维码。</p>
</main>
`;
}
