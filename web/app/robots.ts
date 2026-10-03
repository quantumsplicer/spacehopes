import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const base = process.env.PUBLIC_URL || "http://localhost:8080";
  return { rules: [{ userAgent: "*", allow: "/", disallow: ["/studio", "/api/"] }], sitemap: `${base}/sitemap.xml` };
}
