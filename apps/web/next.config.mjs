/** @type {import('next').NextConfig} */

// The backend contract lives under /v1 (01-SPEC-v3.md section 7). Proxying it
// through the Next server keeps the browser on one origin, so the HttpOnly
// refresh cookie (Path=/v1/auth) is first party and no CORS is needed.
const API_ORIGIN = process.env.API_ORIGIN ?? 'http://localhost:3001';

const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [{ source: '/v1/:path*', destination: `${API_ORIGIN}/v1/:path*` }];
  },
};

export default nextConfig;
