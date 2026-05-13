const puppeteer = require("puppeteer");
const fs = require("fs");
require("dotenv").config();

// Get parameters from command line: node grafana.js [project] [env]
// Example: node grafana.js elx int
// Function to take a screenshot for a specific project and env
async function takeScreenshot(project = "elx", env = "int", timeRange = "30d", targetPods = []) {
  // Normalize targetPods to an array
  const pods = Array.isArray(targetPods) 
    ? (targetPods.length > 0 ? targetPods : [""]) 
    : [targetPods || ""];

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1200 });

  try {
    const baseUrl = `https://grafana-${env}-${project}.${process.env.GRAFANA_BASE_DOMAIN}`;

    // 1. LOGIN
    console.log(`[${project}-${env}][${timeRange}] Navigating to login page...`);
    await page.goto(`${baseUrl}/login`, {
      waitUntil: "networkidle2"
    });

    console.log(`[${project}-${env}][${timeRange}] Typing credentials...`);
    await page.type('input[name="user"]', process.env.GRAFANA_USER || "admin");
    await page.type('input[name="password"]', process.env.GRAFANA_PASSWORD || "");

    console.log(`[${project}-${env}][${timeRange}] Submitting login form...`);
    await Promise.all([
      page.click('button[type="submit"]'),
      page.waitForNavigation({ waitUntil: "networkidle2" })
    ]);

    // 2. LOOP THROUGH PODS
    for (const targetPod of pods) {
      try {
        const podLogPrefix = targetPod ? `[${targetPod}]` : "[General]";
        
        // 2.1 NAVIGATE TO DASHBOARD
        // Using dynamic from=now-${timeRange}
        const url = `${baseUrl}/d/85a562078cdf77779eaa1add43ccec1e/kubernetes-compute-resources-namespace-pods?orgId=1&from=now-${timeRange}&to=now&timezone=Asia%2FSingapore&var-datasource=default&var-namespace=${project}-coremedia&refresh=off&kiosk`;

        console.log(`[${project}-${env}][${timeRange}]${podLogPrefix} Navigating to dashboard...`);
        await page.goto(url, { waitUntil: "networkidle0" });

        // 2.2 SMART WAIT FOR RENDERING
        console.log(`[${project}-${env}][${timeRange}]${podLogPrefix} Waiting for panels to load data...`);
        await page.waitForSelector('.react-grid-item', { timeout: 30000 });

        await page.waitForFunction(() => {
          const loaders = document.querySelectorAll(
            '.panel-loading, .loading-indicator, [data-testid="panel-loading-indicator"], .refresh-picker-icon--spin'
          );
          return loaders.length === 0;
        }, { timeout: 30000 });

        console.log(`[${project}-${env}][${timeRange}]${podLogPrefix} Data loaded. Finalizing render (2s)...`);
        await new Promise(r => setTimeout(r, 2000));

        // 2.3 ISOLATE TARGET POD IN LEGEND
        if (targetPod) {
          const cleanPod = targetPod.trim();
          const lowerPod = cleanPod.toLowerCase();
          try {
            console.log(`[${project}-${env}][${timeRange}][${cleanPod}] Attempting to isolate in all legends...`);

            // Case-insensitive search using translate()
            const legendXpath = `xpath///button[contains(translate(., 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), "${lowerPod}")]`;
            const targetButtons = await page.$$(legendXpath);

            if (targetButtons.length === 0) {
              console.log(`[${project}-${env}][${timeRange}][${cleanPod}] WARNING: No legend item found matching "${cleanPod}"`);
            }

            for (const button of targetButtons) {
              const btnText = await page.evaluate(el => el.textContent, button);
              console.log(`[${project}-${env}] Legend match: "${btnText.trim()}"`);
              await button.click({ modifiers: ['Shift'] });
            }

            await new Promise(r => setTimeout(r, 1000));
            console.log(`[${project}-${env}][${timeRange}][${cleanPod}] Isolated in ${targetButtons.length} chart(s).`);
          } catch (e) {
            console.log(`[${project}-${env}][${timeRange}][${cleanPod}] Legend item error: ${e.message}`);
          }
        }

        // 2.4 SCREENSHOT
        const reportsDir = "reports";
        if (!fs.existsSync(reportsDir)) {
          fs.mkdirSync(reportsDir);
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const podSuffix = targetPod ? `-${targetPod}` : "";
        const filename = `${project}-${env}-${timeRange}${podSuffix}-grafana-${timestamp}.png`;
        const filePath = `${reportsDir}/${filename}`;

        console.log(`[${project}-${env}][${timeRange}]${podLogPrefix} Taking screenshot: ${filePath}...`);
        await page.screenshot({ path: filePath });

        console.log(`[${project}-${env}][${timeRange}]${podLogPrefix} Success! Saved to ${filePath}`);
      } catch (podError) {
        console.error(`[${project}-${env}][${timeRange}] Error processing pod "${targetPod}":`, podError.message);
      }
    }


  } catch (error) {
    console.error(`[${project}-${env}][${timeRange}] Error occurred:`, error.message);
  } finally {
    await browser.close();
  }
}

// Export for use in run-all.js
module.exports = { takeScreenshot };

// If run directly from command line (node grafana.js elx int 1d)
if (require.main === module) {
  const project = process.argv[2] || "elx";
  const env = process.argv[3] || "int";
  const timeRange = process.argv[4] || "30d";
  const targetPods = process.argv.slice(5); // Collect all pods from index 5 onwards
  takeScreenshot(project, env, timeRange, targetPods);
}