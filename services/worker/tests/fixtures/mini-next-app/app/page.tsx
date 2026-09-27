export default function HomePage() {
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-[32px] font-medium">Welcome back</h1>
      <p className="text-muted">Build, test and deploy with the console.</p>
      <div className="rounded-lg border border-line bg-surface p-6">
        <h2 className="text-lg font-medium">Get started</h2>
        <p className="text-muted">Create an API key to make your first request.</p>
      </div>
    </section>
  );
}
