/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@handhistory/engine"],
  webpack: (config) => {
    // @handhistory/engine is consumed from TypeScript source and uses NodeNext-style
    // ".js" specifiers in its own relative imports. Teach webpack that mapping.
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};
module.exports = nextConfig;
