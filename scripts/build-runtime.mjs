/* global process */
import { mkdir, rm } from "node:fs/promises";
import { build } from "esbuild";

const target = process.argv[2] ?? "all";
if (!["all", "daemon", "analyst"].includes(target)) {
  throw new Error(`runtime target must be all, daemon, or analyst; received ${target}`);
}
const builds = [];

const common = {
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  sourcemap: false,
  minify: false,
  legalComments: "none",
  tsconfig: "tsconfig.base.json",
};

if (target === "all" || target === "daemon") {
  const output = "apps/daemon/dist";
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  builds.push(build({
    ...common,
    entryPoints: ["apps/daemon/src/main.ts"],
    outfile: `${output}/main.mjs`,
    external: ["@coral-xyz/anchor", "@solana/web3.js", "tweetnacl"],
  }));
}
if (target === "all" || target === "analyst") {
  const output = "apps/analyst/dist";
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  builds.push(build({
    ...common,
    entryPoints: ["apps/analyst/src/serverCli.ts"],
    outfile: `${output}/server.mjs`,
    // AI SDK's optional Vercel OIDC dependency still contains CommonJS requires. Keep the
    // standalone artifact ESM while giving esbuild's compatibility shim a real Node require.
    banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  }));
}
await Promise.all(builds);
