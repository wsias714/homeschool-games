const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

(async () => {
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    // Capture console and errors
    const consoleLogs = [];
    const pageErrors = [];

    page.on('console', msg => {
      consoleLogs.push({ type: msg.type(), text: msg.text() });
    });

    page.on('pageerror', err => {
      pageErrors.push(err.message);
    });

    // Load game
    const gamePath = path.resolve(__dirname, 'index.html');
    const fileUrl = `file://${gamePath}`;
    console.log(`[INFO] Loading: ${fileUrl}`);

    await page.goto(fileUrl, { waitUntil: 'networkidle' });
    console.log('[OK] Page loaded');

    // Wait for game initialization
    await page.waitForTimeout(2000);
    console.log('[OK] Game initialized (2s wait)');

    // Desktop screenshot
    console.log('[INFO] Capturing desktop screenshot (1280x800)...');
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.screenshot({ path: 'desktop.png' });
    console.log('[OK] Saved: desktop.png');

    // Mobile screenshot
    console.log('[INFO] Capturing mobile screenshot (375x812)...');
    await page.setViewportSize({ width: 375, height: 812 });
    await page.screenshot({ path: 'mobile.png' });
    console.log('[OK] Saved: mobile.png');

    // Game state
    const gameState = await page.evaluate(() => {
      try {
        return {
          trainsCount: typeof trains !== 'undefined' ? trains.length : 'undefined',
          shipsCount: typeof ships !== 'undefined' ? ships.length : 'undefined',
          roadsCount: typeof roads !== 'undefined' ? roads.length : 'undefined',
          score: typeof score !== 'undefined' ? score : 'undefined',
          canvasWidth: document.querySelector('canvas')?.width,
          canvasHeight: document.querySelector('canvas')?.height,
          canvasExists: !!document.querySelector('canvas'),
        };
      } catch (e) {
        return { error: e.message };
      }
    });

    console.log('\n[GAME STATE]');
    console.log(JSON.stringify(gameState, null, 2));

    console.log('\n[CONSOLE LOGS & ERRORS]');
    if (consoleLogs.length) {
      consoleLogs.forEach(log => console.log(`  [${log.type.toUpperCase()}] ${log.text}`));
    } else {
      console.log('  (No console logs)');
    }

    if (pageErrors.length) {
      pageErrors.forEach(err => console.log(`  [ERROR] ${err}`));
    } else {
      console.log('  (No page errors)');
    }

    await browser.close();
    console.log('\n[INSPECTION COMPLETE]');
  } catch (error) {
    console.error('[ERROR]', error);
    if (browser) await browser.close();
    process.exit(1);
  }
})();
