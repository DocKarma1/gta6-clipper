import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@gta6-clipper/shared", "@gta6-clipper/twitch"],
  serverExternalPackages: ["pino"],
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "static-cdn.jtvnw.net",
        pathname: "/previews-ttv/**",
      },
    ],
  },
};

export default nextConfig;
