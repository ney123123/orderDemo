import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The state templates are read from disk at runtime (src/lib/prompts/loadStateTemplates.ts), which
  // file tracing can't see; serverless hosts such as Vercel ship only traced files.
  outputFileTracingIncludes: {
    "/*": ["./prompts/states/**/*.md"],
    "/**/*": ["./prompts/states/**/*.md"],
  },
};

export default nextConfig;
