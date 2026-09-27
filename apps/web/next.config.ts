import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The shared package ships TypeScript source rather than a build artefact, so Next has to
  // compile it along with the app.
  transpilePackages: ["@lantern/shared", "@lantern/capability"],
  // Next writes its own AGENTS.md and CLAUDE.md into this directory on every dev run. The
  // repository's guidance lives at the root, so the generated pair only dirties the tree.
  agentRules: false,
};

export default nextConfig;
