import { AppHeader } from "@/components/layout/app-header";

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  return (
    <div className="cc-shell">
      <AppHeader />
      <main className="cc-main">{children}</main>
    </div>
  );
}
