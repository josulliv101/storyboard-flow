import { test } from '@playwright/test';

test('check-console', async ({ page }) => {
  const consoleMessages: string[] = [];
  const pageErrors: string[] = [];

  page.on('console', msg => {
    const type = msg.type();
    if (type === 'error' || type === 'warning') {
      consoleMessages.push(`[CONSOLE ${type.toUpperCase()}]: ${msg.text()}`);
    }
  });

  page.on('pageerror', err => {
    pageErrors.push(`[PAGE ERROR]: ${err.stack || err.message}`);
  });

  const url = 'http://localhost:3000/analysis?sceneId=23a9f0aa-4201-4ef6-b21f-8b36c7ba89e8';
  console.log(`Navigating to ${url}...`);

  try {
    await page.goto(url, { waitUntil: 'load', timeout: 15000 });
  } catch (e: any) {
    console.log(`Navigation error: ${e.message}`);
  }
  
  // Wait for 5 seconds to capture all logs/errors
  await page.waitForTimeout(5000);

  console.log('\n--- BROWSER CONSOLE ERRORS & WARNINGS ---');
  if (consoleMessages.length === 0) {
    console.log('No console errors or warnings detected.');
  } else {
    consoleMessages.forEach(msg => console.log(msg));
  }

  console.log('\n--- RUNTIME PAGE ERRORS ---');
  if (pageErrors.length === 0) {
    console.log('No runtime page errors detected.');
  } else {
    pageErrors.forEach(err => console.log(err));
  }
  console.log('--------------------------------------\n');
});
