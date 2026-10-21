import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site";

/**
 * The deployed site's sitemap.
 *
 * One public URL: the writing workspace. Drafts live in the writer's own
 * browser and are never part of the site, so nothing else belongs here.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: siteUrl(),
      changeFrequency: "weekly",
      priority: 1,
    },
  ];
}
