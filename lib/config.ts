/**
 * 配置值的校验（纯函数）。
 *
 * 只校验「错了会让线上静默出坏二维码」的那几个值。发布器全部产物都拼在 `APK_BASE_URL`
 * 上，而这个值的示例值住在 `config.example.sh` 里 —— 复制过来忘了改，是这次真发生过的
 * 失误：二维码扫出来指向一个不存在的域名，页面上什么都不报错。
 */

/** RFC 2606 永久保留的示例域名，永远不会指向任何人的站点。 */
const PLACEHOLDER_HOSTS = ['example.com', 'example.net', 'example.org'] as const;

/** 从形如 `https://host:port/path` 的串里取 host（小写）。取不出来返回空串。 */
function hostOf(url: string): string {
  const withoutScheme = url.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, '');
  const host = withoutScheme.split(/[/?#]/)[0];
  return host.split('@').pop()!.split(':')[0].toLowerCase();
}

/**
 * 站点基地址能不能用。不能用返回一句能照着改的话，能用返回 null。
 *
 * 判据只有两条，都是「拼出来的直链必然坏」的那一类：
 *   1. 没有 http(s) 协议 —— 二维码会编进一个扫不开的东西；
 *   2. host 是保留示例域名（含 `apk.example.com` 这种子域）—— 配置复制完没改。
 * 带路径前缀（`https://host/apk`）是支持的，发布器就是按 `<base>/<槽位>/<文件>` 拼。
 */
export function baseUrlProblem(url: string): string | null {
  const value = url.trim();
  if (value === '') {
    return 'APK_BASE_URL 是空的。它是下载页与二维码的站点基地址，必须显式配置。';
  }
  if (!/^https?:\/\//i.test(value)) {
    return (
      `APK_BASE_URL="${value}" 不以 http:// 或 https:// 开头。\n` +
      '二维码会把这串原样编进去，扫出来是一个打不开的东西。\n' +
      `怎么办：写成完整地址，例如 export APK_BASE_URL="https://apk.your-domain.com"`
    );
  }
  const host = hostOf(value);
  const isPlaceholder = PLACEHOLDER_HOSTS.some(
    (reserved) => host === reserved || host.endsWith(`.${reserved}`),
  );
  if (isPlaceholder) {
    return (
      `APK_BASE_URL="${value}" 用的还是示例域名（host=${host}）。\n` +
      'example.com / .net / .org 是 RFC 2606 永久保留的，永远不会解析到任何人的站点，\n' +
      '于是每个二维码都扫不开，而发布过程一路 ✓、页面上没有任何东西报错。\n' +
      `怎么办：把 config.local.sh 里的 APK_BASE_URL 改成你的站点地址（那份文件是\nconfig.example.sh 复制来的，这一项多半忘了改）。`
    );
  }
  return null;
}
