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
