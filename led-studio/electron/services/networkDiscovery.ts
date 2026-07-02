import os from 'node:os'

export function ipv4ToInt(ip: string): number {
  const parts = ip.split('.').map((part) => Number(part))
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part) || part < 0 || part > 255)) {
    throw new Error(`Invalid IPv4 address: ${ip}`)
  }
  return (
    ((parts[0] << 24) >>> 0) |
    ((parts[1] << 16) >>> 0) |
    ((parts[2] << 8) >>> 0) |
    (parts[3] >>> 0)
  ) >>> 0
}

export function intToIpv4(value: number): string {
  return [
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff
  ].join('.')
}

export function resolveBroadcastAddresses(): string[] {
  const targets = new Set<string>(['255.255.255.255'])
  const interfaces = os.networkInterfaces()
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.internal || entry.family !== 'IPv4' || !entry.address || !entry.netmask) continue
      try {
        const ip = ipv4ToInt(entry.address)
        const mask = ipv4ToInt(entry.netmask)
        const broadcast = (ip & mask) | (~mask >>> 0)
        targets.add(intToIpv4(broadcast >>> 0))
      } catch {
        // ignore malformed interface entries
      }
    }
  }
  return [...targets]
}

/** Host IPs on local IPv4 subnets (/16 … /24). Skips large subnets to avoid huge sweeps. */
export function resolveLocalSubnetHosts(maxHostsPerInterface = 512): string[] {
  const hosts = new Set<string>()
  const interfaces = os.networkInterfaces()

  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.internal || entry.family !== 'IPv4' || !entry.address || !entry.netmask) continue
      try {
        const ip = ipv4ToInt(entry.address)
        const mask = ipv4ToInt(entry.netmask)
        const network = (ip & mask) >>> 0
        const broadcast = (network | (~mask >>> 0)) >>> 0
        const hostCount = broadcast - network - 1
        if (hostCount <= 0 || hostCount > maxHostsPerInterface) continue

        for (let host = network + 1; host < broadcast; host++) {
          hosts.add(intToIpv4(host >>> 0))
        }
      } catch {
        // ignore malformed interface entries
      }
    }
  }

  return [...hosts]
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
