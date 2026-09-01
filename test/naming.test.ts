import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApkFileName, selectStaleApks, formatBytes, sanitizeSlug } from '../lib/naming.ts';

test('文件名带时间戳，保证每次发布唯一', () => {
  const at = new Date('2026-09-01T11:30:00+08:00');
  assert.equal(
    buildApkFileName('unified-portal-app', '1.0.0', '1', at),
    'unified-portal-app-1.0.0-1-20260901-1130.apk',
  );
});

test('同一版本两次发布得到不同文件名（immutable 缓存下不会串包）', () => {
  const a = buildApkFileName('app', '1.0.0', '1', new Date('2026-09-01T11:30:00+08:00'));
  const b = buildApkFileName('app', '1.0.0', '1', new Date('2026-09-01T14:05:00+08:00'));
  assert.notEqual(a, b);
});

test('label 里的空格和斜杠被清理，不会造出坏路径', () => {
  const at = new Date('2026-09-01T11:30:00+08:00');
  const name = buildApkFileName('统一门户 App/v2', '1.0', '9', at);
  assert.ok(!name.includes('/'), '文件名不得含斜杠');
  assert.ok(!name.includes(' '), '文件名不得含空格');
  assert.ok(name.endsWith('.apk'));
});

test('sanitizeSlug 全部字符都不合法时回退为 app', () => {
  assert.equal(sanitizeSlug('///'), 'app');
});

test('保留最近 3 个，更旧的被选中删除', () => {
  const files = [
    { name: 'a.apk', mtimeMs: 500 },
    { name: 'b.apk', mtimeMs: 400 },
    { name: 'c.apk', mtimeMs: 300 },
    { name: 'd.apk', mtimeMs: 200 },
    { name: 'e.apk', mtimeMs: 100 },
  ];
  assert.deepEqual(selectStaleApks(files, 3).sort(), ['d.apk', 'e.apk']);
});

test('文件数不超过保留数时不删任何东西', () => {
  const files = [{ name: 'a.apk', mtimeMs: 2 }, { name: 'b.apk', mtimeMs: 1 }];
  assert.deepEqual(selectStaleApks(files, 3), []);
});

test('keep 为 0 时删光（而不是被当成"不限制"）', () => {
  const files = [{ name: 'a.apk', mtimeMs: 2 }, { name: 'b.apk', mtimeMs: 1 }];
  assert.deepEqual(selectStaleApks(files, 0).sort(), ['a.apk', 'b.apk']);
});

test('formatBytes 用 MB 表达百兆级 APK', () => {
  assert.equal(formatBytes(112 * 1024 * 1024), '112.0 MB');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(0), '0 B');
});
