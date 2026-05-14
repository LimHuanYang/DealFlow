import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/')({
  component: HomePage,
});

function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-4xl font-semibold tracking-tight" data-testid="hero-title">
        DealFlow
      </h1>
      <p className="text-sm text-neutral-500">Phase 1 — Foundation</p>
    </main>
  );
}
