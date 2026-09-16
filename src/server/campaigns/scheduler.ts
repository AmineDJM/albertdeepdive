/** Automation scheduler — implemented in the campaign engine module. */
export async function runAutomationTick(_opts: { triggeredBy: "SCHEDULER" | "MANUAL"; now?: Date }) {
  return { ran: [] as string[], skipped: [] as string[] };
}
