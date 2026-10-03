/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: true,
  eslint: { ignoreDuringBuilds: true },
  // The API is reached through Caddy in the browser; this keeps `next dev` working without it.
  async rewrites() {
    const api = process.env.INTERNAL_API_URL || "http://api:8000";
    return [{ source: "/api/:path*", destination: `${api}/api/:path*` }];
  },
};
export default nextConfig;
