import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
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
