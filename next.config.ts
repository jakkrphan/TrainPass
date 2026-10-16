import type { NextConfig } from "next";

const devAllowedOrigins = process.env.DEV_ALLOWED_ORIGINS?.split(",").map((host) => host.trim()).filter(Boolean);

// Sub-path the app is served under, e.g. "/trainpass" (unset = domain root). Build-time only: changing it needs a rebuild.
const basePath = (process.env.BASE_PATH ?? "").trim().replace(/\/+$/, "").replace(/^(?=[^/])/, "/");

const nextConfig: NextConfig = {
  basePath,
  // Inlines the normalized value for src/lib/base-path.ts (client and server bundles alike).
  env: { BASE_PATH: basePath },
  // Produce a minimal Node.js server image for Coolify and other Docker hosts.
  output: "standalone",
  // Loaded by Node at runtime instead of bundled, as in portalrpp (it opens raw TCP/TLS sockets).
  serverExternalPackages: ["ldapts"],
  // Dev only: lets other machines on the LAN open `next dev` by IP (comma-separated hostnames, no scheme or port).
  // Unset = localhost only. Has no effect on `next start`.
  allowedDevOrigins: devAllowedOrigins,
  experimental: {
    // No `allowedOrigins`: it also applies under `next start` (would widen the CSRF allow-list in production) and a
    // tunnel like ngrok forwards its own Host, so Next's same-origin check already passes there.
    serverActions: { bodySizeLimit: "6mb" },
    // Enables forbidden() / forbidden.tsx for a real 403 on admin-only pages.
    authInterrupts: true,
  },
  async headers() {
    const production = process.env.NODE_ENV === "production";
    return [{
      source: "/:path*",
      headers: [
        { key: "Content-Security-Policy", value: [
          "default-src 'self'",
          "base-uri 'self'",
          "object-src 'none'",
          "frame-ancestors 'none'",
          "form-action 'self'",
          "script-src 'self' 'unsafe-inline'" + (production ? "" : " 'unsafe-eval'"),
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data: blob:",
          "font-src 'self' data:",
          "connect-src 'self'",
        ].join("; ") },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=()" },
        ...(production ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }] : []),
      ],
    }];
  },
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
