export const TRACKS = ['dev', 'uat', 'release'] as const;
export type Track = (typeof TRACKS)[number];

const TRACK_ERROR = '缺少或非法的 --track。合法值：dev、uat、release。用法：./publish.sh --track dev|uat|release [APK 路径]';

export function parseTrack(value: unknown): Track {
  if (typeof value === 'string' && (TRACKS as readonly string[]).includes(value)) {
    return value as Track;
  }
  throw new Error(TRACK_ERROR);
}

export function trackDirectory(remoteDir: string, track: Track): string {
  return `${remoteDir.replace(/\/$/, '')}/${track}`;
}

export function trackLabel(track: Track): string {
  return track === 'uat' ? 'UAT' : track[0].toUpperCase() + track.slice(1);
}

/**
 * 页面上那句「装了这个还能不能装那个」。
 *
 * 三档的包名互不相同（app 仓 #348 起：`.dev` / `.uat` / 交付包），两个应用的包名同样
 * 不同（`ae.gov.adaa.*` / `ae.gov.uaeaa.*`），所以六个槽位是六个 applicationId，
 * 同一台设备上可以并存。旧文案说的「UAT 与 Release 同包名、切换前须卸载」在 #348
 * 之前是真的，现在不成立——留着它会让测试人员白卸一次应用。
 */
export function installCoexistenceNotice(): string {
  return '三档包名互不相同（.dev / .uat / 交付包），ADAA 与 UAEAA 两个应用的包名也互不相同，同一台设备可以并存安装，不必先卸载。';
}

export function trackPlaceholder(track: Track): string {
  return `${trackLabel(track)} 档尚未发布 APK。`;
}
