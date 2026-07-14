import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Each Git worktree runs with its own source and build output. Pin the tracing
  // root so Next does not infer the parent workspace when multiple lockfiles exist.
  outputFileTracingRoot: __dirname,
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "i.ibb.co",
      },
    ],
  },
  webpack(config) {
    config.resolveLoader = config.resolveLoader || {};
    config.resolveLoader.modules = [
      path.join(__dirname, "node_modules", "next", "dist", "build", "webpack", "loaders"),
      "node_modules",
      ...(config.resolveLoader.modules || []),
    ];
    return config;
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          {
            key: "Content-Security-Policy",
            value: "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://i.ibb.co; font-src 'self' data:; connect-src 'self' https://*.supabase.co wss://*.supabase.co",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
