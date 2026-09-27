/** One numbered stage heading of the story, with the idea behind it in a few words. */
export function Stage({ number, title, hint }: { number: string; title: string; hint: string }) {
  return (
    <div className="opp-stage">
      <span className="opp-stage__num">{number}</span>
      <div>
        <h2 className="opp-stage__title">{title}</h2>
        <p className="opp-stage__hint">{hint}</p>
      </div>
    </div>
  );
}

export function Fact({
  value,
  label,
  note,
  text = false,
}: {
  value: string;
  label: string;
  note?: string;
  text?: boolean;
}) {
  return (
    <div className="opp-fact">
      <span className={`opp-fact__num${text ? " is-text" : ""}`}>{value}</span>
      <span className="opp-fact__label">{label}</span>
      {note ? <span className="opp-fact__note">{note}</span> : null}
    </div>
  );
}
