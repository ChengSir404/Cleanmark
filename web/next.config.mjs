/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  assetPrefix: "/static",
  images: {
    unoptimized: true,
  },
};

export default nextConfig;

