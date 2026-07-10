import type { RouterInfo, RouterRadio } from '../types/floorplan';

/**
 * OpenWrt data source.
 *
 * When this app is deployed as a LuCI plugin (luci-app-ai-planner) it is served by
 * uhttpd on the router, so it can read live router information through the ubus
 * JSON-RPC endpoint (`/ubus`). The methods used here (`system board`,
 * `network.wireless status`, `iwinfo info/assoclist`) require read ACLs — see
 * `openwrt/root/usr/share/rpcd/acl.d/luci-app-ai-planner.json`.
 *
 * When running in a normal browser (dev server, static hosting) the ubus endpoint
 * is unreachable, so every call falls back to representative demo data. Callers can
 * inspect `RouterInfo.source` to tell the two apart.
 */

const ANON_SESSION = '00000000000000000000000000000000';

export interface UbusOptions {
  /** ubus RPC endpoint, defaults to same-origin `/ubus` (OpenWrt uhttpd-mod-ubus). */
  base?: string;
  /** ubus session id; the LuCI session token when logged in, else the anon session. */
  session?: string;
}

interface UbusResponse {
  jsonrpc: string;
  id: number;
  result?: [number, Record<string, unknown>?];
  error?: { code: number; message: string };
}

function readSession(): string {
  // LuCI stores the active session id in the `sysauth` cookie once logged in.
  const match = typeof document !== 'undefined'
    ? document.cookie.match(/(?:^|;\s*)sysauth(?:_https?)?=([^;]+)/)
    : null;
  return match ? decodeURIComponent(match[1]) : ANON_SESSION;
}

async function ubusCall(
  base: string,
  session: string,
  object: string,
  method: string,
  args: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const res = await fetch(base, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'call',
      params: [session, object, method, args],
    }),
  });
  if (!res.ok) throw new Error(`ubus HTTP ${res.status}`);
  const data = (await res.json()) as UbusResponse;
  if (data.error) throw new Error(`ubus error ${data.error.code}: ${data.error.message}`);
  const [code, payload] = data.result ?? [1];
  if (code !== 0) throw new Error(`ubus call ${object}.${method} failed (code ${code})`);
  return payload ?? {};
}

function bandFromChannel(channel?: number, freq?: number): RouterRadio['band'] {
  const f = freq ?? 0;
  if (f >= 5925 || (channel ?? 0) >= 233) return '6';
  if (f >= 4900 || (channel ?? 0) > 14) return '5';
  return '2.4';
}

/**
 * Read live router info from OpenWrt via ubus. Falls back to demo data on any failure
 * (not running on a router, CORS, missing ACL, network error, …).
 */
export async function fetchRouterInfo(opts: UbusOptions = {}): Promise<RouterInfo> {
  const base = opts.base ?? '/ubus';
  const session = opts.session ?? readSession();

  try {
    const board = await ubusCall(base, session, 'system', 'board');
    const info = await ubusCall(base, session, 'system', 'info').catch(() => ({}) as Record<string, unknown>);
    const wireless = await ubusCall(base, session, 'network.wireless', 'status');

    const radios: RouterRadio[] = [];
    let totalClients = 0;

    for (const radioName of Object.keys(wireless)) {
      const radio = wireless[radioName] as Record<string, unknown>;
      const ifaces = (radio.interfaces as Array<Record<string, unknown>>) ?? [];
      const first = ifaces[0]?.config as Record<string, unknown> | undefined;
      const ifname = (ifaces[0]?.ifname as string) ?? '';

      let txpower: number | undefined;
      let channel = radio.config ? (radio.config as Record<string, unknown>).channel as number : undefined;
      let freq: number | undefined;
      let htmode: string | undefined;
      let clients = 0;

      if (ifname) {
        const iw = await ubusCall(base, session, 'iwinfo', 'info', { device: ifname }).catch(
          () => ({}) as Record<string, unknown>,
        );
        txpower = iw.txpower as number | undefined;
        channel = (iw.channel as number | undefined) ?? channel;
        freq = iw.frequency as number | undefined;
        htmode = iw.htmode as string | undefined;
        const assoc = await ubusCall(base, session, 'iwinfo', 'assoclist', { device: ifname }).catch(
          () => ({}) as Record<string, unknown>,
        );
        clients = ((assoc.results as unknown[]) ?? []).length;
      }

      totalClients += clients;
      radios.push({
        band: bandFromChannel(channel, freq),
        ssid: first?.ssid as string | undefined,
        channel,
        txpower,
        htmode,
        clients,
      });
    }

    return {
      model: (board.model as string) ?? 'OpenWrt Router',
      boardName: board.board_name as string | undefined,
      firmware: (board.release as Record<string, unknown> | undefined)?.description as string | undefined,
      radios: radios.length ? radios : demoRouterInfo().radios,
      clients: totalClients,
      uptime: info.uptime as number | undefined,
      source: 'openwrt',
    };
  } catch {
    return demoRouterInfo();
  }
}

/** Representative router info used when no OpenWrt system is reachable. */
export function demoRouterInfo(): RouterInfo {
  return {
    model: 'Xiaomi AX3600 (演示)',
    boardName: 'xiaomi,ax3600',
    firmware: 'OpenWrt 23.05.5',
    radios: [
      { band: '2.4', ssid: 'Home-2G', channel: 6, txpower: 20, htmode: 'HE40', clients: 4 },
      { band: '5', ssid: 'Home-5G', channel: 44, txpower: 23, htmode: 'HE80', clients: 6 },
    ],
    clients: 10,
    uptime: 128400,
    source: 'demo',
  };
}
