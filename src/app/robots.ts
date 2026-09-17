import type { MetadataRoute } from "next";
import { env } from "@/server/env";

/**
 * What crawlers may read.
 *
 * The landing page, subscribe pages and published web editions are meant to be found. Everything
 * else is somebody's newsroom, somebody's mailbox, or a link sent to one reader — a confirmation or
 * unsubscribe URL indexed by a search engine would be both useless and a small betrayal.
 */
export default function robots(): MetadataRoute.Robots {
  const base = env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/s/", "/r/"],
        disallow: ["/api/", "/overview", "/editions", "/publications", "/subscribers", "/contributors", "/directory", "/campuses", "/settings", "/onboarding", "/login", "/print/", "/contribute/", "/respond/", "/s/confirm/", "/s/unsubscribe/"],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
