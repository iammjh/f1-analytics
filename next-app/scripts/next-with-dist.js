const { spawn } = require("child_process");

const [mode, ...args] = process.argv.slice(2);

// Vercel's Next.js integration only recognizes the default ".next" output folder.
const onVercel = Boolean(process.env.VERCEL);

const distDirs = {
  dev: ".next-dev",
  build: onVercel ? ".next" : ".next-build",
  start: onVercel ? ".next" : ".next-build",
};

if (!mode) {
  console.error("Usage: node scripts/next-with-dist.js <dev|build|start> [...args]");
  process.exit(1);
}

const distDir = process.env.NEXT_DIST_DIR || distDirs[mode] || ".next";
const nextBin = require.resolve("next/dist/bin/next");

const child = spawn(process.execPath, [nextBin, mode, ...args], {
  stdio: "inherit",
  env: {
    ...process.env,
    NEXT_DIST_DIR: distDir,
  },
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});
