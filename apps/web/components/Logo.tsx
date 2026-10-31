/** The AskYoda mark: a lens over a step line — looking closely at what the agent did. */
export default function Logo({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden fill="none">
      <rect x="0.5" y="0.5" width="31" height="31" rx="9" className="fill-ink-850 stroke-ink-600" />
      <path
        d="M7 21.5h4.5l3-7 3.5 9 2.5-5H25"
        className="stroke-ink-400"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="18" cy="18.5" r="2.6" className="fill-moss-400" />
    </svg>
  );
}
