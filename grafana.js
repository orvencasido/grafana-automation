const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");
const nodemailer = require("nodemailer");
require("dotenv").config();

/**
 * CONFIGURATION
 * Centralizing defaults and selectors for easier maintenance.
 */
const CONFIG = {
  DEFAULT_VIEWPORT: { width: 1920, height: 1200 },
  REPORTS_DIR: "reports",
  WAIT_TIMEOUT: 30000,
  GRAFANA_SELECTORS: {
    userField: 'input[name="user"]',
    passField: 'input[name="password"]',
    submitBtn: 'button[type="submit"]',
    panelItem: '.react-grid-item',
    loadingIndicators: '.panel-loading, .loading-indicator, [data-testid="panel-loading-indicator"], .refresh-picker-icon--spin'
  }
};

/**
 * LOGGER
 * Simple utility for consistent console output.
 */
const log = (msg, level = "INFO", context = "") => {
  const timestamp = new Date().toLocaleTimeString();
  const ctx = context ? `[${context}]` : "";
  console.log(`${timestamp} | ${level.padEnd(5)} | ${ctx} ${msg}`);
};

/**
 * UTILS
 */
const ensureDirectory = (dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
};

const smartWait = async (page, context) => {
  log("Waiting for panels to load data...", "INFO", context);
  await page.waitForSelector(CONFIG.GRAFANA_SELECTORS.panelItem, { timeout: CONFIG.WAIT_TIMEOUT });

  await page.waitForFunction((selectors) => {
    const loaders = document.querySelectorAll(selectors);
    return loaders.length === 0;
  }, { timeout: CONFIG.WAIT_TIMEOUT }, CONFIG.GRAFANA_SELECTORS.loadingIndicators);

  log("Data loaded. Finalizing render (2s)...", "INFO", context);
  await new Promise(r => setTimeout(r, 2000));
};

const sendEmail = async (attachments, context) => {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    log("Email credentials missing in .env. Skipping email.", "WARN", context);
    return;
  }

  log(`Preparing to send email with ${attachments.length} attachment(s)...`, "INFO", context);

  const transporter = nodemailer.createTransport({
    service: process.env.EMAIL_SERVICE || 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });

  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: process.env.EMAIL_TO || process.env.EMAIL_USER,
    subject: `Grafana Automation Report - ${new Date().toLocaleString()}`,
    text: `Attached are the screenshots generated for ${context}.\n\nTotal images: ${attachments.length}`,
    attachments: attachments.map(p => ({
      filename: path.basename(p),
      path: p
    }))
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    log(`Email sent successfully: ${info.messageId}`, "SUCCESS", context);
  } catch (error) {
    log(`Failed to send email: ${error.message}`, "ERROR", context);
  }
};

const isolatePodInLegend = async (page, podName, context) => {
  if (!podName) return;
  
  const cleanPod = podName.trim();
  const lowerPod = cleanPod.toLowerCase();
  
  try {
    log(`Attempting to isolate "${cleanPod}" in legends...`, "INFO", context);

    // Case-insensitive search using translate()
    const legendXpath = `xpath///button[contains(translate(., 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), "${lowerPod}")]`;
    const targetButtons = await page.$$(legendXpath);

    if (targetButtons.length === 0) {
      log(`No legend item found matching "${cleanPod}"`, "WARN", context);
      return;
    }

    for (const button of targetButtons) {
      const btnText = await page.evaluate(el => el.textContent, button);
      log(`Legend match: "${btnText.trim()}"`, "DEBUG", context);
      await button.click({ modifiers: ['Shift'] });
    }

    await new Promise(r => setTimeout(r, 1000));
    log(`Isolated in ${targetButtons.length} chart(s).`, "SUCCESS", context);
  } catch (e) {
    log(`Legend isolation error: ${e.message}`, "ERROR", context);
  }
};

/**
 * MAIN LOGIC
 */
async function takeScreenshot({
  project = "elx",
  env = "int",
  duration = "30d",
  pods = [],
  viewport = CONFIG.DEFAULT_VIEWPORT,
  dashboardUid = "85a562078cdf77779eaa1add43ccec1e",
  dashboardSlug = "kubernetes-compute-resources-namespace-pods",
  namespace = null,
  headless = true
} = {}) {
  const contextPrefix = `${project}-${env}-${duration}`;
  const targetPods = Array.isArray(pods) ? (pods.length > 0 ? pods : [""]) : [pods || ""];
  
  // Use provided namespace or fallback to default pattern
  const activeNamespace = namespace || `${project}-coremedia`;
  
  const browser = await puppeteer.launch({
    headless: headless,
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

  const page = await browser.newPage();
  await page.setViewport(viewport);

  const capturedFiles = [];

  try {
    const domain = process.env.GRAFANA_BASE_DOMAIN;
    const baseUrl = `https://grafana-${env}-${project}.${domain}`;

    // 1. LOGIN
    log(`Navigating to login...`, "INFO", contextPrefix);
    await page.goto(`${baseUrl}/login`, { waitUntil: "networkidle2" });

    log(`Authenticating as ${process.env.GRAFANA_USER}...`, "INFO", contextPrefix);
    await page.type(CONFIG.GRAFANA_SELECTORS.userField, process.env.GRAFANA_USER || "admin");
    await page.type(CONFIG.GRAFANA_SELECTORS.passField, process.env.GRAFANA_PASSWORD || "");
    
    await Promise.all([
      page.click(CONFIG.GRAFANA_SELECTORS.submitBtn),
      page.waitForNavigation({ waitUntil: "networkidle2" })
    ]);

    // 2. PROCESS PODS
    for (const targetPod of targetPods) {
      const podCtx = targetPod ? `${contextPrefix}][${targetPod}` : contextPrefix;
      
      try {
        const url = `${baseUrl}/d/${dashboardUid}/${dashboardSlug}?orgId=1&from=now-${duration}&to=now&timezone=Asia%2FSingapore&var-datasource=default&var-namespace=${activeNamespace}&refresh=off&kiosk`;

        log(`Opening dashboard...`, "INFO", podCtx);
        
        let retries = 3;
        while (retries > 0) {
          try {
            await page.goto(url, { waitUntil: "networkidle0", timeout: CONFIG.WAIT_TIMEOUT });
            break;
          } catch (e) {
            retries--;
            log(`Navigation failed. Retrying (${retries} left)... ${e.message}`, "WARN", podCtx);
            if (retries === 0) throw e;
            await new Promise(r => setTimeout(r, 5000));
          }
        }

        await smartWait(page, podCtx);
        await isolatePodInLegend(page, targetPod, podCtx);

        // 3. CAPTURE
        ensureDirectory(CONFIG.REPORTS_DIR);
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const podSuffix = targetPod ? `-${targetPod}` : "";
        const filename = `${project}-${env}-${duration}${podSuffix}-grafana-${timestamp}.png`;
        const filePath = path.join(CONFIG.REPORTS_DIR, filename);

        log(`Capturing screenshot...`, "INFO", podCtx);
        await page.screenshot({ path: filePath, fullPage: false });
        log(`Success! Saved to ${filePath}`, "SUCCESS", podCtx);

        capturedFiles.push(filePath);

      } catch (stepError) {
        log(`Failed at step: ${stepError.message}`, "ERROR", podCtx);
      }
    }

    // 4. SEND EMAIL
    if (capturedFiles.length > 0) {
      await sendEmail(capturedFiles, contextPrefix);
    }

  } catch (error) {
    log(`Critical Error: ${error.message}`, "ERROR", contextPrefix);
  } finally {
    await browser.close();
    log("Browser closed.", "INFO", contextPrefix);
  }
}

// Export for use in run-all.js
module.exports = { takeScreenshot, sendEmail };

/**
 * CLI HANDLER
 */
if (require.main === module) {
  const yargs = require("yargs/yargs");
  const { hideBin } = require("yargs/helpers");

  const argv = yargs(hideBin(process.argv))
    .option("project", { alias: "p", type: "string", default: "elx", description: "Project name" })
    .option("env", { alias: "e", type: "string", default: "int", description: "Environment" })
    .option("duration", { alias: "d", type: "string", default: "30d", description: "Time range (e.g. 1h, 7d)" })
    .option("pod", { type: "array", default: [], description: "Pod(s) to isolate" })
    .option("namespace", { alias: "n", type: "string", description: "Kubernetes namespace override" })
    .option("width", { type: "number", default: 1920, description: "Viewport width" })
    .option("height", { type: "number", default: 1200, description: "Viewport height" })
    .option("dashboard", { type: "string", description: "Custom dashboard UID" })
    .option("visible", { type: "boolean", default: false, description: "Run with browser visible" })
    // Email Overrides
    .option("email-user", { type: "string", description: "SMTP User override" })
    .option("email-pass", { type: "string", description: "SMTP Password override" })
    .option("email-to", { type: "string", description: "Recipient(s) override" })
    .help()
    .argv;

  // Apply CLI overrides to process.env for convenience
  if (argv["email-user"]) process.env.EMAIL_USER = argv["email-user"];
  if (argv["email-pass"]) process.env.EMAIL_PASS = argv["email-pass"];
  if (argv["email-to"]) process.env.EMAIL_TO = argv["email-to"];

  // Execute
  takeScreenshot({
    project: argv.project,
    env: argv.env,
    duration: argv.duration,
    pods: argv.pod,
    namespace: argv.namespace,
    viewport: { width: argv.width, height: argv.height },
    dashboardUid: argv.dashboard, // Optional override
    headless: !argv.visible
  });
}