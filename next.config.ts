import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["libsodium-wrappers", "libsodium"],
};

export default nextConfig;
