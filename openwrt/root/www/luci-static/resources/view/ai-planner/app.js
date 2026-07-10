'use strict';
'require view';

/*
 * LuCI view that embeds the prebuilt AI Wi-Fi planner SPA (installed at
 * /www/luci-app-ai-planner/). The SPA itself reads router info over ubus
 * (see src/lib/openwrt.ts) using the ACL shipped with this package.
 */
return view.extend({
	load: function () {
		return Promise.resolve(null);
	},

	render: function () {
		return E('iframe', {
			'src': '/luci-app-ai-planner/index.html',
			'style': 'width:100%;height:calc(100vh - 150px);border:0;border-radius:12px;',
		});
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null,
});
