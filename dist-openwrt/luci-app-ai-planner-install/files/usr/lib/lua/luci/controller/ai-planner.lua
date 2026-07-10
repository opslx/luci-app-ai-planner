-- LuCI controller for OpenWrt 18.06 / legacy LuCI (Lua menu registration).
-- Newer OpenWrt (19.07+) also ships menu.d JSON; both can coexist.

module("luci.controller.ai-planner", package.seeall)

function index()
	if not nixio.fs.access("/www/luci-app-ai-planner/index.html") then
		return
	end

	entry({"admin", "services", "ai-planner"}, template("ai-planner/app"), _("AI Wi-Fi 布放"), 60).dependent = true
end
