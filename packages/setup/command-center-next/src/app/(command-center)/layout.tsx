import { AppShell } from "@/components/layout/app-shell";

export default function CommandCenterLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <AppShell>{children}</AppShell>;
}
