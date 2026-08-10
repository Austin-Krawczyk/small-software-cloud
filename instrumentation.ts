// Runs once on server start (Next.js instrumentation hook):
// initializes data dirs, recovers orphaned state, starts the idle reaper.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initPlatform } = await import("./lib/deploy");
    initPlatform();
  }
}
