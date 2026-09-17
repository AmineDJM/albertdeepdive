/**
 * Calls the automation tick on the running web service. Used by the scheduled job: it keeps the
 * work inside the service that already has the database, the storage disk and Chromium, rather
 * than building a second copy of the world in the cron container.
 */
/**
 * Render's blueprint can pass a service's host but not its full URL, so accept either and add
 * the scheme when it is missing.
 */
function baseUrl(): string {
  const raw = process.env.APP_URL || process.env.APP_HOST || process.env.RENDER_EXTERNAL_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const value = raw.trim().replace(/\/$/, "");
  return /^https?:\/\//.test(value) ? value : `https://${value}`;
}

const url = baseUrl();
const token = process.env.AUTOMATION_TICK_TOKEN;

async function main() {
  if (!token) throw new Error("AUTOMATION_TICK_TOKEN is not set");
  const response = await fetch(`${url}/api/automations/tick`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Tick failed (${response.status}): ${JSON.stringify(body)}`);
  console.log(`[tick] ran ${body.ran?.length ?? 0}, skipped ${body.skipped?.length ?? 0}, errors ${body.errors?.length ?? 0}`);
  for (const line of body.ran ?? []) console.log(`  ran     ${line}`);
  for (const line of body.errors ?? []) console.error(`  error   ${line}`);
  if ((body.errors?.length ?? 0) > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("[tick]", err instanceof Error ? err.message : err);
  process.exit(1);
});
