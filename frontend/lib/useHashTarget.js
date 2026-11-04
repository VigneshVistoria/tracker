import { useEffect } from 'react';
import { useRouter } from 'next/router';

// Notification deep links (2026-11-04). Links such as /tasks/12#flags or
// /performance-tracking/security-findings#finding-7 point at an element
// that only exists once the page (and often the panel itself) has loaded
// its data - Next.js scrolls to the hash straight after the route change,
// while the page is still showing its loading state, so nothing happened.
// This waits for the element, then scrolls it into view, focuses it and
// highlights it briefly.
//
// `reveal(id)` runs first so the page can switch tabs; collapsed sections
// open themselves when the hash targets something inside them (see
// components/ui/CollapsibleSection.js, which listens for REVEAL_EVENT).
// `skip(id)` lets a page keep its own handler for some ids (the task page
// already highlights #dependency-N itself).

export const REVEAL_EVENT = 'tracker:reveal-hash-target';
export const HIGHLIGHT_CLASS = 'deep-link-highlight';

const WAIT_MS = 10000;
const HIGHLIGHT_MS = 2500;

function currentHashId() {
  if (typeof window === 'undefined') return '';
  const raw = window.location.hash.slice(1);
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export function scrollToTarget(el) {
  if (!el.hasAttribute('tabindex') && !/^(A|BUTTON|INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) {
    el.setAttribute('tabindex', '-1');
  }
  el.scrollIntoView({ block: 'center' });
  el.focus({ preventScroll: true });
  el.classList.add(HIGHLIGHT_CLASS);
  setTimeout(() => el.classList.remove(HIGHLIGHT_CLASS), HIGHLIGHT_MS);
}

export default function useHashTarget({ ready = true, reveal, skip } = {}) {
  const router = useRouter();

  useEffect(() => {
    if (!ready) return undefined;
    let observer = null;
    let timer = null;
    const stop = () => {
      observer?.disconnect();
      observer = null;
      clearTimeout(timer);
    };

    const go = () => {
      stop();
      const id = currentHashId();
      if (!id || skip?.(id)) return;
      reveal?.(id);
      window.dispatchEvent(new CustomEvent(REVEAL_EVENT, { detail: { id } }));
      const tryFind = () => {
        const el = document.getElementById(id);
        if (!el || el.closest('[hidden]')) return false;
        stop();
        // Let a just-opened tab or section paint before measuring.
        requestAnimationFrame(() => scrollToTarget(el));
        return true;
      };
      if (tryFind()) return;
      observer = new MutationObserver(() => {
        if (!tryFind()) window.dispatchEvent(new CustomEvent(REVEAL_EVENT, { detail: { id } }));
      });
      observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
      timer = setTimeout(stop, WAIT_MS);
    };

    go();
    router.events.on('hashChangeComplete', go);
    window.addEventListener('hashchange', go);
    return () => {
      stop();
      router.events.off('hashChangeComplete', go);
      window.removeEventListener('hashchange', go);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, router.asPath]);
}
