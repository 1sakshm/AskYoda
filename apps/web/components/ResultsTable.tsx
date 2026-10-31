import Link from "next/link";

import { CLASS_COLOR, CLASS_LABEL, STATUS_LABEL, STATUS_STYLE } from "@/lib/format";
import type { StatsRow } from "@/lib/types";

function time(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

interface Props {
  rows: StatsRow[];
  /** Extra line under the site id (e.g. "illustrative sample · hand-written"). */
  rowNote?: (row: StatsRow) => string | null;
  emptyText?: string;
}

export default function ResultsTable({
  rows,
  rowNote,
  emptyText = "No runs yet. Start one from the Run page.",
}: Props) {
  if (rows.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-ink-700 px-6 py-12 text-center text-ink-400">
        {emptyText}
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-2xl border border-ink-700 bg-ink-900/80">
      <table className="w-full min-w-[56rem] text-left text-sm">
        <thead className="border-b border-ink-700">
          <tr>
            {[
              "Time",
              "Site / URL",
              "Classes",
              "Status",
              "Attempts",
              "Credits",
              "Baseline",
              "Mode",
              "",
            ].map((h) => (
              <th key={h} scope="col" className="kicker px-4 py-3 font-normal">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-800">
          {rows.map((r) => (
            <tr key={r.run_id} className="transition-colors hover:bg-ink-850">
              <td className="whitespace-nowrap px-4 py-3 font-mono text-xs tabular-nums text-ink-400">
                {time(r.created_at)}
              </td>
              <td className="max-w-[20rem] px-4 py-3">
                <div className="font-medium text-ink-50">{r.site_id ?? "custom"}</div>
                {rowNote?.(r) && <div className="text-xs text-ochre-300">{rowNote(r)}</div>}
                <div className="truncate font-mono text-xs text-ink-400" title={r.url}>
                  {r.url}
                </div>
              </td>
              <td className="px-4 py-3">
                <div className="flex flex-wrap gap-1">
                  {r.classes.length === 0 && <span className="text-ink-500">—</span>}
                  {r.classes.map((c, i) => (
                    <span
                      key={`${c}-${i}`}
                      className={`rounded-full px-2 py-0.5 text-xs ${CLASS_COLOR[c]}`}
                    >
                      {CLASS_LABEL[c]}
                    </span>
                  ))}
                </div>
              </td>
              <td
                className={`whitespace-nowrap px-4 py-3 font-mono text-xs tracking-wide ${STATUS_STYLE[r.status]}`}
              >
                {STATUS_LABEL[r.status]}
              </td>
              <td className="px-4 py-3 font-mono tabular-nums text-ink-200">{r.attempts}</td>
              <td className="px-4 py-3 font-mono tabular-nums text-ink-200">{r.credits_used}</td>
              <td className="px-4 py-3 font-mono tabular-nums text-ink-400">
                {r.baseline_credits_estimate ?? "—"}
              </td>
              <td className="px-4 py-3 font-mono text-xs">
                <span className={r.mode === "replay" ? "text-ochre-300" : "text-moss-300"}>
                  {r.mode === "replay" ? "replay" : "live"}
                </span>
              </td>
              <td className="px-4 py-3 text-right">
                <Link
                  href={`/runs/${encodeURIComponent(r.run_id)}`}
                  className="text-sm text-ink-300 transition-colors hover:text-moss-300"
                >
                  Open →
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
