import { describe, expect, it } from 'vitest';
import { parseManualProfileArgs } from './manual-profile-options.js';

describe('parseManualProfileArgs', () => {
  it('parses the requested URL and profile directory', () => {
    expect(
      parseManualProfileArgs([
        '--url',
        'https://www.usgs.gov/mission-areas/water-resources/news',
        '--profile',
        'usgs',
      ]),
    ).toEqual({
      url: 'https://www.usgs.gov/mission-areas/water-resources/news',
      profile: 'usgs',
    });
  });

  it('rejects missing and unsafe arguments', () => {
    expect(() => parseManualProfileArgs(['--url', 'not-a-url', '--profile', 'usgs'])).toThrow(
      '--url must be a valid http or https URL',
    );
    expect(() =>
      parseManualProfileArgs(['--url', 'https://example.com', '--profile', '../outside']),
    ).toThrow('--profile must contain only letters, numbers, dots, underscores, or hyphens');
    expect(() => parseManualProfileArgs(['--url', 'https://example.com', '--profile', '..'])).toThrow(
      '--profile must contain only letters, numbers, dots, underscores, or hyphens',
    );
  });
});
