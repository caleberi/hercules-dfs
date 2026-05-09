/* eslint-disable react-refresh/only-export-components -- router instance export */
import {
  createRouter,
  createRootRoute,
  createRoute,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import PhotoLibrary from './PhotoLibrary';
import SettingsPage from './routes/settings';

const rootRoute = createRootRoute({
  component: () => (
    <>
      <Outlet />
    </>
  ),
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: PhotoLibrary,
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: SettingsPage,
});

const routeTree = rootRoute.addChildren([indexRoute, settingsRoute]);

export const router = createRouter({ routeTree });

export function AppRouter() {
  return <RouterProvider router={router} />;
}
