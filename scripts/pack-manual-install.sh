#!/usr/bin/env bash
# Pack a manual-install tarball for ImmortalWrt / OpenWrt 18.06.
# Upload the .tar.gz via LuCI file transfer, then run install.sh on the router.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="${ROOT}/dist-openwrt"
STAGING="${OUT_DIR}/luci-app-ai-planner-install"
ARCHIVE="${OUT_DIR}/luci-app-ai-planner-install.tar.gz"

cd "$ROOT"
npm run build:openwrt

rm -rf "$STAGING"
mkdir -p "$STAGING/files/www/luci-app-ai-planner"
mkdir -p "$STAGING/files/usr/lib/lua/luci/controller"
mkdir -p "$STAGING/files/usr/lib/lua/luci/view/ai-planner"
mkdir -p "$STAGING/files/usr/share/rpcd/acl.d"

cp -R openwrt/htdocs/. "$STAGING/files/www/luci-app-ai-planner/"
cp openwrt/root/usr/lib/lua/luci/controller/ai-planner.lua \
  "$STAGING/files/usr/lib/lua/luci/controller/"
cp openwrt/root/usr/lib/lua/luci/view/ai-planner/app.htm \
  "$STAGING/files/usr/lib/lua/luci/view/ai-planner/"
cp openwrt/root/usr/share/rpcd/acl.d/luci-app-ai-planner.json \
  "$STAGING/files/usr/share/rpcd/acl.d/"

cat > "$STAGING/install.sh" << 'EOF'
#!/bin/sh
# Run on the router after extracting the tarball, e.g.:
#   cd /tmp && tar xzf luci-app-ai-planner-install.tar.gz
#   cd luci-app-ai-planner-install && sh install.sh

set -e
DIR="$(cd "$(dirname "$0")" && pwd)"

echo "[1/3] Installing web files..."
mkdir -p /www/luci-app-ai-planner
cp -a "$DIR/files/www/luci-app-ai-planner/." /www/luci-app-ai-planner/

echo "[2/3] Installing LuCI menu (18.06) + ACL..."
mkdir -p /usr/lib/lua/luci/controller
mkdir -p /usr/lib/lua/luci/view/ai-planner
mkdir -p /usr/share/rpcd/acl.d
cp -a "$DIR/files/usr/lib/lua/luci/controller/ai-planner.lua" \
  /usr/lib/lua/luci/controller/
cp -a "$DIR/files/usr/lib/lua/luci/view/ai-planner/app.htm" \
  /usr/lib/lua/luci/view/ai-planner/
cp -a "$DIR/files/usr/share/rpcd/acl.d/luci-app-ai-planner.json" \
  /usr/share/rpcd/acl.d/

echo "[3/3] Restarting rpcd..."
/etc/init.d/rpcd restart 2>/dev/null || true

echo
echo "Done."
echo "  LuCI menu: 服务 → AI Wi-Fi 布放"
echo "  Or open:   http://<router-ip>/luci-app-ai-planner/index.html"
echo "  (login to LuCI first so /ubus works)"
EOF
chmod +x "$STAGING/install.sh"

cat > "$STAGING/README.txt" << 'EOF'
luci-app-ai-planner 手动安装包（ImmortalWrt / OpenWrt 18.06）

1. 用 LuCI「文件传输」把安装包传到 /tmp/
   - 推荐：luci-app-ai-planner-install.zip
   - 或：luci-app-ai-planner-install.tar.gz

2. SSH / 终端执行：

   # 推荐用 zip（避免 BusyBox tar 报 invalid tar magic）
   cd /tmp
   unzip -o luci-app-ai-planner-install.zip
   cd luci-app-ai-planner-install
   sh install.sh

   # 若用 tar.gz：
   # cd /tmp && tar xzf luci-app-ai-planner-install.tar.gz
   # cd luci-app-ai-planner-install && sh install.sh

3. 登录 LuCI → 服务 → AI Wi-Fi 布放
EOF

rm -f "$ARCHIVE"
# BusyBox tar on OpenWrt rejects macOS xattrs / AppleDouble; use ustar + no macOS junk.
export COPYFILE_DISABLE=1
(
  cd "$OUT_DIR"
  # Prefer GNU-compatible ustar; fall back if --format unsupported
  if tar --help 2>&1 | grep -q -- '--format'; then
    tar --format=ustar --exclude='._*' --exclude='.DS_Store' -cf - luci-app-ai-planner-install \
      | gzip -n > "$ARCHIVE"
  else
    tar --exclude='._*' --exclude='.DS_Store' -cf - luci-app-ai-planner-install \
      | gzip -n > "$ARCHIVE"
  fi
)

# Also ship a zip — OpenWrt usually has unzip and it avoids tar format issues.
ZIP_ARCHIVE="${OUT_DIR}/luci-app-ai-planner-install.zip"
rm -f "$ZIP_ARCHIVE"
(
  cd "$OUT_DIR"
  zip -qr "$ZIP_ARCHIVE" luci-app-ai-planner-install -x '*.DS_Store' -x '*/._*'
)

echo
echo "Packed (BusyBox-safe):"
ls -lh "$ARCHIVE" "$ZIP_ARCHIVE"
echo
echo "Prefer ZIP on ImmortalWrt if tar still fails:"
echo "  cd /tmp && unzip -o luci-app-ai-planner-install.zip"
echo "  cd luci-app-ai-planner-install && sh install.sh"
echo
echo "Or tar.gz:"
echo "  cd /tmp && tar xzf luci-app-ai-planner-install.tar.gz"
echo "  cd luci-app-ai-planner-install && sh install.sh"
