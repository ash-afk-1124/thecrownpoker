import { useEffect, useState } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'solo' }
  | { name: 'room'; code: string };

export function parseRoute(pathname: string): Route {
  const room = pathname.match(/^\/room\/(\d{6})\/?$/);
  if (room) return { name: 'room', code: room[1] };
  if (/^\/solo\/?$/.test(pathname)) return { name: 'solo' };
  return { name: 'home' };
}

export function navigate(path: string, replace = false) {
  if (replace) history.replaceState(null, '', path);
  else history.pushState(null, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(location.pathname));
  useEffect(() => {
    const onPop = () => setRoute(parseRoute(location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  return route;
}
