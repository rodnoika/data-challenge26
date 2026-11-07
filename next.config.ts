import type { NextConfig } from "next";

// STATIC_EXPORT=1 builds the UI as a static bundle (for a future Dynamics 365 web resource).
// In that mode the API must be hosted separately and NEXT_PUBLIC_API_BASE must point to it.
const isStatic = process.env.STATIC_EXPORT === "1";

const config: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  ...(isStatic
    ? { output: "export", images: { unoptimized: true }, trailingSlash: true }
    : {}),
};

export default config;
