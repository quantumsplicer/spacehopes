import StudioShell from "@/components/studio/StudioShell";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <StudioShell>{children}</StudioShell>;
}
