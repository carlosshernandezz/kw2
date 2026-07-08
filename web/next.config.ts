import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: [
    '127.0.0.1',
    'localhost',
    '192.168.68.54',
    '192.168.68.61',
  ],
};

export default nextConfig;
