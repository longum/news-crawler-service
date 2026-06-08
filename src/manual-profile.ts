import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { chromium } from 'playwright';
import { parseManualProfileArgs } from './manual-profile-options.js';

async function main(): Promise<void> {
  const { url, profile } = parseManualProfileArgs(process.argv.slice(2));
  const profilePath = resolve(process.cwd(), 'profiles', profile);
  const context = await chromium.launchPersistentContext(profilePath, {
    headless: false,
  });

  try {
    const page = context.pages()[0] ?? (await context.newPage());
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`页面导航未完成，浏览器将继续保持打开：${message}`);
    }

    const terminal = createInterface({ input: stdin, output: stdout });
    try {
      await terminal.question('请手动完成验证码，完成后按回车关闭。\n');
    } finally {
      terminal.close();
    }
  } finally {
    await context.close();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`人工验证浏览器启动失败：${message}`);
  process.exitCode = 1;
});
