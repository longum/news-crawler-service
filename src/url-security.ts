import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const blockedHostnames = new Set(['localhost']);

function normalizeHostname(hostname: string): string {
  const normalized = hostname.toLowerCase();
  return normalized.startsWith('[') && normalized.endsWith(']')
    ? normalized.slice(1, -1)
    : normalized;
}

function ipv4ToNumber(address: string): number | null {
  const parts = address.split('.');
  if (parts.length !== 4) return null;
  const numbers = parts.map((part) => Number(part));
  if (numbers.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return ((numbers[0] << 24) >>> 0) + (numbers[1] << 16) + (numbers[2] << 8) + numbers[3];
}

function isInIpv4Range(address: string, start: string, prefixLength: number): boolean {
  const value = ipv4ToNumber(address);
  const startValue = ipv4ToNumber(start);
  if (value === null || startValue === null) return false;
  const mask = prefixLength === 0 ? 0 : (0xffffffff << (32 - prefixLength)) >>> 0;
  return (value & mask) === (startValue & mask);
}

export function isBlockedIpAddress(address: string): boolean {
  const normalizedAddress = normalizeHostname(address);
  const family = isIP(normalizedAddress);
  if (family === 0) return false;

  if (family === 4) {
    return (
      isInIpv4Range(normalizedAddress, '0.0.0.0', 8) ||
      isInIpv4Range(normalizedAddress, '10.0.0.0', 8) ||
      isInIpv4Range(normalizedAddress, '100.64.0.0', 10) ||
      isInIpv4Range(normalizedAddress, '127.0.0.0', 8) ||
      isInIpv4Range(normalizedAddress, '169.254.0.0', 16) ||
      isInIpv4Range(normalizedAddress, '172.16.0.0', 12) ||
      isInIpv4Range(normalizedAddress, '192.0.0.0', 24) ||
      isInIpv4Range(normalizedAddress, '192.0.2.0', 24) ||
      isInIpv4Range(normalizedAddress, '192.88.99.0', 24) ||
      isInIpv4Range(normalizedAddress, '192.168.0.0', 16) ||
      isInIpv4Range(normalizedAddress, '198.18.0.0', 15) ||
      isInIpv4Range(normalizedAddress, '198.51.100.0', 24) ||
      isInIpv4Range(normalizedAddress, '203.0.113.0', 24) ||
      isInIpv4Range(normalizedAddress, '224.0.0.0', 4) ||
      isInIpv4Range(normalizedAddress, '240.0.0.0', 4) ||
      normalizedAddress === '255.255.255.255'
    );
  }

  const normalized = normalizedAddress;
  const mappedIpv4 = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (mappedIpv4) return isBlockedIpAddress(mappedIpv4);
  const mappedHexIpv4 = normalized.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedHexIpv4) {
    const high = Number.parseInt(mappedHexIpv4[1], 16);
    const low = Number.parseInt(mappedHexIpv4[2], 16);
    return isBlockedIpAddress(
      `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`,
    );
  }
  const firstHextet = Number.parseInt(normalized.split(':', 1)[0] || '0', 16);
  const isLinkLocal = (firstHextet & 0xffc0) === 0xfe80;
  const isSiteLocal = (firstHextet & 0xffc0) === 0xfec0;

  return (
    normalized === '::' ||
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    isLinkLocal ||
    isSiteLocal ||
    normalized.startsWith('2001:db8:') ||
    normalized.startsWith('ff') ||
    normalized.startsWith('::ffff:127.') ||
    normalized.startsWith('::ffff:10.') ||
    normalized.startsWith('::ffff:169.254.') ||
    normalized.startsWith('::ffff:192.168.')
  );
}

export function parseHttpUrl(value: string): URL {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('url must be a valid public http or https URL');
  }
  return url;
}

export function hasBlockedHostname(url: URL): boolean {
  const hostname = normalizeHostname(url.hostname);
  return blockedHostnames.has(hostname) || isBlockedIpAddress(hostname);
}

export async function assertPublicHttpUrl(value: string, label = 'url'): Promise<string> {
  const url = parseHttpUrl(value);
  if (hasBlockedHostname(url)) {
    throw new Error(`${label} resolves to a blocked address`);
  }

  const records = await lookup(normalizeHostname(url.hostname), { all: true, verbatim: true });
  if (records.length === 0 || records.some((record) => isBlockedIpAddress(record.address))) {
    throw new Error(`${label} resolves to a blocked address`);
  }

  return url.href;
}

export function isObviouslyPublicHttpUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = parseHttpUrl(value);
    return hasBlockedHostname(url) ? null : url.href;
  } catch {
    return null;
  }
}
