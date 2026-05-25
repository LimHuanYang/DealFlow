import { createFileRoute, Outlet } from '@tanstack/react-router';

/**
 * Settings layout route. Renders only an Outlet so nested file routes
 * (e.g. `app.settings.index.tsx`, `app.settings.custom-fields.tsx`) can take
 * over the viewport. Without this Outlet, child routes would change the URL
 * but render nothing.
 */
export const Route = createFileRoute('/app/settings')({
  component: SettingsLayout,
});

function SettingsLayout() {
  return <Outlet />;
}
