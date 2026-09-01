# 复制成 config.local.sh 后填写自己的值。config.local.sh 已 gitignore，不会进仓库。
# 这些也可以直接用环境变量提供，环境变量优先于本文件。

# 部署用的 ssh 私钥
export APK_SSH_KEY="$HOME/.ssh/your-deploy-key"

# 目标服务器
export APK_SSH_HOST="user@your-server.example.com"

# 站点对外地址（下载页与二维码都用它拼直链）
export APK_BASE_URL="https://apk.example.com"

# app 源码仓库路径，用来读 git 分支/commit 显示在下载页上
export APK_APP_REPO="$HOME/path/to/your-android-app"

# 以下有默认值，按需覆盖
# export APK_REMOTE_DIR="/var/www/apk-publisher"   # 服务器上的站点根目录
# export APK_KEEP=3                                # 保留多少个历史包
# export APK_DEFAULT_APK="$APK_APP_REPO/android/app/build/outputs/apk/release/app-release.apk"
