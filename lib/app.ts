/**
 * 应用这条轴（ADAA / UAEAA）。
 *
 * 与 track（dev / uat / release）正交：一个档位下有多个应用，页面上一个应用一个二维码。
 * 两个应用出自同一个 app 仓，按租户分身份（`ae.gov.adaa.*` / `ae.gov.uaeaa.*`）。
 */

import type { Track } from './track.ts';

export const APPS = ['adaa', 'uaeaa'] as const;
export type App = (typeof APPS)[number];

/** 🔴 缺省必须是 adaa：app 仓的 `yarn publish:apk` 调发布器时不传 --app，缺省一变它就发错应用。 */
export const DEFAULT_APP: App = 'adaa';

const APP_ERROR =
  '缺少或非法的 --app。合法值：adaa、uaeaa。用法：./publish.sh --track dev|uat|release [--app adaa|uaeaa] [APK 路径]';

export function parseApp(value: unknown): App {
  if (typeof value === 'string' && (APPS as readonly string[]).includes(value)) {
    return value as App;
  }
  throw new Error(APP_ERROR);
}

export function appLabel(app: App): string {
  return app.toUpperCase();
}

/**
 * 槽位（应用 × 档位）在站点根目录下的相对路径。
 *
 * 🔴 缺省应用 adaa 直接住在 `<track>/`，没有自己那层子目录。这不是偷懒，也不是漏做：
 * 已在测试人员手机里流传的 ADAA 直链是 `/dev/dev-*.apk`，给它补一层 `/adaa/` 会让
 * 所有旧链接当场 404（nginx 对 .apk 发的是 immutable 长缓存，旧链接失效没有任何
 * 补救办法）。新增的应用各占一层子目录，`dev/` 与 `dev/uaeaa/` 并存，
 * nginx 侧不需要任何新规则——它的规则全是按后缀匹配的。
 */
export function appPath(track: Track, app: App): string {
  return app === DEFAULT_APP ? track : `${track}/${app}`;
}

/**
 * 下载按钮的相对前缀：下载页住在 `<track>/index.html`，而非缺省应用的包在
 * `<track>/<app>/` 里，所以链接必须带上那层子目录，否则点了就是 404。
 */
export function appHrefPrefix(app: App): string {
  return app === DEFAULT_APP ? '' : `${app}/`;
}

/**
 * app 仓 `APP_TENANT` 的取值（构建期租户）。
 *
 * app 仓 #387 起认 `ADAA` / `UAEAA` 两个大写值，缺省 ADAA、未知值直接 throw
 * 中断 prebuild——所以这里给错值会当场失败，不会静默产出另一家的包。
 */
export function tenantEnvValue(app: App): string {
  return app.toUpperCase();
}

/**
 * 该应用 applicationId 的前缀（app 仓 #387 的租户表：`ae.gov.<租户>.unifiedportal[.档]`）。
 *
 * 守卫只用前缀，不用完整包名——三档各自还带 `.dev` / `.uat` / 不带后缀。
 */
export function packagePrefix(app: App): string {
  return `ae.gov.${app}.`;
}

/**
 * 「这个 APK 的身份对不对得上要发的槽位」。对不上返回一句能照着做的话，对得上返回 null。
 *
 * 🔴 为什么必须拦：应用这条轴一旦能用，「手工把一个包的副本改名塞进另一个槽位」
 * 就成了手滑一下的事——页面上 ADAA 的标题下面挂着 UAEAA 的二维码（或反过来），
 * 而测试人员只有装上之后才会发现连的是另一家的后端。
 * 这条守卫的取值只依赖包名前缀，app 仓加档（.dev/.uat/交付）不用改这里。
 */
export function apkIdentityMismatch(packageName: string, app: App): string | null {
  if (packageName.startsWith(packagePrefix(app))) return null;
  const other = APPS.find((a) => a !== app && packageName.startsWith(packagePrefix(a)));
  return (
    `要发往 --app ${app}，但 APK 的包名是 ${packageName}。` +
    (other ? `\n它看起来是 ${other}（${appLabel(other)}）的包——先确认你手上的产物到底是哪一家。` : '\n它不以 ' + packagePrefix(app) + ' 开头。') +
    `\n确属本应用（换了包名规则）就改 lib/app.ts 的 packagePrefix，🚫 不要在这里放行——` +
    `发错应用要等装机后才看得见。`
  );
}

export function appPlaceholderNote(app: App): string {
  return `${appLabel(app)} 尚未发布 APK。`;
}
