import { createRootRoute, Outlet } from '@tanstack/react-router';
import { Toaster } from 'sonner';

export const Route = createRootRoute({
  component: () => (
    <div className="min-h-screen">
      <Outlet />
      <Toaster position="bottom-right" richColors closeButton />
    </div>
  ),
});
