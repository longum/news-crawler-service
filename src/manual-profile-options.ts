export interface ManualProfileOptions {
  url: string;
  profile: string;
}

function readArgument(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

export function parseManualProfileArgs(args: string[]): ManualProfileOptions {
  const urlValue = readArgument(args, '--url');
  const profile = readArgument(args, '--profile');

  try {
    const url = new URL(urlValue ?? '');
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
  } catch {
    throw new Error('--url must be a valid http or https URL');
  }

  if (!profile || profile === '.' || profile === '..' || !/^[a-zA-Z0-9._-]+$/.test(profile)) {
    throw new Error('--profile must contain only letters, numbers, dots, underscores, or hyphens');
  }

  return { url: urlValue!, profile };
}
