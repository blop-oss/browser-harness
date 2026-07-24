import { launchOptions } from "camoufox-js";

const options = await launchOptions({
  headless: true,
  humanize: false,
  enable_cache: true,
  os: "linux",
  exclude_addons: ["UBO"],
  disable_coop: true,
});

// Browser launch environment is generated inside the isolated container, so
// application credentials can never leak into the Playwright transport header.
const allowedEnvironment = new Set([
  "DISPLAY",
  "FONTCONFIG_PATH",
  "HOME",
  "LANG",
  "LC_ALL",
  "LD_LIBRARY_PATH",
  "PATH",
]);
options.env = Object.fromEntries(
  Object.entries(options.env ?? {}).filter(([key]) =>
    key.startsWith("CAMOU_CONFIG_") || allowedEnvironment.has(key)),
);

process.stdout.write(JSON.stringify(options));
