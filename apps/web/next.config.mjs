/** @type {import('next').NextConfig} */

// /v1/* is proxied to the API by src/middleware.ts, which reads API_ORIGIN at request time.
const nextConfig = {
  reactStrictMode: true,
};

export default nextConfig;
