// Where in the console you are, kept in the address bar and the browser's own
// history (decisions/022). That one mechanism gives three things:
//   · the console's Back button returns to the page you were on;
//   · the browser's Back and Forward arrows do the same, instead of leaving;
//   · a reload stays on the page you were on.
//
// The address after "#" is the place: #/parties, #/parties/list, #/proforma.
// A place is a section and, where a section has more than one screen, a view.
import { useState, useEffect, useRef, useCallback } from "react";

const clean = (part) => String(part || "").toLowerCase().replace(/[^a-z0-9-]/g, "");

// "#/parties/list" → { section: "parties", view: "list" }. Anything that is
// not a place — an empty address, or an in-page anchor such as "#main" — is null.
export function parseRoute(hash) {
  const text = String(hash || "");
  if (!text.startsWith("#/")) return null;
  const [section, view = ""] = text.slice(2).split("/");
  if (!clean(section)) return null;
  return { section: clean(section), view: clean(view) };
}

export function routeHash(route) {
  const section = clean(route && route.section);
  const view = clean(route && route.view);
  return "#/" + section + (view ? "/" + view : "");
}

export const sameRoute = (a, b) => Boolean(a && b) && a.section === b.section && (a.view || "") === (b.view || "");

/* The place, and the two ways to move.

   Every move made through navigate() adds one entry to the browser's history
   and numbers it (idx). Back is offered only while idx > 0 — that is, only
   while there is an earlier page of THIS console to return to. The console's
   Back button can therefore never take anyone out of the console.          */
export function useRoute(fallbackSection = "overview") {
  const read = () => {
    if (typeof window === "undefined") return { section: fallbackSection, view: "", idx: 0 };
    const place = parseRoute(window.location.hash) || { section: fallbackSection, view: "" };
    const state = window.history.state;
    return { ...place, idx: state && typeof state.idx === "number" ? state.idx : 0 };
  };
  const [route, setRoute] = useState(read);
  const routeRef = useRef(route);
  routeRef.current = route;

  useEffect(() => {
    // Number the entry the console was opened on, without adding one.
    const state = window.history.state;
    if (!state || typeof state.idx !== "number") {
      window.history.replaceState({ ...(state || {}), idx: 0 }, "", window.location.hash || routeHash(routeRef.current));
    }
    // Back, Forward, or an address typed by hand.
    const onPop = (event) => {
      const place = parseRoute(window.location.hash);
      if (!place) return;                       // an in-page anchor: not a move
      const idx = event.state && typeof event.state.idx === "number" ? event.state.idx : 0;
      setRoute({ ...place, idx });
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const navigate = useCallback((section, view = "") => {
    const here = routeRef.current;
    const next = { section: clean(section), view: clean(view), idx: here.idx + 1 };
    if (!next.section || sameRoute(here, next)) return;   // already there: no new entry
    window.history.pushState({ idx: next.idx }, "", routeHash(next));
    routeRef.current = next;
    setRoute(next);
  }, []);

  const goBack = useCallback(() => { if (routeRef.current.idx > 0) window.history.back(); }, []);

  return { route, navigate, goBack, canGoBack: route.idx > 0 };
}
