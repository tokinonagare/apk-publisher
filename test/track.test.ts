import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseTrack, trackDirectory } from '../lib/track.ts';

test('只接受 dev、uat、release 三个档位', () => {
  assert.equal(parseTrack('dev'), 'dev');
  assert.equal(parseTrack('uat'), 'uat');
  assert.equal(parseTrack('release'), 'release');
  assert.throws(() => parseTrack('prod'), /dev、uat、release/);
  assert.throws(() => parseTrack(''), /用法/);
});

test('档位目录严格拼接在站点根目录下', () => {
  assert.equal(trackDirectory('/var/www/apk-publisher', 'dev'), '/var/www/apk-publisher/dev');
  assert.equal(trackDirectory('/var/www/apk-publisher/', 'uat'), '/var/www/apk-publisher/uat');
});

test('CLI 不传档位时硬失败并列出合法值', () => {
  const cli = fileURLToPath(new URL('../lib/cli.ts', import.meta.url));
  assert.throws(
    () => execFileSync(process.execPath, ['--experimental-strip-types', cli, 'track'], { input: '' }),
    /缺少或非法的 --track.*dev、uat、release/s,
  );
});
