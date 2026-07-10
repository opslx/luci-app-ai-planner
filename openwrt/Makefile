# SPDX-License-Identifier: MIT
#
# OpenWrt / LuCI package for luci-app-ai-planner.
#
# Build (from an OpenWrt buildroot or the SDK):
#   1. Build the web assets first:   npm ci && npm run build
#   2. Copy them into this package:  cp -r ../dist/* ./htdocs/
#   3. Place this folder under the SDK's package/ tree and run:
#        make package/luci-app-ai-planner/compile V=s
#
# The resulting .ipk installs the static SPA to /www/luci-app-ai-planner/ and an
# rpcd ACL that lets the page read router info over ubus (system/iwinfo/wireless).

include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-ai-planner
PKG_VERSION:=0.1.0
PKG_RELEASE:=1
PKG_LICENSE:=MIT
PKG_MAINTAINER:=luci-app-ai-planner

include $(INCLUDE_DIR)/package.mk

define Package/luci-app-ai-planner
  SECTION:=luci
  CATEGORY:=LuCI
  SUBMENU:=3. Applications
  TITLE:=AI Wi-Fi floor-plan coverage planner
  DEPENDS:=+luci-base +rpcd +uhttpd-mod-ubus +iwinfo
  PKGARCH:=all
endef

define Package/luci-app-ai-planner/description
  Reads live router information from OpenWrt over ubus, uses an AI model to
  generate a floor plan, and simulates whole-home Wi-Fi coverage. Users can
  manually adjust the plan afterwards.
endef

# Web assets are prebuilt with Vite (see header); nothing to compile here.
define Build/Compile
endef

define Package/luci-app-ai-planner/install
	$(INSTALL_DIR) $(1)/www/luci-app-ai-planner
	$(CP) ./htdocs/. $(1)/www/luci-app-ai-planner/
	$(INSTALL_DIR) $(1)/usr/share/rpcd/acl.d
	$(INSTALL_DATA) ./root/usr/share/rpcd/acl.d/luci-app-ai-planner.json \
		$(1)/usr/share/rpcd/acl.d/luci-app-ai-planner.json
	$(INSTALL_DIR) $(1)/usr/share/luci/menu.d
	$(INSTALL_DATA) ./root/usr/share/luci/menu.d/luci-app-ai-planner.json \
		$(1)/usr/share/luci/menu.d/luci-app-ai-planner.json
	$(INSTALL_DIR) $(1)/www/luci-static/resources/view/ai-planner
	$(INSTALL_DATA) ./root/www/luci-static/resources/view/ai-planner/app.js \
		$(1)/www/luci-static/resources/view/ai-planner/app.js
endef

$(eval $(call BuildPackage,luci-app-ai-planner))
