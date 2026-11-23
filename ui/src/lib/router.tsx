import {
  Children,
  createContext,
  isValidElement,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";

type Location = { pathname: string };
type NavigateOptions = { replace?: boolean };
type NavigateFn = (to: string, options?: NavigateOptions) => void;

const RouterContext = createContext<{ location: Location; navigate: NavigateFn } | null>(null);

function currentLocation(): Location {
  return { pathname: window.location.pathname || "/" };
}

export function BrowserRouter({ children }: { children: ReactNode }) {
  const [location, setLocation] = useState(currentLocation);
  useEffect(() => {
    const onPopState = () => setLocation(currentLocation());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  const navigate = useMemo<NavigateFn>(() => navigateTo, []);
  return <RouterContext.Provider value={{ location, navigate }}>{children}</RouterContext.Provider>;
}

export function navigateTo(to: string, options?: NavigateOptions) {
  const target = new URL(to, window.location.href);
  const next = `${target.pathname}${target.search}${target.hash}`;
  if (options?.replace) {
    window.history.replaceState(null, "", next);
  } else {
    window.history.pushState(null, "", next);
  }
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function useRouter() {
  const value = useContext(RouterContext);
  if (!value) {
    throw new Error("Router components must be inside BrowserRouter");
  }
  return value;
}

export function useLocation() {
  return useRouter().location;
}

export function useNavigate() {
  return useRouter().navigate;
}

type RouteProps = { path: string; element: ReactNode };

export function Route(_props: RouteProps) {
  return null;
}

export function Routes({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const routes = Children.toArray(children).filter(isValidElement) as ReactElement<RouteProps>[];
  const exact = routes.find((route) => route.props.path === pathname);
  const fallback = routes.find((route) => route.props.path === "*");
  return <>{(exact ?? fallback)?.props.element ?? null}</>;
}

export function Navigate({ to, replace = false }: { to: string; replace?: boolean }) {
  const navigate = useNavigate();
  useEffect(() => navigate(to, { replace }), [navigate, replace, to]);
  return null;
}
