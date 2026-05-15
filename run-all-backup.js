const { takeScreenshot } = require("./grafana");
const fs = require("fs");
const path = require("path");
const yargs = require("yargs/yargs");
const { hideBin } = require("yargs/helpers");

/**
 * LOAD TARGETS
 * Attempts to load from targets.json, falls back to a default list.
 */
let targets = [
  { project: "elx", env: "uat" }
];

const targetsPath = path.join(__dirname, "targets.json");
if (fs.existsSync(targetsPath)) {
  try {
    targets = JSON.parse(fs.readFileSync(targetsPath, "utf8"));
    console.log(`Loaded ${targets.length} targets from targets.json`);
  } catch (e) {
    console.error("Error parsing targets.json, using defaults.");
  }
}

/**
 * CLI ARGUMENTS
 */
const argv = yargs(hideBin(process.argv))
  .option("duration", {
    alias: "d",
    type: "string",
    description: "Global time range (e.g., 7d, 24h)",
    default: "30d"
  })
  .option("pod", {
    type: "array",
    description: "Global pod name(s) to isolate",
    default: []
  })
  .help()
  .argv;

const globalTimeRange = argv.duration;
const globalPods = argv.pod;

/**
 * EXECUTION LOOP
 */
(async () => {
  console.log(`\n🚀 Starting automated screenshots for ${targets.length} environments...`);
  console.log(`📅 Global Time Range: ${globalTimeRange}`);
  if (globalPods.length > 0) console.log(`🔍 Global Pods: ${globalPods.join(", ")}`);

  console.time("Total execution time");

  for (const target of targets) {
    try {
      const timeRange = target.timeRange || globalTimeRange;
      const pods = target.pods || globalPods;

      console.log(`\n--- 🏗️  Processing: ${target.project}-${target.env} ---`);

      await takeScreenshot({
        project: target.project,
        env: target.env,
        duration: timeRange,
        pods: pods,
        namespace: target.namespace
      });

    } catch (err) {
      console.error(`❌ Failed to process ${target.project}-${target.env}:`, err.message);
    }
  }

  console.log("\n✅ All tasks completed!");
  console.timeEnd("Total execution time");
})();
