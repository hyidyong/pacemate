import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Each Git worktree runs with its own source and build output. Pin the tracing
  // root so Next does not infer the parent workspace when multiple lockfiles exist.
  distDir: ".next-personalized-roadmap",
  outputFileTracingRoot: __dirname,
  webpack(config) {
    config.resolveLoader = config.resolveLoader || {};
    config.resolveLoader.modules = [
      path.join(__dirname, "node_modules", "next", "dist", "build", "webpack", "loaders"),
      "node_modules",
      ...(config.resolveLoader.modules || []),
    ];
    return config;
  },
};

export default nextConfig;
