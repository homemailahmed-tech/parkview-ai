import type { MetadataRoute } from "next";

/** Private demo: ask all crawlers to stay away. */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", disallow: "/" } };
}
