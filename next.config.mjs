/** @type {import('next').NextConfig} */
const nextConfig = {
  // The deploy engine and app registry live in these server-only modules;
  // keep them external so Next doesn't try to bundle node:sqlite.
  serverExternalPackages: ["adm-zip", "nodemailer"],
};

export default nextConfig;
