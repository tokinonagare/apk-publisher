/**
 * publish.sh 的 Node 侧助手。
 *
 * 分工：shell 负责编排（找文件、ssh、scp），Node 负责解析与渲染。
 * 每个子命令都从 stdin 读输入、往 stdout 写结果，方便在管道里用。
 */

import { readFileSync } from 'node:fs';
import QRCode from 'qrcode';
import { parseBadging } from './apk-info.ts';
import { APPS, apkIdentityMismatch, appHrefPrefix, appPath, DEFAULT_APP, parseApp, tenantEnvValue, type App } from './app.ts';
import { buildApkFileName, parseApkFileName, selectLatestApk, selectStaleApksForTrack, type ScannedApk } from './naming.ts';
import { renderEntryPage, renderPage, renderPlaceholderPage, type SlotApk, type SlotInput } from './render.ts';
import { parseTrack, trackDirectory, TRACKS, type Track } from './track.ts';
import {
  appVariantForTrack,
  bumpConfigText,
  parseReleaseArgs,
  readConfigVersions,
  releaseCommitMessage,
} from './release.ts';

function readStdin(): string {
  return readFileSync(0, 'utf8');
}

/** shell 单引号转义：把 ' 换成 '\'' */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** 生成可直接内联的二维码 SVG。去掉固定宽高，交给 CSS 控制尺寸。 */
async function qrSvg(url: string): Promise<string> {
  const svg = await QRCode.toString(url, {
    type: 'svg',
    margin: 1,
    errorCorrectionLevel: 'M',
  });
  return svg.replace(/\s(width|height)="[^"]*"/g, '');
}

async function main(): Promise<void> {
  const command = process.argv[2];

  switch (command) {
    // aapt2 badging 输出 -> shell 可 eval 的 KEY=VALUE
    case 'info': {
      const info = parseBadging(readStdin());
      process.stdout.write(
        [
          `APK_PACKAGE=${shellQuote(info.packageName)}`,
          `APK_VERSION_NAME=${shellQuote(info.versionName)}`,
          `APK_VERSION_CODE=${shellQuote(info.versionCode)}`,
          `APK_LABEL=${shellQuote(info.label)}`,
        ].join('\n') + '\n',
      );
      return;
    }

    // 档位发布信息 JSON -> 完整的 index.html（该档位下每个应用一组二维码）
    //
    // 输入：{track, base, published:{app,...真实元信息}, slots:{adaa:[{name,sizeBytes,mtimeMs}],...}}
    // published 是本次上传的那个应用；其余应用从 slots 里挑最新的包，信息只能从文件名读。
    case 'render': {
      const raw = JSON.parse(readStdin());
      const track: Track = parseTrack(raw.track);
      const publishedApp: App = parseApp(raw.published?.app);
      const base = String(raw.base).replace(/\/$/, '');
      const apps: SlotInput[] = [];

      for (const app of APPS) {
        const urlBase = `${base}/${appPath(track, app)}`;
        const href = (fileName: string) => `${appHrefPrefix(app)}${encodeURIComponent(fileName)}`;
        if (app === publishedApp) {
          const p = raw.published;
          const apk: SlotApk = {
            label: p.label,
            versionName: p.versionName,
            versionCode: p.versionCode,
            packageName: p.packageName ?? undefined,
            apkFileName: p.apkFileName,
            apkUrl: `${urlBase}/${p.apkFileName}`,
            apkHref: href(p.apkFileName),
            sizeBytes: Number(p.sizeBytes),
            builtAt: p.builtAt == null ? undefined : new Date(p.builtAt),
            publishedAt: p.publishedAt == null ? undefined : new Date(p.publishedAt),
            gitBranch: p.gitBranch ?? undefined,
            gitCommit: p.gitCommit ?? undefined,
            gitDirty: p.gitDirty === true,
            derived: false,
          };
          apps.push({ app, apk, qrSvg: await qrSvg(apk.apkUrl) });
          continue;
        }

        // 另一个应用不在本地，aapt2 读不到：取该槽位最新的包，从文件名里读版本。
        // 文件名解析不出来（手工放上去的、命名不合规则的）就按「尚未发布」显示，
        // 🚫 不猜——猜错的版本号比缺一个二维码更容易让人装错包。
        const latest = selectLatestApk((raw.slots?.[app] ?? []) as ScannedApk[]);
        const parsed = latest ? parseApkFileName(latest.name, track) : null;
        if (!latest || !parsed) {
          apps.push({ app, apk: null, qrSvg: '' });
          continue;
        }
        const apk: SlotApk = {
          label: parsed.label,
          versionName: parsed.versionName,
          versionCode: parsed.versionCode,
          apkFileName: latest.name,
          apkUrl: `${urlBase}/${latest.name}`,
          apkHref: href(latest.name),
          sizeBytes: latest.sizeBytes,
          publishedAt: parsed.publishedAt,
          derived: true,
        };
        apps.push({ app, apk, qrSvg: await qrSvg(apk.apkUrl) });
      }

      process.stdout.write(renderPage({ track, apps }));
      return;
    }

    case 'render-entry': {
      process.stdout.write(renderEntryPage());
      return;
    }

    case 'render-placeholder': {
      process.stdout.write(renderPlaceholderPage(parseTrack(readStdin().trim())));
      return;
    }

    case 'track': {
      process.stdout.write(parseTrack(readStdin().trim()) + '\n');
      return;
    }

    case 'tracks': {
      process.stdout.write(TRACKS.join('\n') + '\n');
      return;
    }

    case 'track-dir': {
      const r = JSON.parse(readStdin());
      process.stdout.write(trackDirectory(r.remoteDir, parseTrack(r.track)) + '\n');
      return;
    }

    // 空输入 = 不传 --app，落缺省应用（缺省值只住在 lib/app.ts 一处，shell 不另写一份）。
    case 'app': {
      const value = readStdin().trim();
      process.stdout.write((value === '' ? DEFAULT_APP : parseApp(value)) + '\n');
      return;
    }

    case 'default-app': {
      process.stdout.write(DEFAULT_APP + '\n');
      return;
    }

    // app -> app 仓的 APP_TENANT 取值（ADAA / UAEAA）
    case 'app-tenant': {
      process.stdout.write(tenantEnvValue(parseApp(readStdin().trim())) + '\n');
      return;
    }

    // {packageName,app} -> 身份不符时输出那句可照着做的话并以非零退出
    case 'check-identity': {
      const r = JSON.parse(readStdin());
      const mismatch = apkIdentityMismatch(String(r.packageName), parseApp(r.app));
      if (mismatch) {
        process.stdout.write(mismatch + '\n');
        process.exitCode = 1;
        return;
      }
      return;
    }

    case 'apps': {
      process.stdout.write(APPS.join('\n') + '\n');
      return;
    }

    // {track,app} -> 该槽位在站点根目录下的相对路径（dev 或 dev/uaeaa）
    case 'app-path': {
      const r = JSON.parse(readStdin());
      process.stdout.write(appPath(parseTrack(r.track), parseApp(r.app)) + '\n');
      return;
    }

    // 全部槽位（档位 × 应用）：<track>\t<app>\t<站点根目录下的相对路径>
    // shell 靠这一条拿到目录清单，不再自己拼路径规则。
    case 'slot-paths': {
      const rows: string[] = [];
      for (const track of TRACKS) {
        for (const app of APPS) rows.push([track, app, appPath(track, app)].join('\t'));
      }
      process.stdout.write(rows.join('\n') + '\n');
      return;
    }

    // find -printf '%f\t%s\t%T@\n' 的输出 -> JSON 数组（一行一个 {name,sizeBytes,mtimeMs}）
    case 'apk-lines': {
      const rows = readStdin()
        .split('\n')
        .filter((line) => line.trim().length > 0)
        .map((line) => {
          const [name, size, mtime] = line.split('\t');
          return { name, sizeBytes: Number(size), mtimeMs: Math.round(parseFloat(mtime) * 1000) };
        });
      process.stdout.write(JSON.stringify(rows) + '\n');
      return;
    }

    // {label,versionName,versionCode,publishedAt} -> 目标文件名
    case 'name': {
      const r = JSON.parse(readStdin());
      process.stdout.write(
        buildApkFileName(parseTrack(r.track), r.label, r.versionName, r.versionCode, new Date(r.publishedAt)) + '\n',
      );
      return;
    }

    // {files:[{name,mtimeMs}], keep} -> 该删的文件名，每行一个
    case 'stale': {
      const { files, keep, track } = JSON.parse(readStdin());
      const stale = selectStaleApksForTrack(files, track, keep);
      if (stale.length > 0) process.stdout.write(stale.join('\n') + '\n');
      return;
    }

    // 终端里直接扫的二维码，省去切浏览器
    case 'qr-terminal': {
      const url = process.argv[3];
      if (!url) throw new Error('qr-terminal 需要一个 URL 参数');
      process.stdout.write(await QRCode.toString(url, { type: 'terminal', small: true }));
      return;
    }

    // ── release.sh 侧助手 ──
    // track -> APP_VARIANT（三档都显式给值，见 lib/release.ts 里那段为什么不能缺省）。
    case 'app-variant': {
      const variant = appVariantForTrack(parseTrack(readStdin().trim()));
      process.stdout.write(variant + '\n');
      return;
    }

    // app.config.ts 全文 -> {"version","versionCode"} JSON
    case 'config-versions': {
      process.stdout.write(JSON.stringify(readConfigVersions(readStdin())) + '\n');
      return;
    }

    // {source,versionCode,version?} -> 改写后的 app.config.ts 全文
    case 'bump-config': {
      const r = JSON.parse(readStdin());
      process.stdout.write(bumpConfigText(r.source, { versionCode: r.versionCode, version: r.version }));
      return;
    }

    // ["--track","dev","--dry-run"] -> {track,version?,dryRun} JSON
    case 'release-args': {
      process.stdout.write(JSON.stringify(parseReleaseArgs(JSON.parse(readStdin()))) + '\n');
      return;
    }

    // {track,oldVersion,newVersion,oldVersionCode,newVersionCode} -> 中文 commit message
    case 'release-commit-message': {
      const r = JSON.parse(readStdin());
      process.stdout.write(releaseCommitMessage(r) + '\n');
      return;
    }

    default:
      throw new Error(`未知子命令: ${command ?? '(空)'}`);
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
