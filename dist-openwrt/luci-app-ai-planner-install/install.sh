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
