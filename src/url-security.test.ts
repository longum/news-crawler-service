import { describe, expect, it } from 'vitest';
import { isBlockedIpAddress, isObviouslyPublicHttpUrl } from './url-security.js';

describe('url security helpers', () => {
  it('blocks local, private, link-local, and metadata address ranges', () => {
    expect(isBlockedIpAddress('127.0.0.1')).toBe(true);
    expect(isBlockedIpAddress('10.1.2.3')).toBe(true);
    expect(isBlockedIpAddress('172.16.0.1')).toBe(true);
    expect(isBlockedIpAddress('192.168.1.1')).toBe(true);
    expect(isBlockedIpAddress('169.254.169.254')).toBe(true);
    expect(isBlockedIpAddress('::1')).toBe(true);
    expect(isBlockedIpAddress('fc00::1')).toBe(true);
    expect(isBlockedIpAddress('::ffff:192.168.1.1')).toBe(true);
  });

  it('allows obvious public HTTP URLs without DNS lookup', () => {
    expect(isObviouslyPublicHttpUrl('https://news.example/story')).toBe('https://news.example/story');
    expect(isObviouslyPublicHttpUrl('http://localhost/story')).toBeNull();
    expect(isObviouslyPublicHttpUrl('http://127.0.0.1/story')).toBeNull();
    expect(isObviouslyPublicHttpUrl('file:///tmp/story')).toBeNull();
  });
});
