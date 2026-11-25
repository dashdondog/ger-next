import { networkInterfaces } from "node:os";
import { fileURLToPath } from "node:url";

// this computer's addresses on the local network (Wi-Fi, a phone's hotspot), so a phone can open
// the dev server at http://<address>:3000 — Next.js blocks other origins in development otherwise
const lanAddresses = Object.values(networkInterfaces())
  .flat()
  .filter((a) => a && a.family === "IPv4" && !a.internal)
  .map((a) => a.address);

/** @type {import('next').NextConfig} */
const nextConfig = {
  // a package-lock.json higher up in the home folder would otherwise be taken as the root
  turbopack: { root: fileURLToPath(new URL(".", import.meta.url)) },
  allowedDevOrigins: lanAddresses,
};

export default nextConfig;
