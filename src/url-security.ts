import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const blockedHostnames = new Set(['localhost']);

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
  const family = isIP(address);
  if (family === 0) return false;

  if (family === 4) {
    return (
      isInIpv4Range(address, '0.0.0.0', 8) ||
      isInIpv4Range(address, '10.0.0.0', 8) ||
      isInIpv4Range(address, '100.64.0.0', 10) ||
      isInIpv4Range(address, '127.0.0.0', 8) ||
      isInIpv4Range(address, '169.254.0.0', 16) ||
      isInIpv4Range(address, '172.16.0.0', 12) ||
      isInIpv4Range(address, '192.168.0.0', 16) ||
      isInIpv4Range(address, '198.18.0.0', 15) ||
      isInIpv4Range(address, '224.0.0.0', 4) ||
      address === '255.255.255.255'
    );
  }

  const normalized = address.toLowerCase();
  const mappedIpv4 = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (mappedIpv4) return isBlockedIpAddress(mappedIpv4);

  return (
    normalized === '::' ||
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe80:') ||
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
  const hostname = url.hostname.toLowerCase();
  return blockedHostnames.has(hostname) || isBlockedIpAddress(hostname);
}

export async function assertPublicHttpUrl(value: string, label = 'url'): Promise<string> {
  const url = parseHttpUrl(value);
  if (hasBlockedHostname(url)) {
    throw new Error(`${label} resolves to a blocked address`);
  }

  const records = await lookup(url.hostname, { all: true, verbatim: true });
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
