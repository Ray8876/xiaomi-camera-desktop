const {defineConfig} = require('@playwright/test');
module.exports = defineConfig({
  testDir: './tests/ui', timeout: 30000, fullyParallel: false, workers: 1,
  use: {browserName: 'chromium', viewport: {width: 1440, height: 920}, screenshot: 'only-on-failure', trace: 'retain-on-failure', launchOptions: process.env.CHROME_PATH ? {executablePath: process.env.CHROME_PATH} : {}},
  reporter: [['list']]
});
