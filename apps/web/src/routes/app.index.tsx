import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/app/')({
  // The dashboard is the new home. Pre-load redirect keeps the Welcome
  // placeholder from flashing.
  beforeLoad: () => {
    throw redirect({ to: '/app/dashboard' });
  },
  component: () => null,
});
