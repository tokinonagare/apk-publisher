/**
 * 解析 `aapt2 dump badging <apk>` 的输出。
 *
 * 只认四个字段：包名、versionCode、versionName、应用名。其余行一律忽略——
 * aapt2 的输出会随 build-tools 版本增删行，锁死格式只会平白变脆。
 */

export interface ApkInfo {
  packageName: string;
  versionCode: string;
  versionName: string;
  label: string;
}

/** 取 `key='value'` 形式的值。value 允许含空格，所以按引号配对而不是按空格切分。 */
function pick(source: string, key: string): string | undefined {
  const m = new RegExp(`${key}='([^']*)'`).exec(source);
  return m?.[1];
}

export function parseBadging(output: string): ApkInfo {
  const packageLine = output
    .split('\n')
    .find((line) => line.startsWith('package:'));

  // 缺 package 行说明这根本不是 badging 输出（比如 aapt2 报错走了 stdout），
  // 响亮报错比返回一个空壳对象强——后者会一路带着空版本号发布上线。
  if (!packageLine) {
    throw new Error('aapt2 输出中找不到 package: 行，无法读取 APK 元信息');
  }

  const packageName = pick(packageLine, 'name');
  const versionCode = pick(packageLine, 'versionCode');
  const versionName = pick(packageLine, 'versionName');

  if (!packageName) throw new Error('aapt2 输出中缺少 package name');
  if (!versionCode) throw new Error('aapt2 输出中缺少 versionCode');
  if (!versionName) throw new Error('aapt2 输出中缺少 versionName');

  // application-label 可能带语言后缀（application-label-en），只取无后缀那条。
  const labelLine = output
    .split('\n')
    .find((line) => line.startsWith('application-label:'));
  const label = labelLine ? /application-label:'([^']*)'/.exec(labelLine)?.[1] : undefined;

  return {
    packageName,
    versionCode,
    versionName,
    // 没有 label 的包（少见但存在）用包名兜底，不留空字符串。
    label: label && label.length > 0 ? label : packageName,
  };
}
