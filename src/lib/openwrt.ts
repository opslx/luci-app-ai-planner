import type { RouterInfo, RouterRadio, WifiClient } from '../types/floorplan';

/**
 * OpenWrt data source.
 *
 * When this app is deployed as a LuCI plugin (luci-app-ai-planner) it is served by
 * uhttpd on the router, so it can read live router information through the ubus
 * JSON-RPC endpoint (`/ubus`). The methods used here (`system board`,
 * `network.wireless status`, `iwinfo info/assoclist`, `luci-rpc getHostHints`)
 * require read ACLs — see `openwrt/root/usr/share/rpcd/acl.d/luci-app-ai-planner.json`.
 *
 * OpenWrt 18.06 / legacy LuCI: iwinfo ubus may be missing; we fall back to parsing
 * `network.wireless status` station data and `luci-rpc getDHCPLeases` for hostnames.
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

interface AssocEntry {
  mac?: string;
  signal?: number;
  noise?: number;
  inactive?: number;
  rx_rate?: number | { rate?: number };
  tx_rate?: number | { rate?: number };
}

function rateToMbps(value: unknown): number | undefined {
  const rate = typeof value === 'object' && value !== null
    ? (value as { rate?: unknown }).rate
    : value;
  if (typeof rate !== 'number' || !Number.isFinite(rate)) return undefined;
  return rate > 1000 ? rate / 1000 : rate;
}

function readSession(): string {
  if (typeof document !== 'undefined') {
    const params = new URLSearchParams(window.location.search);
    const fromQuery = params.get('session');
    if (fromQuery) return fromQuery;
  }
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

function normalizeMac(mac: string): string {
  return mac.toUpperCase().replace(/-/g, ':');
}

function pushClient(
  clients: WifiClient[],
  seen: Set<string>,
  mac: string,
  signal: number | undefined,
  band: RouterRadio['band'],
  ifname: string,
  hostname?: string,
  details: Pick<WifiClient, 'noise' | 'inactiveMs' | 'rxRateMbps' | 'txRateMbps'> = {},
): void {
  const normalized = normalizeMac(mac);
  if (seen.has(normalized)) return;
  seen.add(normalized);
  clients.push({
    mac: normalized,
    hostname: hostname || undefined,
    signal: typeof signal === 'number' ? signal : -75,
    ...details,
    snr:
      typeof signal === 'number' && typeof details.noise === 'number'
        ? signal - details.noise
        : undefined,
    band,
    ifname,
  });
}

/** Hostname lookup: getHostHints (21.02+) + getDHCPLeases (18.06). */
async function fetchHostnameMap(
  base: string,
  session: string,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();

  try {
    const hints = await ubusCall(base, session, 'luci-rpc', 'getHostHints');
    for (const [mac, data] of Object.entries(hints)) {
      const name = (data as { name?: string }).name;
      if (name) map.set(normalizeMac(mac), name);
    }
  } catch {
    // not available on all versions
  }

  try {
    const leases = await ubusCall(base, session, 'luci-rpc', 'getDHCPLeases');
    const list = (leases.dhcp_leases as Array<Record<string, unknown>>) ?? [];
    for (const entry of list) {
      const mac = entry.macaddr as string | undefined;
      const hostname = entry.hostname as string | undefined;
      if (mac && hostname) map.set(normalizeMac(mac), hostname);
    }
  } catch {
    // not available on all versions
  }

  return map;
}

interface RadioIface {
  ifname: string;
  band: RouterRadio['band'];
  ssid?: string;
  channel?: number;
  txpower?: number;
  htmode?: string;
}

async function listRadioIfaces(base: string, session: string): Promise<RadioIface[]> {
  const wireless = await ubusCall(base, session, 'network.wireless', 'status');
  const ifaces: RadioIface[] = [];

  for (const radioName of Object.keys(wireless)) {
    const radio = wireless[radioName] as Record<string, unknown>;
    const radioIfaces = (radio.interfaces as Array<Record<string, unknown>>) ?? [];
    const channel = radio.config ? (radio.config as Record<string, unknown>).channel as number : undefined;

    for (const iface of radioIfaces) {
      const ifname = iface.ifname as string | undefined;
      if (!ifname) continue;
      const config = iface.config as Record<string, unknown> | undefined;
      let freq: number | undefined;
      let txpower: number | undefined;
      let htmode: string | undefined;
      let resolvedChannel = channel;

      const iw = await ubusCall(base, session, 'iwinfo', 'info', { device: ifname }).catch(
        () => ({}) as Record<string, unknown>,
      );
      txpower = iw.txpower as number | undefined;
      resolvedChannel = (iw.channel as number | undefined) ?? resolvedChannel;
      freq = iw.frequency as number | undefined;
      htmode = iw.htmode as string | undefined;

      ifaces.push({
        ifname,
        band: bandFromChannel(resolvedChannel, freq),
        ssid: config?.ssid as string | undefined,
        channel: resolvedChannel,
        txpower,
        htmode,
      });
    }
  }

  return ifaces;
}

/** Parse clients embedded in network.wireless status (OpenWrt 18.06 fallback). */
function clientsFromWirelessStatus(
  wireless: Record<string, unknown>,
  ifaces: RadioIface[],
  hostMap: Map<string, string>,
): WifiClient[] {
  const clients: WifiClient[] = [];
  const seen = new Set<string>();
  const bandByIfname = new Map(ifaces.map((i) => [i.ifname, i.band]));

  for (const radioName of Object.keys(wireless)) {
    const radio = wireless[radioName] as Record<string, unknown>;
    const radioIfaces = (radio.interfaces as Array<Record<string, unknown>>) ?? [];

    for (const iface of radioIfaces) {
      const ifname = (iface.ifname as string) ?? '';
      const band = bandByIfname.get(ifname) ?? '2.4';

      const stations = iface.stations as Record<string, Record<string, unknown>> | undefined;
      if (stations) {
        for (const [mac, data] of Object.entries(stations)) {
          const signal = data.signal as number | undefined;
          pushClient(clients, seen, mac, signal, band, ifname, hostMap.get(normalizeMac(mac)), {
            noise: data.noise as number | undefined,
            inactiveMs: data.inactive as number | undefined,
            rxRateMbps: rateToMbps(data.rx_rate),
            txRateMbps: rateToMbps(data.tx_rate),
          });
        }
      }

      const iwinfo = iface.iwinfo as Record<string, unknown> | undefined;
      const embedded = (iwinfo?.assoclist as AssocEntry[]) ?? (iface.assoclist as AssocEntry[] | undefined);
      if (embedded?.length) {
        for (const entry of embedded) {
          if (!entry.mac) continue;
          pushClient(
            clients,
            seen,
            entry.mac,
            entry.signal,
            band,
            ifname,
            hostMap.get(normalizeMac(entry.mac)),
            {
              noise: entry.noise,
              inactiveMs: entry.inactive,
              rxRateMbps: rateToMbps(entry.rx_rate),
              txRateMbps: rateToMbps(entry.tx_rate),
            },
          );
        }
      }
    }
  }

  return clients;
}

async function clientsFromIwinfo(
  base: string,
  session: string,
  ifaces: RadioIface[],
  hostMap: Map<string, string>,
): Promise<WifiClient[]> {
  const clients: WifiClient[] = [];
  const seen = new Set<string>();

  for (const iface of ifaces) {
    const assoc = await ubusCall(base, session, 'iwinfo', 'assoclist', { device: iface.ifname }).catch(
      () => ({}) as Record<string, unknown>,
    );
    const results = (assoc.results as AssocEntry[]) ?? [];

    for (const entry of results) {
      if (!entry.mac) continue;
      pushClient(
        clients,
        seen,
        entry.mac,
        entry.signal,
        iface.band,
        iface.ifname,
        hostMap.get(normalizeMac(entry.mac)),
        {
          noise: entry.noise,
          inactiveMs: entry.inactive,
          rxRateMbps: rateToMbps(entry.rx_rate),
          txRateMbps: rateToMbps(entry.tx_rate),
        },
      );
    }
  }

  return clients;
}

/**
 * Read associated Wi-Fi clients from iwinfo.assoclist on each wireless interface.
 * Falls back to network.wireless status station data on OpenWrt 18.06.
 */
export async function fetchAssociatedClients(opts: UbusOptions = {}): Promise<WifiClient[]> {
  const base = opts.base ?? '/ubus';
  const session = opts.session ?? readSession();

  try {
    const [ifaces, hostMap, wireless] = await Promise.all([
      listRadioIfaces(base, session),
      fetchHostnameMap(base, session),
      ubusCall(base, session, 'network.wireless', 'status'),
    ]);

    let clients = await clientsFromIwinfo(base, session, ifaces, hostMap);
    if (!clients.length) {
      clients = clientsFromWirelessStatus(wireless, ifaces, hostMap);
    }

    return clients.sort((a, b) => b.signal - a.signal);
  } catch {
    return demoClients();
  }
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
    const ifaces = await listRadioIfaces(base, session);
    const clientList = await fetchAssociatedClients({ base, session });

    const radioClients = new Map<string, number>();
    for (const c of clientList) {
      radioClients.set(c.ifname, (radioClients.get(c.ifname) ?? 0) + 1);
    }

    const radios: RouterRadio[] = ifaces.map((iface) => ({
      band: iface.band,
      ssid: iface.ssid,
      channel: iface.channel,
      txpower: iface.txpower,
      htmode: iface.htmode,
      clients: radioClients.get(iface.ifname) ?? 0,
    }));

    return {
      model: (board.model as string) ?? 'OpenWrt Router',
      boardName: board.board_name as string | undefined,
      firmware: (board.release as Record<string, unknown> | undefined)?.description as string | undefined,
      radios: radios.length ? radios : demoRouterInfo().radios,
      clients: clientList.length,
      clientList,
      uptime: info.uptime as number | undefined,
      source: 'openwrt',
    };
  } catch {
    return demoRouterInfo();
  }
}

/** Demo associated clients for dev / offline use. */
export function demoClients(): WifiClient[] {
  return [
    { mac: 'AA:BB:CC:11:22:01', hostname: 'iPhone', signal: -52, band: '5', ifname: 'wlan0' },
    { mac: 'AA:BB:CC:11:22:02', hostname: 'MacBook', signal: -61, band: '5', ifname: 'wlan0' },
    { mac: 'AA:BB:CC:11:22:03', hostname: '智能电视', signal: -68, band: '2.4', ifname: 'wlan1' },
  ];
}

/** Representative router info used when no OpenWrt system is reachable. */
export function demoRouterInfo(): RouterInfo {
  const clientList = demoClients();
  return {
    model: 'Xiaomi AX3600 (演示)',
    boardName: 'xiaomi,ax3600',
    firmware: 'OpenWrt 23.05.5',
    radios: [
      { band: '2.4', ssid: 'Home-2G', channel: 6, txpower: 20, htmode: 'HE40', clients: 1 },
      { band: '5', ssid: 'Home-5G', channel: 44, txpower: 23, htmode: 'HE80', clients: 2 },
    ],
    clients: clientList.length,
    clientList,
    uptime: 128400,
    source: 'demo',
  };
}
