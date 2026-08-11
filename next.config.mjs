/** @type {import('next').NextConfig} */
const nextConfig = {
  // The deploy engine and app registry live in these server-only modules;
  // keep them external so Next doesn't try to bundle node:sqlite.
  serverExternalPackages: ["adm-zip", "nodemailer"],
  // `npm run build:check` writes to a throwaway dir so a compile check never
  // clobbers the `.next` a running `next dev` is using. Prod build/start use `.next`.
  distDir: process.env.SCLOUD_BUILD_CHECK ? ".next-check" : ".next",
};

export default nextConfig;
