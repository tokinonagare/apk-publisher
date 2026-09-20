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

export function trackMutualExclusionNotice(track: Track): string {
  if (track === 'uat') return 'UAT 与 Release 使用相同包名，同一台设备不能同时安装两个档位；切换前请先卸载当前应用。';
  if (track === 'release') return 'Release 与 UAT 使用相同包名，同一台设备不能同时安装两个档位；切换前请先卸载当前应用。';
  return '';
}

export function trackPlaceholder(track: Track): string {
  return `${trackLabel(track)} 档尚未发布 APK。`;
}
