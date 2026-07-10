# luci-app-ai-planner — OpenWrt 打包与部署

## 方式一：SDK 编 ipk（推荐）

```bash
# 在项目根目录
npm ci
npm run build:openwrt

# 将整个 openwrt/ 目录复制到 OpenWrt SDK 的 package/ 下
cd /path/to/sdk
make package/luci-app-ai-planner/compile V=s

scp bin/packages/*/luci/luci-app-ai-planner_*.ipk root@192.168.1.1:/tmp/
ssh root@192.168.1.1 opkg install /tmp/luci-app-ai-planner_*.ipk
```

安装后 LuCI 菜单：**服务 → AI Wi-Fi 布放**

> **OpenWrt 18.06 / ImmortalWrt 18.06**：使用 Lua controller + 模板（已内置），不依赖 `menu.d` JSON。
> **OpenWrt 19.07+**：同时安装 `menu.d` 与新 JS view，任选其一生效。

## 方式二：手动部署（ImmortalWrt 18.06 推荐先试）

```bash
npm run build:openwrt

ROUTER=root@192.168.1.1

# 静态 SPA
scp -r openwrt/htdocs/* $ROUTER:/www/luci-app-ai-planner/

# 18.06 LuCI 菜单（Lua）
ssh $ROUTER "mkdir -p /usr/lib/lua/luci/view/ai-planner"
scp openwrt/root/usr/lib/lua/luci/controller/ai-planner.lua \
    $ROUTER:/usr/lib/lua/luci/controller/
scp openwrt/root/usr/lib/lua/luci/view/ai-planner/app.htm \
    $ROUTER:/usr/lib/lua/luci/view/ai-planner/

# ubus 读权限
scp openwrt/root/usr/share/rpcd/acl.d/luci-app-ai-planner.json \
    $ROUTER:/usr/share/rpcd/acl.d/

# 可选：新版 LuCI 菜单（18.06 可忽略）
# scp openwrt/root/usr/share/luci/menu.d/luci-app-ai-planner.json ...

ssh $ROUTER /etc/init.d/rpcd restart
```

登录 LuCI → **服务 → AI Wi-Fi 布放**。

若菜单未出现，确认 `/www/luci-app-ai-planner/index.html` 存在后刷新页面或清除浏览器缓存。

## 18.06 依赖检查

在路由器上执行：

```sh
opkg list-installed | grep -E 'uhttpd-mod-ubus|rpcd|iwinfo|luci-base'
```

建议已安装：

- `luci-base`
- `uhttpd-mod-ubus`
- `rpcd`
- `iwinfo`（可选；无则终端列表走 `network.wireless status` 回退）

## 18.06 终端数据说明

| 数据源 | 18.06 支持 |
|--------|------------|
| `system.board` | 通常可用 |
| `network.wireless status` | 通常可用 |
| `iwinfo assoclist` | 常不可用（无 rpcd-mod-iwinfo） |
| `network.wireless` 内嵌 stations | 回退路径 |
| `luci-rpc getDHCPLeases` | 主机名回退 |

## 直接访问（不经过菜单）

```
http://<路由IP>/luci-app-ai-planner/index.html
```

需先登录 LuCI，以便 `sysauth` cookie / session 传给 `/ubus`。

## 说明

- 静态资源：`/www/luci-app-ai-planner/`
- API Key 仅存浏览器 localStorage
- `htdocs/` 由 `npm run build:openwrt` 生成
