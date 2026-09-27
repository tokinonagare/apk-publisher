/**
 * APK 文件命名与保留策略。
 *
 * 命名必须保证「每次发布一个新文件名」——nginx 对 .apk 发的是
 * `Cache-Control: immutable`，同名覆盖会让已经缓存过的人永远拿到旧包。
 * 所以文件名里带发布时间戳，而不是只带版本号。
 */

/** 把任意文本压成可安全用于文件名的 slug。 */
export function sanitizeSlug(input: string): string {
  const slug = input
    .trim()
    .replace(/[^\w.-]+/g, '-') // 空格、斜杠、中文等一律换成连字符
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return slug.length > 0 ? slug : 'app';
}

/** 本地时区的 `YYYYMMDD-HHmm`。用本地时区是因为这个值要给人看，对得上「我几点发的」。 */
function timestamp(at: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `${at.getFullYear()}${p(at.getMonth() + 1)}${p(at.getDate())}` +
    `-${p(at.getHours())}${p(at.getMinutes())}`
  );
}

export function buildApkFileName(
  track: string,
  label: string,
  versionName: string,
  versionCode: string,
  publishedAt: Date,
): string {
  const parts = [
    sanitizeSlug(track),
    sanitizeSlug(label),
    sanitizeSlug(versionName),
    sanitizeSlug(versionCode),
    timestamp(publishedAt),
  ];
  return `${parts.join('-')}.apk`;
}

export interface ParsedApkFileName {
  label: string;
  versionName: string;
  versionCode: string;
  /** 文件名里的发布时间戳，本地时区（与 timestamp() 对称）。 */
  publishedAt: Date;
}

const NAME_PATTERN = /^(.+)-(\d+(?:\.\d+)+)-(\d+)-(\d{8})-(\d{4})\.apk$/;

/**
 * `buildApkFileName` 的逆运算：从文件名读回发布信息。
 *
 * 用在「只发一个应用、但整页要把另一个应用也显示出来」的时候——那个包不在本地，
 * aapt2 读不到，只能靠文件名。锚点全部放在右端（时间戳 8+4 位、versionCode 纯数字、
 * versionName 至少一个点），剩下的一律算 label，因为 label 自己就带连字符。
 *
 * 必须传 track：档位前缀要先剥掉，否则 label 会连 `dev-` 一起吃进来；而且
 * 一个 `uat-...` 的文件出现在 dev 目录里时，它压根不该被解析成这一档的包。
 * 解析不出来返回 null，由调用方决定降级显示还是硬失败。
 */
export function parseApkFileName(name: string, track: string): ParsedApkFileName | null {
  const prefix = `${sanitizeSlug(track)}-`;
  if (!name.startsWith(prefix)) return null;
  const m = NAME_PATTERN.exec(name.slice(prefix.length));
  if (!m) return null;
  const [, label, versionName, versionCode, day, time] = m;
  const publishedAt = new Date(
    Number(day.slice(0, 4)),
    Number(day.slice(4, 6)) - 1,
    Number(day.slice(6, 8)),
    Number(time.slice(0, 2)),
    Number(time.slice(2, 4)),
  );
  return { label, versionName, versionCode, publishedAt };
}

/** 服务器上扫到的一行：文件名、字节数、修改时间（毫秒）。 */
export interface ScannedApk {
  name: string;
  sizeBytes: number;
  mtimeMs: number;
}

/**
 * 取槽位里最新的那个包（另一个应用的二维码要用它）。
 *
 * 排序键用 mtimeMs，不用文件名的时间戳：文件名可以被手工放上去的包任意改写，
 * mtime 才是「最后一次上传」的事实。同分秒时按名字倒序，保证结果可复现。
 */
export function selectLatestApk(files: readonly ScannedApk[]): ScannedApk | null {
  if (files.length === 0) return null;
  return [...files].sort((a, b) => b.mtimeMs - a.mtimeMs || b.name.localeCompare(a.name))[0];
}

/**
 * 选出该删的旧包：按修改时间倒序，留下最新的 `keep` 个，其余返回。
 *
 * `keep = 0` 意味着一个都不留，不是「不限制」——把 0 当成无限会让
 * 一个手滑的配置值把盘写满，正是这台机器上刚发生过的事。
 */
export function selectStaleApks(
  files: readonly { name: string; mtimeMs: number }[],
  keep: number,
): string[] {
  if (keep < 0) throw new Error(`保留数不能为负: ${keep}`);
  return [...files]
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(keep)
    .map((f) => f.name);
}

export function selectStaleApksForTrack(
  files: readonly { name: string; mtimeMs: number }[],
  track: string,
  keep: number,
): string[] {
  return selectStaleApks(files.filter((file) => file.name.startsWith(`${track}-`)), keep);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}
