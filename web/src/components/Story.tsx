import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { STORIES, type Story as StoryT } from "../stories";

type StoryCtx = { enabled: boolean; toggle: () => void; set: (v: boolean) => void };
const Ctx = createContext<StoryCtx>({ enabled: true, toggle: () => {}, set: () => {} });

const KEY = "pocpilot.storymode";

export function StoryProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabled] = useState<boolean>(() => {
    const v = typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null;
    return v === null ? true : v === "1";
  });
  useEffect(() => {
    try {
      localStorage.setItem(KEY, enabled ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [enabled]);
  return (
    <Ctx.Provider value={{ enabled, toggle: () => setEnabled((v) => !v), set: setEnabled }}>
      {children}
    </Ctx.Provider>
  );
}

export function useStory() {
  return useContext(Ctx);
}

type Side = "top" | "bottom" | "left" | "right";

function Tooltip({
  content,
  children,
  side = "top",
  width = 270,
}: {
  content: ReactNode;
  children: ReactNode;
  side?: Side;
  width?: number;
}) {
  const place =
    side === "top"
      ? "bottom-full mb-2 left-1/2 -translate-x-1/2"
      : side === "bottom"
        ? "top-full mt-2 left-1/2 -translate-x-1/2"
        : side === "right"
          ? "left-full ml-2 top-1/2 -translate-y-1/2"
          : "right-full mr-2 top-1/2 -translate-y-1/2";
  return (
    <span className="group/tip relative inline-flex">
      {children}
      <span
        role="tooltip"
        className={`pointer-events-none absolute z-50 ${place} translate-y-1 opacity-0 transition duration-150 group-hover/tip:translate-y-0 group-hover/tip:opacity-100`}
        style={{ width }}
      >
        <span className="pop-sm block bg-white p-3 text-left shadow-[4px_4px_0_0_#151515]">
          {content}
        </span>
      </span>
    </span>
  );
}

function personaColor(p: StoryT["persona"]): { bg: string; fg: string } {
  return p === "Operator"
    ? { bg: "var(--color-brand)", fg: "#fff" }
    : { bg: "var(--color-berry)", fg: "#fff" };
}

function StoryCard({ story }: { story: StoryT }) {
  const c = personaColor(story.persona);
  return (
    <span className="block">
      <span className="mb-1.5 flex items-center gap-2">
        <span
          className="mono rounded-full border-[1.5px] border-[var(--color-line)] px-1.5 py-px text-[0.6rem] font-extrabold"
          style={{ background: c.bg, color: c.fg }}
        >
          {story.id}
        </span>
        <span className="text-[0.6rem] font-extrabold uppercase tracking-wider text-[var(--color-muted)]">
          {story.persona} story
        </span>
      </span>
      <span className="mb-1 block text-[0.82rem] font-extrabold leading-tight text-[var(--color-ink)]">
        {story.title}
      </span>
      <span className="block text-[0.74rem] leading-relaxed text-[var(--color-ink-soft)]">
        {story.text}
      </span>
    </span>
  );
}

/**
 * Story annotation. Two forms:
 *   <Story id="US-O1" />              → a standalone badge with the story tooltip
 *   <Story id="US-O9">{children}</Story> → wraps children; hovering them shows the story
 * Renders nothing extra (children pass through) when Story mode is off.
 */
export function Story({
  id,
  children,
  side = "top",
  className = "",
}: {
  id: string;
  children?: ReactNode;
  side?: Side;
  className?: string;
}) {
  const { enabled } = useStory();
  const story = STORIES[id];
  if (!enabled || !story) return <>{children}</>;
  const c = personaColor(story.persona);

  const badge = (
    <span
      className={`mono inline-flex cursor-help select-none items-center rounded-full border-[1.5px] border-[var(--color-line)] px-1.5 py-px text-[0.58rem] font-extrabold leading-none ${className}`}
      style={{ background: c.bg, color: c.fg }}
    >
      {story.id.replace("US-", "")}
    </span>
  );

  if (!children) {
    return (
      <Tooltip side={side} content={<StoryCard story={story} />}>
        {badge}
      </Tooltip>
    );
  }

  return (
    <Tooltip side={side} content={<StoryCard story={story} />}>
      <span className="inline-flex items-center gap-1.5">
        {children}
        {badge}
      </span>
    </Tooltip>
  );
}

/** A single index chip: a link to where the story lives, with a hover tooltip. */
function IndexChip({ id }: { id: string }) {
  const story = STORIES[id];
  if (!story) return null;
  const c = personaColor(story.persona);
  const content = (
    <span className="block">
      <StoryCard story={story} />
      <span className="mt-2 flex items-center gap-1 border-t border-[var(--color-hairline)] pt-2 text-[0.66rem] font-extrabold text-[var(--color-brand)]">
        Open {story.routeLabel} <span aria-hidden>→</span>
      </span>
    </span>
  );
  return (
    <Tooltip side="right" content={content}>
      <Link
        to={story.route}
        title={`${story.id} — open ${story.routeLabel}`}
        className="mono flex h-5 min-w-[26px] items-center justify-center rounded-md border-[1.5px] border-[var(--color-line)] px-1 text-[0.6rem] font-extrabold leading-none transition hover:-translate-y-0.5 hover:shadow-[2px_2px_0_0_#151515]"
        style={{ background: c.bg, color: c.fg }}
      >
        {story.id.replace("US-", "")}
      </Link>
    </Tooltip>
  );
}

/** Legend of every user story, grouped by persona. Hover any index to read it. */
export function StoryIndex() {
  const all = Object.values(STORIES);
  const operator = all.filter((s) => s.persona === "Operator");
  const customer = all.filter((s) => s.persona === "Customer");
  return (
    <div className="pop-sm p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[0.62rem] font-extrabold uppercase tracking-wider text-[var(--color-muted)]">
          Story index
        </span>
        <span
          className="chip"
          style={{ background: "var(--color-cream)", padding: "1px 7px", fontSize: "0.6rem" }}
        >
          {all.length}
        </span>
      </div>

      <div className="mb-1 flex items-center gap-1.5">
        <span
          className="h-2 w-2 rounded-full border border-[var(--color-line)]"
          style={{ background: "var(--color-brand)" }}
        />
        <span className="text-[0.58rem] font-extrabold uppercase tracking-wide text-[var(--color-muted)]">
          Operator
        </span>
      </div>
      <div className="mb-2.5 flex flex-wrap gap-1">
        {operator.map((s) => (
          <IndexChip key={s.id} id={s.id} />
        ))}
      </div>

      <div className="mb-1 flex items-center gap-1.5">
        <span
          className="h-2 w-2 rounded-full border border-[var(--color-line)]"
          style={{ background: "var(--color-berry)" }}
        />
        <span className="text-[0.58rem] font-extrabold uppercase tracking-wide text-[var(--color-muted)]">
          Customer
        </span>
      </div>
      <div className="flex flex-wrap gap-1">
        {customer.map((s) => (
          <IndexChip key={s.id} id={s.id} />
        ))}
      </div>
    </div>
  );
}

export function StoryModeToggle() {
  const { enabled, toggle } = useStory();
  return (
    <button
      onClick={toggle}
      aria-pressed={enabled}
      title="Show user-story tooltips on hover"
      className="pop-sm flex w-full items-center gap-2 px-3 py-2 text-xs font-extrabold transition hover:-translate-y-0.5"
    >
      <span
        className="relative inline-flex h-4 w-7 items-center rounded-full border-2 border-[var(--color-line)] transition"
        style={{ background: enabled ? "var(--color-brand)" : "#fff" }}
      >
        <span
          className="absolute h-2.5 w-2.5 rounded-full border border-[var(--color-line)] bg-white transition-all"
          style={{ left: enabled ? "13px" : "2px" }}
        />
      </span>
      Story mode
      <span className="ml-auto text-[0.65rem] text-[var(--color-muted)]">
        {enabled ? "on" : "off"}
      </span>
    </button>
  );
}
