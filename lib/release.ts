/**
 * release.sh 的判定逻辑（纯函数，不碰网络与文件系统）。
 *
 * 分工：这里只做「判断与文本改写」，shell 负责编排（git / prebuild / gradle / publish）。
 * track 值域复用 lib/track.ts，不另写一份。
 */

import { parseTrack, type Track } from './track.ts';

export interface ReleaseArgs {
  track: Track;
  /** 传了 --version 才有，不传为 undefined（versionName 保持不动）。 */
  version?: string;
  dryRun: boolean;
}

const TRACK_USAGE = './release.sh --track dev|uat|release [--version 1.0.9] [--dry-run]';

/**
 * track → APP_VARIANT 映射（本脚本的核心，写死）。
 *
 * dev 档产出 .dev 包；uat / release 不设 APP_VARIANT，走缺省的交付包名。
 * 缺省必须是 production：忘设时产出交付包名，而不是把 .dev 发给客户。
 */
export function appVariantForTrack(track: Track): string | undefined {
  if (track === 'dev') return 'development';
  return undefined;
}

/** 从 app.config.ts 源码文本里读出 android 块内的 versionCode。锚定在 android: 块内匹配，不硬编码行号。 */
export function readVersionCode(source: string): number {
  const androidIndex = source.indexOf('android:');
  if (androidIndex === -1) throw new Error('app.config.ts 里找不到 android: 块，无法读取 versionCode');
  const after = source.slice(androidIndex);
  const match = after.match(/versionCode\s*:\s*(\d+)/);
  if (!match) throw new Error('app.config.ts 的 android 块里找不到 versionCode，无法读取');
  return Number(match[1]);
}

/**
 * 从 app.config.ts 源码文本里读出顶层 version（即 versionName）。
 * 锚定在 android: 块之前匹配——version 这个词在文件里出现很多次，
 * 全文取第一个会撞上注释里的版本号，全文替换更危险。
 */
export function readVersionName(source: string): string {
  const androidIndex = source.indexOf('android:');
  const head = androidIndex === -1 ? source : source.slice(0, androidIndex);
  const match = head.match(/^[ \t]*version\s*:\s*'([^']+)'/m);
  if (!match) throw new Error('app.config.ts 里找不到顶层 version，无法读取');
  return match[1];
}

export function readConfigVersions(source: string): { version: string; versionCode: number } {
  return { version: readVersionName(source), versionCode: readVersionCode(source) };
}

/** 产出改写后的 app.config.ts 文本：只换 android 块内的 versionCode，其余不动。 */
export function withVersionCode(source: string, next: number): string {
  if (!Number.isInteger(next) || next < 0) throw new Error(`versionCode 非法: ${String(next)}`);
  const androidIndex = source.indexOf('android:');
  if (androidIndex === -1) throw new Error('app.config.ts 里找不到 android: 块，无法改写 versionCode');
  const head = source.slice(0, androidIndex);
  const tail = source.slice(androidIndex);
  const match = tail.match(/versionCode\s*:\s*\d+/);
  if (!match || match.index === undefined) throw new Error('app.config.ts 的 android 块里找不到 versionCode，无法改写');
  return head + tail.slice(0, match.index) + `versionCode: ${next}` + tail.slice(match.index + match[0].length);
}

/** 产出改写后的 app.config.ts 文本：只换 android 块之前的顶层 version，其余不动。 */
export function withVersionName(source: string, next: string): string {
  if (next.length === 0) throw new Error('version 不能为空');
  const androidIndex = source.indexOf('android:');
  const head = androidIndex === -1 ? source : source.slice(0, androidIndex);
  const tail = androidIndex === -1 ? '' : source.slice(androidIndex);
  const match = head.match(/^[ \t]*version\s*:\s*'[^']*'/m);
  if (!match || match.index === undefined) throw new Error('app.config.ts 里找不到顶层 version，无法改写');
  const replacement = match[0].replace(/'[^']*'/, `'${next}'`);
  return head.slice(0, match.index) + replacement + head.slice(match.index + match[0].length) + tail;
}

export interface BumpOptions {
  versionCode: number;
  /** 不传则 versionName 保持不动。 */
  version?: string;
}

/**
 * 一次改写出新文本：versionCode 必换，version 只在给了新值时才换。
 * 调用方改完必须读回来验证（readConfigVersions），不对就硬失败——见 release.sh。
 */
export function bumpConfigText(source: string, options: BumpOptions): string {
  let out = withVersionCode(source, options.versionCode);
  if (options.version !== undefined) out = withVersionName(out, options.version);
  return out;
}

/**
 * 参数解析（纯函数）。--track 必须显式传，不传或非法都硬失败；
 * 同时支持 --track=dev 写法。未知参数硬失败。
 */
export function parseReleaseArgs(argv: readonly string[]): ReleaseArgs {
  let trackValue: string | undefined;
  let version: string | undefined;
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--track') {
      if (i + 1 >= argv.length || argv[i + 1].startsWith('-')) {
        throw new Error(`缺少 --track 的值；合法值：dev、uat、release。用法：${TRACK_USAGE}`);
      }
      trackValue = argv[i + 1];
      i++;
    } else if (arg.startsWith('--track=')) {
      trackValue = arg.slice('--track='.length);
    } else if (arg === '--version') {
      if (i + 1 >= argv.length || argv[i + 1].startsWith('-')) {
        throw new Error(`缺少 --version 的值。用法：${TRACK_USAGE}`);
      }
      version = argv[i + 1];
      i++;
    } else if (arg.startsWith('--version=')) {
      version = arg.slice('--version='.length);
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else {
      throw new Error(`未知参数：${arg}。用法：${TRACK_USAGE}`);
    }
  }
  if (trackValue === undefined || trackValue === '') {
    throw new Error(`缺少 --track，得显式传 dev、uat、release 其中之一。用法：${TRACK_USAGE}`);
  }
  const track = parseTrack(trackValue);
  if (version !== undefined && version === '') throw new Error(`--version 不能为空。用法：${TRACK_USAGE}`);
  return version === undefined ? { track, dryRun } : { track, version, dryRun };
}

/** 本地 commit 只包含 app.config.ts 一个文件，message 写清版本号变化（中文）。 */
export function releaseCommitMessage(input: {
  track: Track;
  oldVersion: string;
  newVersion: string;
  oldVersionCode: number;
  newVersionCode: number;
}): string {
  const versionPart =
    input.oldVersion === input.newVersion
      ? `version ${input.oldVersion} 保持不变`
      : `version ${input.oldVersion} → ${input.newVersion}`;
  return (
    `发版（${input.track}）：versionCode ${input.oldVersionCode} → ${input.newVersionCode}，` +
    `${versionPart}`
  );
}

/** --dry-run 打印的计划行：只做字符串拼接，不读任何外部状态。 */
export function formatDryRunPlan(input: {
  track: Track;
  appVariant: string | undefined;
  oldVersion: string;
  newVersion: string;
  oldVersionCode: number;
  newVersionCode: number;
}): string[] {
  const variant = input.appVariant === undefined ? '（不设，走缺省交付包名）' : input.appVariant;
  return [
    `track: ${input.track}`,
    `APP_VARIANT: ${variant}`,
    `version: ${input.oldVersion} → ${input.newVersion}`,
    `versionCode: ${input.oldVersionCode} → ${input.newVersionCode}`,
    '步骤：git pull --rebase → 检查 app.config.ts 干净 → 改版本号 → 只提交 app.config.ts（不 push）',
    `步骤：APP_VARIANT=${input.appVariant ?? ''} npx expo prebuild --platform android`.replace('APP_VARIANT= ', ''),
    '步骤：./gradlew assembleRelease（cwd: <APP_REPO>/android）',
    `步骤：./publish.sh --track ${input.track} <刚构建出的 apk>`,
    'dry-run：以上步骤均未执行，app 仓未被修改。',
  ];
}
