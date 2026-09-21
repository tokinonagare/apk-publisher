/**
 * publish.sh 的 Node 侧助手。
 *
 * 分工：shell 负责编排（找文件、ssh、scp），Node 负责解析与渲染。
 * 每个子命令都从 stdin 读输入、往 stdout 写结果，方便在管道里用。
 */

import { readFileSync } from 'node:fs';
import QRCode from 'qrcode';
import { parseBadging } from './apk-info.ts';
import { buildApkFileName, selectStaleApksForTrack } from './naming.ts';
import { renderEntryPage, renderPage, renderPlaceholderPage, type RenderInput } from './render.ts';
import { parseTrack, trackDirectory, TRACKS } from './track.ts';
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

    // 发布信息 JSON -> 完整的 index.html
    case 'render': {
      const raw = JSON.parse(readStdin());
      const input: RenderInput = {
        ...raw,
        builtAt: new Date(raw.builtAt),
        publishedAt: new Date(raw.publishedAt),
        qrSvg: await qrSvg(raw.apkUrl),
      };
      process.stdout.write(renderPage(input));
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
    // track -> APP_VARIANT。uat/release 不设，输出空行。
    case 'app-variant': {
      const variant = appVariantForTrack(parseTrack(readStdin().trim()));
      process.stdout.write((variant ?? '') + '\n');
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
