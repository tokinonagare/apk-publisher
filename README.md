# apk-publisher

把 Android APK 发布到一个自建的内测分发站：一条命令上传，测试人员扫二维码安装。

服务器上**不跑任何常驻进程**。发布脚本在本地把下载页连同 APK 一起生成好推上去，
nginx 直接当静态文件发。没有数据库、没有后端服务、没有需要维护的容器。

```
./publish.sh --track dev|uat|release [--app adaa|uaeaa] [APK 路径]
```

**端到端发版**（构建 + 发布一条命令走完）：

```
./release.sh --track dev|uat|release [--version 1.0.9] [--dry-run]
```

```
▸ 清理各槽位目录中的中断残留
▸ 确保各槽位目录与入口页存在
▸ 读取 APK 元信息
✓ adaa · Unified Portal (Dev) 1.0.0 (versionCode 1) · 107 MB
✓ 构建来源 main @ 7c8d976
▸ 检查服务器剩余空间
✓ 可用 56136 MB
▸ 上传 dev/dev-unified-portal-app-1.0.0-1-20260901-1149.apk
✓ 上传完成
▸ 扫描 dev 档各槽位现有的包
▸ 生成下载页
✓ 下载页已更新
▸ 清理 dev · adaa 槽位旧版本（保留最近 3 个）
▸ 清理 dev · uaeaa 槽位旧版本（保留最近 3 个）
…

  <终端里直接可扫的二维码>

下载页  https://apk.example.com/dev/
直链    https://apk.example.com/dev/dev-unified-portal-app-1.0.0-1-20260901-1149.apk
```

## release.sh（端到端发版）

`publish.sh` 只管「把一个已构建好的 APK 发到分发站」。`release.sh` 在它前面
把构建那半也接上，一条命令走完全程：

```
./release.sh --track dev              # Dev 档完整发版
./release.sh --track uat --dry-run    # 只打印计划，不改任何东西
./release.sh --track release --version 1.0.9
```

七步，顺序固定：

1. 在 app 仓**当前分支**跑 `git pull --rebase`（不切分支）
2. 检查 `app.config.ts` 必须干净，否则硬失败；其余文件允许 dirty
3. `android.versionCode` +1；传了 `--version` 就同时改顶层 `version`
4. 只提交 `app.config.ts` 这一个文件（**不 push**）
5. 按 track 设 `APP_VARIANT` 跑 `npx expo prebuild --platform android`
   （三档都显式设：`dev`→`development`、`uat`→`uat`、`release`→`production`）
6. 在 `android/` 下跑 `./gradlew assembleRelease`
7. 调 `./publish.sh --track <同一个档> <刚构建出的 apk>`

`--track` 必须显式传（`dev`、`uat`、`release`），同时支持 `--track=dev` 写法。
`--dry-run` 打印将要执行的每一步与关键值，不改文件、不提交、不构建、不上传。

> **`release.sh` 只构建 ADAA。** app 仓现在还是单 flavor（`src/config/env.ts` 里
> `TENANT = 'ADAA'` 写死，`APP_VARIANT` 只认 `development`/`uat`/`production`，未知值
> 直接 throw），所以 UAEAA 的包发不出、只能发布外部产好的（见下）。等 app 仓接上
> 双 flavor，再给这里加 `--app`。

> **`uat` 档曾经不设 `APP_VARIANT`。** app 仓 #348 之前只有两档，UAT 与交付共用
> 交付包名；#348 之后 `uat` 有自己的包名（`.uat`）与后端 host。映射没跟上时，
> `--track uat` 会构建出**连生产环境的交付包**并发到 UAT 档，页面上什么都不报错。

> **副作用说明：** `release.sh` 会改 app 仓（`app.config.ts` 的版本号）并产生
> **一个本地 commit，但绝不 push**。`app.config.ts` 有未提交改动时会直接硬失败，
> 避免把半成品改动混进版本提交里。`android/` 是 gitignored 的构建产物，
> prebuild 会清空重建，这是预期的。

## 快速开始

```bash
npm install
cp config.example.sh config.local.sh   # 填上服务器地址、密钥路径、域名
./publish.sh --track dev                # 发布 Dev 档默认 APK（缺省 --app adaa）
./publish.sh --track uat path/to/app.apk
./publish.sh --track=release path/to/app.apk
./publish.sh --track dev --app uaeaa path/to/uaeaa.apk   # 发 UAEAA 的包
./publish.sh --prune-only               # 清理所有槽位，各自按 APK_KEEP 保留
```

`--track` 是必填项，只接受 `dev`、`uat`、`release`；缺少或传入其它值会以非零退出并报错，发布器不会从 APK、环境变量或应用名推断档位。

`--app` 只接受 `adaa`、`uaeaa`，不传等于 `adaa`——app 仓的 `yarn publish:apk` 就不传它，缺省一变那条链路就会把 ADAA 的包发到 UAEAA 名下。`--app uaeaa` 必须显式给 APK 路径：`APK_DEFAULT_APK` 指向的是 ADAA 的产物，拿它兜底会让两个二维码指向同一个身份。`--prune-only` 不接受 `--track` 或 `--app`（它清理所有槽位）。

档位与应用是两条正交的轴，一个「槽位」= 一个应用在一个档位下的位置：

```
<REMOTE_DIR>/
  index.html
  dev/index.html       dev/dev-*.apk            ← ADAA
                       dev/uaeaa/dev-*.apk      ← UAEAA（同一页上的第二个码）
  uat/index.html       uat/uat-*.apk
                       uat/uaeaa/uat-*.apk
  release/index.html   release/release-*.apk
                       release/uaeaa/release-*.apk
```

> **为什么 ADAA 没有自己那层子目录。** 测试人员手机里的二维码指向的是
> `/dev/dev-*.apk` 这样的直链，而 nginx 对 `.apk` 发 `immutable` 长缓存。给 ADAA 补一层
> `/adaa/` 会让所有已流传的旧链接当场 404，所以缺省应用继续住在档位根目录，只有新增
> 应用各占一层子目录。这条不是偷懒，`test/app.test.ts` 里钉着守卫。

根入口页列出 `Dev`、`UAT`、`Release` 三个入口（每个入口进去都是两个码）；尚未发布的档位显示占位页。每个槽位独立保留历史包，`APK_KEEP`（默认 3）按槽位计——发得勤的 ADAA 不会把 UAEAA 唯一的包删掉。三档包名互不相同（`.dev` / `.uat` / 交付包），两个应用的包名也互不相同（`ae.gov.adaa.*` / `ae.gov.uaeaa.*`），同一台设备可以并存安装。

`config.local.sh` 已 gitignore。也可以改用同名的 `APK_*` 环境变量——但注意 `config.local.sh` 里若写成裸 `export APK_XXX="…"`，它会**覆盖**外部传进来的同名环境变量（`${VAR:-默认}` 写法才谈得上「环境变量优先」）。

## 下载页

一屏，手机上看为主。每个档位一页，页面上**每个应用一组**：应用名、版本号、versionCode、
一个二维码、一个下载按钮，下面是包大小、构建时间、发布时间和 git 分支/commit——方便对上
是哪次构建。工作区有未提交改动时，页面顶部会明确标出 dirty，避免把一个对不上任何 commit
的包当成正式构建发出去。

一次只发一个应用的包，另一个应用的信息从服务器同档目录里扫最新的那个出来，
**版本信息解析自文件名**（页面上会标出这一点，且那一侧不显示构建时间——文件名里没有它）。
扫不到就显示「尚未发布」，不猜版本号。

页面是**完全自包含的单个 HTML 文件**：二维码是内联 SVG，样式是内联 `<style>`，
不引用任何外部脚本、CDN 或字体。深浅色都适配。

## 它替你盯着的几件事

**磁盘。** 上传前检查剩余空间，不足两倍包大小就中止；发布后每个槽位只保留最近
`APK_KEEP` 个包（默认 3），更旧的自动删。这不是洁癖——这个站所在的机器曾被一个停用 CI 的
缓存写到 98%，52G 全是没人回收的死数据。

**中断的上传。** 上传走「先传 `.part` 再原子改名」，测试人员不会下到半截文件。
中断留下的 `.part` 残骸在下次发布时清理（只删一小时前的，避免误伤正在进行的上传）——
它们不匹配 `*.apk`，光靠版本保留策略永远轮不到它们。

**缓存串包。** nginx 对 `.apk` 发 `immutable` 长缓存，所以文件名必须每次发布都不同，
否则已经缓存过的人会永远拿到旧包。文件名里因此带发布时间戳和档位前缀，而不只是版本号。
新增应用靠**子目录**隔离（`dev/uaeaa/`），文件名规则没变——同一页上两个应用的包不会互相撞名。

**槽位之间互不牵连。** 保留策略、清理、目录创建都按「应用 × 档位」逐个走，
所以 UAEAA 只发过一次时不会被 ADAA 的三次发布挤掉，页面上不会留下一个指向 404 的二维码。

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
npm test        # node:test
npm run typecheck
```

分工是：shell 负责编排（找文件、ssh、scp），Node 负责解析与渲染。

| 文件 | 职责 |
|---|---|
| `publish.sh` | 编排：定位 APK、读 git 信息、上传、扫槽位、生成页、清理 |
| `release.sh` | 编排：改版本号、提交（不 push）、prebuild、构建、调 publish.sh |
| `lib/release.ts` | release.sh 的纯函数：档位→`APP_VARIANT` 映射、版本号读写与改写、参数解析 |
| `lib/track.ts` | 档位这条轴：值域、目录、标签 |
| `lib/app.ts` | 应用这条轴：值域、缺省应用、槽位路径（`dev` / `dev/uaeaa`） |
| `lib/apk-info.ts` | 解析 `aapt2 dump badging` 输出 |
| `lib/naming.ts` | 文件命名与保留策略；文件名反解（另一侧应用的信息只能来自文件名） |
| `lib/render.ts` | 生成下载页 HTML（一页多应用）与入口页、占位页 |
| `lib/cli.ts` | 上面几个模块的命令行入口，供 `publish.sh` 调用 |

`lib/` 里除 `cli.ts` 外全是纯函数，测试直接断言返回值，不碰网络也不碰文件系统。

## 依赖

Node 22+（用到 `--experimental-strip-types` 直接跑 TypeScript）、Android SDK 的
`aapt2`（读 APK 元信息）、能 ssh 到目标机器。运行时依赖只有 `qrcode` 一个。
