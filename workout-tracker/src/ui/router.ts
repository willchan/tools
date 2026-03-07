/**
 * Simple hash-based router for SPA navigation.
 */

export type Route = 'home' | 'workout' | 'templates' | 'template-edit' | 'history' | 'settings';

type RouteHandler = (params: Record<string, string>) => void;

const routes = new Map<Route, RouteHandler>();

export function registerRoute(route: Route, handler: RouteHandler): void {
  routes.set(route, handler);
}

export function navigate(route: Route, params: Record<string, string> = {}): void {
  const search = new URLSearchParams(params).toString();
  window.location.hash = search ? `${route}?${search}` : route;
}

export function parseHash(): { route: Route; params: Record<string, string> } {
  const hash = window.location.hash.slice(1) || 'home';
  const [routePart, queryPart] = hash.split('?');
  const params: Record<string, string> = {};
  if (queryPart) {
    for (const [k, v] of new URLSearchParams(queryPart)) {
      params[k] = v;
    }
  }
  return { route: routePart as Route, params };
}

export function startRouter(): void {
  const handleRoute = () => {
    const { route, params } = parseHash();
    const handler = routes.get(route);
    if (handler) {
      handler(params);
    } else {
      // Default to home
      const homeHandler = routes.get('home');
      if (homeHandler) homeHandler({});
    }
  };

  window.addEventListener('hashchange', handleRoute);
  handleRoute();
}
