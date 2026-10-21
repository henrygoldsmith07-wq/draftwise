import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site";

/**
 * The deployed site's robots.txt.
 *
 * The app was previously served with no robots.txt at all, which is not the
 * same as a permissive one: a crawler with no directives will happily index
 * whatever it finds, including the empty application shell. This states the
 * intent explicitly — the home page is welcome, and there is nothing else
 * public to walk.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
    },
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
