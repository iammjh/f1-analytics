const { spawn } = require("child_process");

const [mode, ...args] = process.argv.slice(2);

const distDirs = {
  dev: ".next-dev",
  build: ".next-build",
  start: ".next-build",
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
