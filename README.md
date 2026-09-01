# apk-publisher

把 Android APK 发布到一个自建的内测分发站：一条命令上传，测试人员扫二维码安装。

服务器上**不跑任何常驻进程**。发布脚本在本地把下载页连同 APK 一起生成好推上去，
nginx 直接当静态文件发。没有数据库、没有后端服务、没有需要维护的容器。

```
./publish.sh
```

```
▸ 清理中断残留
▸ 读取 APK 元信息
✓ unified-portal-app 1.0.0 (versionCode 1) · 107 MB
✓ 构建来源 main @ 7c8d976
▸ 检查服务器剩余空间
✓ 可用 56136 MB
▸ 上传 unified-portal-app-1.0.0-1-20260901-1149.apk
✓ 上传完成
▸ 生成下载页
✓ 下载页已更新
▸ 清理旧版本（保留最近 3 个）
  删除 unified-portal-app-1.0.0-1-20260901-1141.apk

  <终端里直接可扫的二维码>

下载页  https://apk.example.com
直链    https://apk.example.com/unified-portal-app-1.0.0-1-20260901-1149.apk
```

## 快速开始

```bash
npm install
cp config.example.sh config.local.sh   # 填上服务器地址、密钥路径、域名
./publish.sh                            # 发布默认的 release APK
./publish.sh path/to/app.apk            # 或指定一个
./publish.sh --prune-only               # 只清理服务器上的旧包，不发布
```

`config.local.sh` 已 gitignore。也可以改用同名的 `APK_*` 环境变量，环境变量优先。

## 下载页

一屏，手机上看为主：应用名、版本号、versionCode、一个大二维码、下载按钮，
下面是包大小、构建时间、发布时间和 git 分支/commit——方便对上是哪次构建。
工作区有未提交改动时，页面顶部会明确标出 dirty，避免把一个对不上任何 commit
的包当成正式构建发出去。

页面是**完全自包含的单个 HTML 文件**：二维码是内联 SVG，样式是内联 `<style>`，
不引用任何外部脚本、CDN 或字体。深浅色都适配。

## 它替你盯着的几件事

**磁盘。** 上传前检查剩余空间，不足两倍包大小就中止；发布后只保留最近 `APK_KEEP`
个包（默认 3），更旧的自动删。这不是洁癖——这个站所在的机器曾被一个停用 CI 的
缓存写到 98%，52G 全是没人回收的死数据。

**中断的上传。** 上传走「先传 `.part` 再原子改名」，测试人员不会下到半截文件。
中断留下的 `.part` 残骸在下次发布时清理（只删一小时前的，避免误伤正在进行的上传）——
它们不匹配 `*.apk`，光靠版本保留策略永远轮不到它们。

**缓存串包。** nginx 对 `.apk` 发 `immutable` 长缓存，所以文件名必须每次发布都不同，
否则已经缓存过的人会永远拿到旧包。文件名里因此带发布时间戳，而不只是版本号。

**SELinux。** 见下。

## 服务器端一次性配置

```bash
# 1. 站点目录
sudo mkdir -p /var/www/apk-publisher
sudo chown "$USER:$USER" /var/www/apk-publisher

# 2. SELinux（RHEL / Oracle Linux / CentOS 必做）
sudo semanage fcontext -a -t httpd_sys_content_t "/var/www/apk-publisher(/.*)?"
sudo restorecon -Rv /var/www/apk-publisher

# 3. 证书（这里用 Cloudflare DNS 验证，不需要开 80 端口）
sudo certbot certonly --dns-cloudflare \
  --dns-cloudflare-credentials /root/.secrets/certbot/cloudflare.ini \
  -d apk.example.com

# 4. nginx
sudo cp nginx/apk-publisher.conf /etc/nginx/conf.d/
sudo sed -i 's/apk\.example\.com/你的域名/g' /etc/nginx/conf.d/apk-publisher.conf
sudo nginx -t && sudo systemctl reload nginx
```

> **第 2 步别跳过。** SELinux 处于 Enforcing 时，`/var/www` 下新建的文件默认是
> `var_t`，nginx 读不了，而且返回的是 **404 而不是 403**——很容易误判成路径写错，
> 白查半天。用 `semanage fcontext` 而不是 `chcon`：后者在重启或 relabel 后会丢失。
>
> 发布脚本每次都会跑一次 `restorecon`，兜住后续新文件的标签。

发布脚本还需要目标机器上的 `sudo restorecon` 免密，或者把该命令加进 sudoers。

## 开发

```bash
npm test        # node:test，22 个用例
npm run typecheck
```

分工是：shell 负责编排（找文件、ssh、scp），Node 负责解析与渲染。

| 文件 | 职责 |
|---|---|
| `publish.sh` | 编排：定位 APK、读 git 信息、上传、清理 |
| `lib/apk-info.ts` | 解析 `aapt2 dump badging` 输出 |
| `lib/naming.ts` | 文件命名与保留策略 |
| `lib/render.ts` | 生成下载页 HTML |
| `lib/cli.ts` | 上面几个模块的命令行入口，供 `publish.sh` 调用 |

`lib/` 里除 `cli.ts` 外全是纯函数，测试直接断言返回值，不碰网络也不碰文件系统。

## 依赖

Node 22+（用到 `--experimental-strip-types` 直接跑 TypeScript）、Android SDK 的
`aapt2`（读 APK 元信息）、能 ssh 到目标机器。运行时依赖只有 `qrcode` 一个。
