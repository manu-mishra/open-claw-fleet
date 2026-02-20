"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

const NAV_ITEMS = [
  { href: "/tasks", label: "Dashboard" },
  { href: "/performance", label: "Performance" },
  { href: "/agents", label: "Agents" },
  { href: "/activities", label: "Activities" },
];

function normalizePathname(pathname: string): string {
  if (!pathname || pathname === "/") {
    return "/tasks";
  }
  return pathname.replace(/\/+$/, "") || "/tasks";
}

interface DashboardAgent {
  matrixId: string;
  name?: string;
  title?: string;
  status?: string;
}

interface DashboardIdentityPayload {
  currentUser?: string;
  agents?: DashboardAgent[];
}

function defaultPersonaName(matrixId: string): string {
  const local = matrixId.split(":")[0] ?? "";
  if (!local.startsWith("@")) {
    return "Operator";
  }
  return local.slice(1);
}

export function AppHeader() {
  const pathname = normalizePathname(usePathname() ?? "/tasks");
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [currentUser, setCurrentUser] = useState("@unknown:anycompany.corp");
  const [currentName, setCurrentName] = useState("Operator");
  const [currentTitle, setCurrentTitle] = useState("Command Center");
  const [copyState, setCopyState] = useState<"idle" | "copied">("idle");

  useEffect(() => {
    let active = true;

    async function loadIdentity(): Promise<void> {
      try {
        const response = await fetch("/api/command-center/dashboard", {
          method: "GET",
          cache: "no-store",
        });
        if (!response.ok || !active) {
          return;
        }

        const payload = (await response.json()) as DashboardIdentityPayload;
        const fallbackMatrixId = typeof payload.currentUser === "string" && payload.currentUser.trim().length > 0
          ? payload.currentUser.trim()
          : "@unknown:anycompany.corp";

        const agents = Array.isArray(payload.agents) ? payload.agents : [];
        let matrixId = fallbackMatrixId;
        if (matrixId.startsWith("@task.assignments")) {
          const preferred =
            agents.find((entry) => entry.title?.toLowerCase() === "ceo")
            || agents.find((entry) => entry.status === "idle" || entry.status === "working")
            || agents[0];
          if (preferred?.matrixId) {
            matrixId = preferred.matrixId;
          }
        }

        const agent = agents.find((entry) => entry.matrixId === matrixId);

        setCurrentUser(matrixId);
        setCurrentName(agent?.name?.trim() || defaultPersonaName(matrixId));
        setCurrentTitle(agent?.title?.trim() || "Command Center");
      } catch {
        // keep defaults
      }
    }

    void loadIdentity();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    function onDocumentClick(event: MouseEvent): void {
      if (!menuRef.current) {
        return;
      }
      if (menuRef.current.contains(event.target as Node)) {
        return;
      }
      setMenuOpen(false);
    }

    function onEscape(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", onDocumentClick);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onDocumentClick);
      document.removeEventListener("keydown", onEscape);
    };
  }, []);

  const initials = useMemo(() => {
    const words = currentName.split(/\s+/).filter((entry) => entry.length > 0).slice(0, 2);
    if (!words.length) {
      return "OC";
    }
    return words.map((entry) => entry[0]?.toUpperCase() ?? "").join("");
  }, [currentName]);

  async function copyMatrixId(): Promise<void> {
    try {
      await navigator.clipboard.writeText(currentUser);
      setCopyState("copied");
      setTimeout(() => setCopyState("idle"), 1300);
    } catch {
      setCopyState("idle");
    }
  }

  return (
    <header className="cc-topbar">
      <div className="cc-brand">
        <img src="/icon.svg" alt="" className="cc-brand-logo" />
        <div>
          <h1>Open Claw Command Center</h1>
        </div>
      </div>

      <nav className="cc-nav" aria-label="Primary">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={active ? "cc-nav-link is-active" : "cc-nav-link"}
              aria-current={active ? "page" : undefined}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className={menuOpen ? "cc-user-menu is-open" : "cc-user-menu"} ref={menuRef}>
        <button
          type="button"
          className="cc-user-trigger"
          onClick={() => setMenuOpen((open) => !open)}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
        >
          <span className="cc-user-avatar">{initials}</span>
          <span className="cc-user-summary">
            <strong>{currentName}</strong>
            <small>{currentTitle}</small>
          </span>
        </button>

        {menuOpen ? (
          <div className="cc-user-popover" role="menu" aria-label="User menu">
            <p className="cc-user-popover-id">{currentUser}</p>
            <div className="cc-user-popover-actions">
              <button type="button" className="cc-button is-secondary" onClick={copyMatrixId}>
                {copyState === "copied" ? "Copied" : "Copy Matrix ID"}
              </button>
              <Link href="/agents" className="cc-button is-secondary" onClick={() => setMenuOpen(false)}>
                Agent Directory
              </Link>
            </div>
          </div>
        ) : null}
      </div>
    </header>
  );
}
