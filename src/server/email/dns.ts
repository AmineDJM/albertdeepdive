import { promises as nodeDns } from "node:dns";
import type { DnsRecord } from "@/server/db/schema/email";

/**
 * The customer's DNS, from the outside.
 *
 * Two questions, both answered with ordinary lookups: who hosts this zone, so the screen can open
 * the right door for them; and whether the records they were asked to publish are there yet, so
 * the provider is only asked to verify once there is something to verify — asking it too early
 * marks the domain "failed" before the customer has done anything wrong.
 */

export type DnsHost = { name: string; url: string | null };

type HostRule = { test: RegExp; name: string; url?: (root: string) => string };

/** Nameserver patterns, most common first. The URL is the host's DNS editor for that zone. */
const HOSTS: HostRule[] = [
  { test: /\.ns\.cloudflare\.com$/i, name: "Cloudflare", url: (root) => `https://dash.cloudflare.com/?to=/:account/${root}/dns/records` },
  { test: /\.domaincontrol\.com$/i, name: "GoDaddy", url: (root) => `https://dcc.godaddy.com/manage/${root}/dns` },
  { test: /\.(ovh\.net|anycast\.me)$/i, name: "OVHcloud", url: (root) => `https://www.ovh.com/manager/#/web/domain/${root}/zone` },
  { test: /\.gandi\.net$/i, name: "Gandi", url: (root) => `https://admin.gandi.net/domain/${root}/dns/records` },
  { test: /\.registrar-servers\.com$/i, name: "Namecheap", url: (root) => `https://ap.www.namecheap.com/Domains/DomainControlPanel/${root}/advancedns` },
  { test: /awsdns-\d+/i, name: "Amazon Route 53", url: () => "https://console.aws.amazon.com/route53/v2/hostedzones" },
  { test: /\.squarespacedns\.com$/i, name: "Squarespace", url: (root) => `https://account.squarespace.com/domains/managed/${root}/dns/dns-settings` },
  { test: /\.googledomains\.com$/i, name: "Google Domains", url: (root) => `https://domains.google.com/registrar/${root}/dns` },
  { test: /\.ui-dns\.(com|org|de|biz)$/i, name: "IONOS", url: () => "https://my.ionos.com/domains" },
  { test: /\.vercel-dns\.com$/i, name: "Vercel", url: (root) => `https://vercel.com/domains/${root}` },
  { test: /\.digitalocean\.com$/i, name: "DigitalOcean", url: (root) => `https://cloud.digitalocean.com/networking/domains/${root}` },
  { test: /\.hetzner\.(com|de)$/i, name: "Hetzner", url: () => "https://dns.hetzner.com/" },
  { test: /\.infomaniak\.ch$/i, name: "Infomaniak", url: () => "https://manager.infomaniak.com/" },
  { test: /\.online\.net$|\.scaleway\.com$/i, name: "Scaleway" },
  { test: /\.o2switch\.net$/i, name: "o2switch" },
  { test: /\.dnsimple\.com$/i, name: "DNSimple" },
  { test: /\.name\.com$/i, name: "Name.com" },
  { test: /\.hover\.com$/i, name: "Hover" },
  { test: /\.nsone\.net$/i, name: "NS1" },
  { test: /\.wixdns\.net$/i, name: "Wix" },
  { test: /\.porkbun\.com$/i, name: "Porkbun" },
  { test: /\.azure-dns\.(com|net|org|info)$/i, name: "Azure DNS" },
  { test: /\.googledomains\.com$|ns-cloud-[a-z]\d\.googledomains\.com$/i, name: "Google Cloud DNS" },
  { test: /\.netlify\.com$|\.nsone\.net$/i, name: "Netlify" },
];

export function hostFromNameservers(nameservers: string[], root: string): DnsHost | null {
  for (const ns of nameservers.map((name) => name.toLowerCase().replace(/\.$/, ""))) {
    const rule = HOSTS.find((candidate) => candidate.test.test(ns));
    if (rule) return { name: rule.name, url: rule.url ? rule.url(root) : null };
  }
  return null;
}

/** The lookups this module makes, swappable so tests run without a network. */
export type Resolver = {
  resolveNs(name: string): Promise<string[]>;
  resolveTxt(name: string): Promise<string[][]>;
  resolveMx(name: string): Promise<{ exchange: string; priority: number }[]>;
  resolveCname(name: string): Promise<string[]>;
};

let resolver: Resolver = nodeDns;

export function setDnsResolverForTests(next: Resolver | null) {
  resolver = next ?? nodeDns;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("DNS lookup timed out")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/** Who hosts the zone, or null when the nameservers say nothing we recognise. Never throws. */
export async function detectDnsHost(root: string, timeoutMs = 3000): Promise<DnsHost | null> {
  try {
    const nameservers = await withTimeout(resolver.resolveNs(root), timeoutMs);
    return hostFromNameservers(nameservers, root);
  } catch {
    return null;
  }
}

const clean = (value: string) => value.replace(/^"+|"+$/g, "").replace(/\s+/g, " ").trim().toLowerCase();
const host = (value: string) => value.replace(/\.$/, "").toLowerCase();

/** Whether one record the customer was asked for is answering from the DNS yet. Never throws. */
export async function recordPublished(record: DnsRecord, timeoutMs = 3000): Promise<boolean> {
  try {
    switch (record.type.toUpperCase()) {
      case "TXT": {
        const answers = await withTimeout(resolver.resolveTxt(record.fqdn), timeoutMs);
        const wanted = clean(record.value);
        return answers.some((chunks) => clean(chunks.join("")) === wanted);
      }
      case "MX": {
        const answers = await withTimeout(resolver.resolveMx(record.fqdn), timeoutMs);
        return answers.some((answer) => host(answer.exchange) === host(record.value));
      }
      case "CNAME": {
        const answers = await withTimeout(resolver.resolveCname(record.fqdn), timeoutMs);
        return answers.some((answer) => host(answer) === host(record.value));
      }
      default:
        // CAA and anything else is optional to the provider; not knowing must not hold a customer up.
        return true;
    }
  } catch {
    return false;
  }
}

/* ── Domain Connect ───────────────────────────────────────────────────────────────────────── */

export type DomainConnectSettings = { providerId: string; providerName?: string; urlSyncUX?: string; urlAPI: string };

/**
 * Whether the zone's host speaks Domain Connect: a TXT record at _domainconnect.<root> names the
 * host's API, and the API's settings say where its one-click screen lives.
 */
export async function domainConnectSettings(root: string, timeoutMs = 4000): Promise<DomainConnectSettings | null> {
  try {
    const answers = await withTimeout(resolver.resolveTxt(`_domainconnect.${root}`), timeoutMs);
    const urlAPI = answers.map((chunks) => chunks.join("").trim()).find(Boolean);
    if (!urlAPI) return null;
    const res = await fetch(`https://${urlAPI.replace(/^https?:\/\//, "").replace(/\/$/, "")}/v2/${root}/settings`, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: "application/json" } });
    if (!res.ok) return null;
    const settings = (await res.json()) as { providerId?: string; providerName?: string; urlSyncUX?: string; urlAPI?: string };
    if (!settings.providerId) return null;
    return { providerId: settings.providerId, providerName: settings.providerName, urlSyncUX: settings.urlSyncUX, urlAPI: settings.urlAPI ?? urlAPI };
  } catch {
    return null;
  }
}

/**
 * The one-click link, when the host supports Briefly's Domain Connect template.
 *
 * The template is Briefly's to publish with the DNS hosts, and until it is, this returns null and
 * the screen shows the records instead. Once it is, the link carries every value the template
 * needs and the host's own screen publishes them with one confirmation.
 */
export async function domainConnectApplyUrl(input: { root: string; host: string; variables: Record<string, string>; template: { providerId: string; serviceId: string }; settings?: DomainConnectSettings | null; timeoutMs?: number }): Promise<string | null> {
  const settings = input.settings === undefined ? await domainConnectSettings(input.root, input.timeoutMs) : input.settings;
  if (!settings?.urlSyncUX) return null;
  try {
    const api = settings.urlAPI.replace(/^https?:\/\//, "").replace(/\/$/, "");
    const supported = await fetch(`https://${api}/v2/domainTemplates/providers/${encodeURIComponent(input.template.providerId)}/services/${encodeURIComponent(input.template.serviceId)}`, { method: "GET", signal: AbortSignal.timeout(input.timeoutMs ?? 4000) });
    if (!supported.ok) return null;
  } catch {
    return null;
  }
  const params = new URLSearchParams({ domain: input.root, host: input.host, ...input.variables });
  return `${settings.urlSyncUX.replace(/\/$/, "")}/v2/domainTemplates/providers/${encodeURIComponent(input.template.providerId)}/services/${encodeURIComponent(input.template.serviceId)}/apply?${params.toString()}`;
}
