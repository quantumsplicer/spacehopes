import { getSettings } from "@/lib/api";
import Header from "@/components/site/Header";
import Footer from "@/components/site/Footer";
import { SiteProvider } from "@/components/site/SiteProvider";

export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const settings = await getSettings();
  return (
    <SiteProvider settings={settings}>
      <Header />
      <main id="main">{children}</main>
      <Footer settings={settings} />
    </SiteProvider>
  );
}
