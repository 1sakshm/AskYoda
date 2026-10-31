/** The heading block every content page opens with. */
export default function PageHead({
  kicker,
  title,
  body,
  children,
}: {
  kicker: string;
  title: string;
  body?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="animate-rise flex flex-wrap items-end justify-between gap-6">
      <div className="max-w-2xl">
        <p className="kicker">{kicker}</p>
        <h1 className="mt-3 font-display text-5xl tracking-tight text-ink-50 sm:text-6xl">
          {title}
        </h1>
        {body && <p className="mt-4 text-lg leading-relaxed text-ink-300">{body}</p>}
      </div>
      {children}
    </div>
  );
}
