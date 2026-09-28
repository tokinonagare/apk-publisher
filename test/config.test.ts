/**
 * 站点基地址校验的守卫测试。
 *
 * 这一族判据的由来：`config.example.sh` 里的示例值是 `https://apk.example.com`，
 * 复制成 config.local.sh 后忘改这一项，发布过程一路 ✓、页面与二维码全都指向一个
 * 永远不会解析的域名。这次就是靠页面上的域名不对才发现的。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { baseUrlProblem } from '../lib/config.ts';

test('示例域名（含子域与 .net/.org）一律拒绝', () => {
  for (const url of [
    'https://apk.example.com',
    'http://example.com',
    'https://www.example.net',
    'https://example.org/apk',
  ]) {
    const problem = baseUrlProblem(url);
    assert.ok(problem, `${url} 必须被拦下`);
    assert.match(problem!, /示例域名/);
  }
});

test('缺协议与空值都拒绝（拼进二维码就是扫不开的东西）', () => {
  assert.match(baseUrlProblem('apk.my-domain.com') ?? '', /不以 http/);
  assert.match(baseUrlProblem('') ?? '', /是空的/);
  assert.match(baseUrlProblem('   ') ?? '', /是空的/);
  assert.match(baseUrlProblem('ftp://apk.my-domain.com') ?? '', /不以 http/);
});

test('真实地址放行，带路径前缀与带端口也放行', () => {
  assert.equal(baseUrlProblem('https://apk.tokinonagare.com'), null);
  assert.equal(baseUrlProblem('http://localhost:8080'), null);
  assert.equal(baseUrlProblem('https://10.224.1.10/apk'), null);
  // 发布器就是按 <base>/<槽位>/<文件> 拼的，base 带路径前缀是支持的用法。
  assert.equal(baseUrlProblem('https://intranet.example-corp.gov/apk'), null);
});

test('只看 host，不做子串匹配：example.com 出现在 host 之外不算示例域', () => {
  // 判据写成 host === 'example.com' || host.endsWith('.example.com')，
  // 用整串 includes('example.com') 会误拦这种域名，也会漏掉带 userinfo 的真示例域。
  assert.equal(baseUrlProblem('https://example.com.evil-corp.test/apk'), null);
  assert.match(baseUrlProblem('https://user:pass@apk.example.com') ?? '', /示例域名/);
});

test('CLI：check-base-url 可用时静默退 0，不可用时给出一句能改的话并非零退出', () => {
  const cli = fileURLToPath(new URL('../lib/cli.ts', import.meta.url));
  const run = (input: string) => {
    try {
      const out = execFileSync(process.execPath, ['--experimental-strip-types', cli, 'check-base-url'], {
        input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
      });
      return { code: 0, out: out.trim() };
    } catch (error) {
      const e = error as { status?: number; stdout?: string };
      return { code: e.status ?? -1, out: (e.stdout ?? '').trim() };
    }
  };

  assert.deepEqual(run('https://apk.tokinonagare.com'), { code: 0, out: '' });
  const bad = run('https://apk.example.com');
  assert.equal(bad.code, 1);
  assert.match(bad.out, /APK_BASE_URL/);
  assert.match(bad.out, /怎么办/);
});
