import os from 'node:os'
import { Bonjour, type Browser, type Service } from 'bonjour-service'
import { deviceKey } from '../../src/shared/deviceIdentity'

/**
 * mDNS（Bonjour / zeroconf）裝置發現。
 *
 * 與 espStatusListener 的 UDP 4211 廣播並存、互不取代：廣播那條路在
 * 「電腦同時接有線與 Wi-Fi」時會失效（255.255.255.255 只從預設路由那張
 * 網卡送出去），mDNS 走 multicast 224.0.0.251 且我們逐一 interface 送查詢，
 * 不受預設路由影響。
 *
 * === 三個為了 Windows 能正常執行而做的決定 ===
 *
 * 1. 用純 JS 的 bonjour-service（底層 multicast-dns + dgram），
 *    不用任何 native module。
 *    → 不需要 npm run rebuild，electron-builder 打包 Windows 版不會有
 *      ABI 問題，也不需要使用者安裝 Apple Bonjour（iTunes/Bonjour Print
 *      Services）。
 *
 * 2. IP 一律從 mDNS 回應的 A record 取（service.addresses / referer.address），
 *    絕對不呼叫 dns.lookup('xxx.local')。
 *    → 這是最關鍵的一點。Windows 內建的 .local 解析（DNSSD）行為不穩定，
 *      Windows 10 1703 之前完全沒有；靠 OS resolver 就會出現「macOS 正常、
 *      Windows 掃不到」。自己解析 A record 兩邊行為完全一致。
 *
 * 3. 每張 IPv4 網卡各開一個 Bonjour instance（multicast-dns 的 interface
 *    選項），並帶 reuseAddr。
 *    → 解決雙網卡問題（有線＋Wi-Fi），Windows 上還多了 Hyper-V / WSL /
 *      VirtualBox 的虛擬網卡，只綁預設那張幾乎一定掃不到。
 *    → reuseAddr 讓我們能與已經佔用 UDP 5353 的服務共存
 *      （macOS 的 mDNSResponder 永遠佔著；Windows 上裝了 Bonjour 也會）。
 *
 * 剩下一個環境問題無法用程式碼解決，只能回報給使用者：
 *   Windows 防火牆第一次會擋 UDP 5353 的入埠。onError 會把 bind/send 失敗
 *   往上送，由 UI 顯示可行動的訊息，而不是靜默失效。
 */

/** 與韌體 src/mdns_advertiser.cpp 的 SERVICE_NAME / SERVICE_PROTO 必須一致 */
const SERVICE_TYPE = 'ledsync'
const SERVICE_PROTOCOL = 'udp' as const

/** 網卡清單變動（插拔網路線、切 Wi-Fi、VPN 上下線）的輪詢間隔 */
const INTERFACE_RECHECK_MS = 10000
/** 主動重查間隔：晚開機的板子靠這個被找到，不必等使用者按掃描 */
const PERIODIC_QUERY_MS = 15000

export interface MdnsDevice {
  /** 韌體 TXT 帶的原始 device_id（未消毒），用來跟專案設定比對 */
  device_id: string
  /** 韌體 TXT 帶的 MAC 後 3 bytes。同 role 的多台板子 device_id 相同，靠這個區分。 */
  chip_id?: string
  /** mDNS hostname，例如 esp32s3-dancer-demo-001.local */
  host: string
  /** 從 A record 取得的 IPv4 */
  ip: string
  /** 韌體廣告的 status port（預設 4211） */
  port: number
  role_id?: string
  firmware?: string
  /** 從哪張網卡的 IP 發現的，排查雙網卡問題時很有用 */
  via_interface: string
  last_seen_ms: number
}

export interface MdnsSocketOptions {
  bind: string
  interface: string
  reuseAddr: boolean
}

/**
 * 一個 Bonjour instance 的 socket 選項。抽成純函式是為了讓下面三個
 * 「少一個就完全掃不到」的細節被測試釘住 —— 這是本模組最容易被誤改的地方。
 *
 * bind: '0.0.0.0'
 *   multicast-dns 內部是 socket.bind(port, opts.bind || opts.interface)。
 *   只給 interface 的話 socket 會綁在那個 unicast 位址上，而 multicast 封包
 *   的目的位址是 224.0.0.251 —— 對不上綁定位址，核心不會把封包交給這個
 *   socket，於是「送得出去、收不回來」，表現為永遠掃不到任何裝置。
 *   實測驗證過：不給 bind 就是 0 台。
 *
 * interface: <網卡 IP>
 *   multicast-dns 拿它做 addMembership(224.0.0.251, addr) 與
 *   setMulticastInterface(addr)。這是解決雙網卡的關鍵 —— 查詢會確實從這張
 *   網卡送出去，而不是只走預設路由那張。
 *
 * reuseAddr
 *   UDP 5353 幾乎一定已被系統的 mDNS 服務佔用（macOS 的 mDNSResponder 永遠
 *   在跑；Windows 裝過 iTunes / Bonjour Print Services 也會），而且我們自己
 *   每張網卡各開一個 socket 也需要它。
 */
export function mdnsSocketOptions(interfaceAddress: string): MdnsSocketOptions {
  return { bind: '0.0.0.0', interface: interfaceAddress, reuseAddr: true }
}

/** 非內部、有 netmask 的 IPv4 網卡位址清單。每個都要各開一個 instance。 */
export function listIpv4InterfaceAddresses(): string[] {
  const addresses: string[] = []
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.internal || entry.family !== 'IPv4' || !entry.address) continue
      addresses.push(entry.address)
    }
  }
  return addresses
}

/**
 * 從 bonjour-service 的 Service 物件抽出我們要的欄位。
 *
 * 純函式，不碰網路，方便單獨測。回傳 null 代表這筆不是我們的裝置
 * （沒有可用的 IPv4，或 TXT 裡沒有 device_id）。
 */
export function toMdnsDevice(
  service: Service,
  viaInterface: string,
  nowMs: number
): MdnsDevice | null {
  // addresses 可能同時有 IPv6；只取 IPv4，而且不要用 host 名字去解析。
  const ipv4 = (service.addresses ?? []).find((addr) => /^\d{1,3}(\.\d{1,3}){3}$/.test(addr))
  // referer.address 是回應封包的來源 IP，A record 缺漏時的後備來源。
  const refererIp = (service as { referer?: { address?: string } }).referer?.address
  const ip = ipv4 ?? (refererIp && /^\d{1,3}(\.\d{1,3}){3}$/.test(refererIp) ? refererIp : undefined)
  if (!ip) return null

  const txt = (service.txt ?? {}) as Record<string, unknown>
  const readTxt = (key: string): string | undefined => {
    const value = txt[key]
    return typeof value === 'string' && value.length > 0 ? value : undefined
  }

  // device_id 一律用 TXT 的原始值。hostname 已被韌體消毒（底線變 '-'），
  // 拿 hostname 回推會跟專案設定裡的 device_id 對不上。
  const deviceId = readTxt('device_id') ?? service.name
  if (!deviceId) return null

  return {
    device_id: deviceId,
    chip_id: readTxt('chip_id'),
    host: service.host ?? '',
    ip,
    port: service.port ?? 4211,
    role_id: readTxt('role_id'),
    firmware: readTxt('fw'),
    via_interface: viaInterface,
    last_seen_ms: nowMs
  }
}

interface InstanceHandle {
  interfaceAddress: string
  bonjour: Bonjour
  browser: Browser
}

export class MdnsDiscovery {
  private instances: InstanceHandle[] = []
  private devices = new Map<string, MdnsDevice>()
  private listeners = new Set<(devices: MdnsDevice[]) => void>()
  private errorListeners = new Set<(message: string) => void>()
  private interfaceTimer: NodeJS.Timeout | null = null
  private queryTimer: NodeJS.Timeout | null = null
  private started = false

  subscribe(listener: (devices: MdnsDevice[]) => void): () => void {
    this.listeners.add(listener)
    listener(this.listDevices())
    return () => this.listeners.delete(listener)
  }

  onError(listener: (message: string) => void): () => void {
    this.errorListeners.add(listener)
    return () => this.errorListeners.delete(listener)
  }

  /** 有沒有任何一張網卡的 mDNS instance 成功啟動（診斷用） */
  isRunning(): boolean {
    return this.instances.length > 0
  }

  listDevices(): MdnsDevice[] {
    // 同 device_id 的多台板子要有穩定順序，否則畫面每次更新都在跳動。
    return [...this.devices.values()].sort((a, b) =>
      deviceKey(a.device_id, a.chip_id, a.ip).localeCompare(
        deviceKey(b.device_id, b.chip_id, b.ip)
      )
    )
  }

  start(): void {
    if (this.started) return
    this.started = true
    this.syncInstances()
    this.interfaceTimer = setInterval(() => this.syncInstances(), INTERFACE_RECHECK_MS)
    this.queryTimer = setInterval(() => this.query(), PERIODIC_QUERY_MS)
  }

  stop(): void {
    this.started = false
    if (this.interfaceTimer) {
      clearInterval(this.interfaceTimer)
      this.interfaceTimer = null
    }
    if (this.queryTimer) {
      clearInterval(this.queryTimer)
      this.queryTimer = null
    }
    for (const instance of this.instances) {
      this.destroyInstance(instance)
    }
    this.instances = []
  }

  /** 讓「掃描裝置」按鈕能立刻重發查詢，不必等 PERIODIC_QUERY_MS。 */
  query(): void {
    // 先補上剛出現的網卡（例如使用者剛把 Wi-Fi 接上）
    this.syncInstances()
    for (const instance of this.instances) {
      try {
        instance.browser.update()
      } catch (err) {
        this.emitError(
          `mDNS 查詢失敗（網卡 ${instance.interfaceAddress}）：${err instanceof Error ? err.message : String(err)}`
        )
      }
    }
  }

  /** 依目前的網卡清單開／關 instance。網路環境變了也不用重開 app。 */
  private syncInstances(): void {
    if (!this.started) return
    const wanted = new Set(listIpv4InterfaceAddresses())

    for (const instance of [...this.instances]) {
      if (!wanted.has(instance.interfaceAddress)) {
        this.destroyInstance(instance)
        this.instances = this.instances.filter((i) => i !== instance)
      }
    }

    const existing = new Set(this.instances.map((i) => i.interfaceAddress))
    for (const address of wanted) {
      if (existing.has(address)) continue
      this.createInstance(address)
    }
  }

  private createInstance(interfaceAddress: string): void {
    try {
      const bonjour = new Bonjour(mdnsSocketOptions(interfaceAddress) as never)
      const browser = bonjour.find({ type: SERVICE_TYPE, protocol: SERVICE_PROTOCOL })

      const record = (service: Service) => {
        const device = toMdnsDevice(service, interfaceAddress, Date.now())
        if (!device) return
        // key 不能只用 device_id：同 role 的十台板子 device_id 完全相同，
        // 只用它會讓十台併成一台。
        this.devices.set(deviceKey(device.device_id, device.chip_id, device.ip), device)
        this.emit()
      }

      browser.on('up', record)
      browser.on('srv-update', record)
      browser.on('txt-update', record)
      browser.on('down', (service: Service) => {
        const device = toMdnsDevice(service, interfaceAddress, Date.now())
        if (!device) return
        // 只有「所有網卡都看不到它」才真的移除。板子同時被兩張網卡看到時，
        // 其中一張說 down 不代表裝置離線。
        const key = deviceKey(device.device_id, device.chip_id, device.ip)
        const known = this.devices.get(key)
        if (known && known.via_interface === interfaceAddress) {
          this.devices.delete(key)
          this.emit()
        }
      })

      this.instances.push({ interfaceAddress, bonjour, browser })
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err)
      this.emitError(this.describeBindFailure(interfaceAddress, raw))
    }
  }

  /**
   * 把底層的 EADDRINUSE / EACCES / EPERM 翻成使用者能動手處理的訊息。
   * 原始訊息看不出「該去開防火牆」還是「該關掉別的程式」。
   */
  private describeBindFailure(interfaceAddress: string, raw: string): string {
    if (/EADDRINUSE/i.test(raw)) {
      return (
        `mDNS 無法在網卡 ${interfaceAddress} 上啟動：UDP 5353 已被佔用（${raw}）。` +
        'Windows 上通常是 Apple Bonjour Service，macOS 上是 mDNSResponder。' +
        '裝置發現會退回 UDP 4211 廣播與手動輸入 IP。'
      )
    }
    if (/EACCES|EPERM/i.test(raw)) {
      return (
        `mDNS 無法在網卡 ${interfaceAddress} 上啟動：權限被拒（${raw}）。` +
        'Windows：請在防火牆允許本程式的「私人網路」入埠 UDP 5353。' +
        'macOS：請在「系統設定 → 隱私權與安全性 → 本機網路」允許本程式。'
      )
    }
    return `mDNS 在網卡 ${interfaceAddress} 上啟動失敗：${raw}`
  }

  private destroyInstance(instance: InstanceHandle): void {
    try {
      instance.browser.stop()
    } catch {
      // 已經壞掉的 browser，停不下來就算了
    }
    try {
      instance.bonjour.destroy()
    } catch {
      // 同上
    }
  }

  private emit(): void {
    const list = this.listDevices()
    for (const listener of this.listeners) listener(list)
  }

  private emitError(message: string): void {
    console.error('[mdns]', message)
    for (const listener of this.errorListeners) listener(message)
  }
}

export const mdnsDiscovery = new MdnsDiscovery()
