const { takeScreenshot } = require("./grafana");

// Define all the environments you want to capture here
const targets = [
  { project: "elx", env: "uat" },
  { project: "ebl", env: "uat" },
  { project: "hel", env: "uat" },
  { project: "tr", env: "uat" },
  { project: "elec", env: "uat" },
  { project: "pvi", env: "uat" },
  // Add more here easily:
  // { project: "another-proj", env: "prod" },
];

// Get the global time range and pods from the command line
const yargs = require("yargs/yargs");
const { hideBin } = require("yargs/helpers");

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


(async () => {
  console.log(`Starting automated screenshots for ${targets.length} environments...`);
  console.log(`Global Time Range: ${globalTimeRange}`);
  console.time("Total execution time");

  // Run screenshots sequentially to avoid resource exhaustion and timeouts
  for (const target of targets) {
    try {
      // Use specific values if defined in the target, otherwise use global ones
      const timeRange = target.timeRange || globalTimeRange;
      const pods = target.pods || globalPods;

      console.log(`\n--- Processing Environment: ${target.project}-${target.env} ---`);
      await takeScreenshot(target.project, target.env, timeRange, pods);
    } catch (err) {
      console.error(`Failed to process ${target.project}-${target.env}:`, err.message);
    }
  }

  console.log("\nAll tasks completed!");
  console.timeEnd("Total execution time");
})();

