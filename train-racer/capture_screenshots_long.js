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

    // Run for 30 seconds
    console.log('[INFO] Running game for 30 seconds...');
    await page.waitForTimeout(30000);
    console.log('[OK] Game ran for 30 seconds');

    // Desktop screenshot
    console.log('[INFO] Capturing final desktop screenshot (1280x800)...');
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.screenshot({ path: 'desktop_30s.png' });
    console.log('[OK] Saved: desktop_30s.png');

    // Game state
    const gameState = await page.evaluate(() => {
      try {
        return {
          trainsCount: typeof trains !== 'undefined' ? trains.length : 'undefined',
          trainStates: typeof trains !== 'undefined' ? trains.map(t => ({
            color: t.color,
            state: t.state,
            cargo: t.cargo ? t.cargo.type : null
          })) : 'undefined',
          shipsCount: typeof ships !== 'undefined' ? ships.length : 'undefined',
          shipStates: typeof ships !== 'undefined' ? ships.map(s => ({
            x: Math.round(s.x),
            y: Math.round(s.y),
            state: s.state
          })) : 'undefined',
          score: typeof score !== 'undefined' ? score : 'undefined',
          cargoCount: typeof cargoCount !== 'undefined' ? cargoCount : 'undefined',
          sleepCount: typeof sleepCount !== 'undefined' ? sleepCount : 'undefined',
        };
      } catch (e) {
        return { error: e.message };
      }
    });

    console.log('\n[GAME STATE AFTER 30 SECONDS]');
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
