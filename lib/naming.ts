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
