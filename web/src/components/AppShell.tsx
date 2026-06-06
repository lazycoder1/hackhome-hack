import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { Logo, Dot } from "./ui";
import { StoryIndex, StoryModeToggle } from "./Story";
import { api } from "../api";

const NAV = [
  { to: "/", label: "Pipeline", icon: "▤", end: true },
  { to: "/approvals", label: "Approvals", icon: "✓", end: false },
  { to: "/intake", label: "New PoC", icon: "+", end: false },
  { to: "/settings", label: "Settings", icon: "⚙", end: false },
];

export function AppShell() {
  const navigate = useNavigate();
  const [online, setOnline] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    const ping = () =>
      api
        .health()
        .then(() => active && setOnline(true))
        .catch(() => active && setOnline(false));
    ping();
    const t = setInterval(ping, 8000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, []);

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r-2 border-[var(--color-line)] bg-[var(--color-cream)] px-4 py-5 md:flex">
        <button onClick={() => navigate("/")} className="mb-8 flex items-center text-left">
          <Logo />
        </button>
        <nav className="flex flex-col gap-1.5">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-[10px] border-2 px-3 py-2.5 text-sm font-bold transition ${
                  isActive
                    ? "border-[var(--color-line)] bg-[var(--color-ink)] text-white shadow-[2px_2px_0_0_#151515]"
                    : "border-transparent text-[var(--color-ink-soft)] hover:border-[var(--color-line)] hover:bg-white"
                }`
              }
            >
              <span className="mono w-4 text-center">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="mt-auto space-y-3">
          <StoryIndex />
          <StoryModeToggle />
          <div className="pop-sm flex items-center gap-2 px-3 py-2 text-xs font-bold">
            <Dot
              color={online ? "var(--color-grass)" : "var(--color-fail)"}
              live={Boolean(online)}
            />
            {online === null ? "Connecting…" : online ? "Backend online" : "Backend offline"}
          </div>
          <p className="px-1 text-[0.68rem] leading-snug text-[var(--color-muted)]">
            Hover the <span className="mono font-bold text-[var(--color-brand)]">O1</span>-style
            badges to read the user story each part satisfies.
          </p>
        </div>
      </aside>

      <main className="min-w-0 flex-1">
        <Outlet />
      </main>
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 border-b-2 border-[var(--color-line)] bg-[var(--color-cream)] px-6 py-5 md:px-8">
      <div>
        <h1 className="text-2xl font-extrabold md:text-3xl">{title}</h1>
        {subtitle && (
          <p className="mt-1 text-sm font-medium text-[var(--color-muted)]">{subtitle}</p>
        )}
      </div>
      {right}
    </header>
  );
}
