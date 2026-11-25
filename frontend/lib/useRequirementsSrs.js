import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { apiFetch } from './api';
import { redirectToSignIn } from './session';

// Requirements pages (2026-11-25): who am I (switch + rights), which SRS
// documents I can see, and which one is selected (?srs=ID, else the first).
// Someone who cannot use Requirements goes to the dashboard - except a BA,
// for whom Requirements is the only screen: they get `off` instead.
export function useRequirementsSrs() {
  const router = useRouter();
  const [me, setMe] = useState(null);
  const [list, setList] = useState(null);
  const [srsId, setSrsId] = useState(null);
  const [off, setOff] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!router.isReady) return;
    if (!localStorage.getItem('user')) {
      redirectToSignIn(router);
      return;
    }
    (async () => {
      try {
        const who = await apiFetch('/requirements/me');
        setMe(who);
        if (!who.canView) {
          if (who.isBa) setOff(true);
          else router.replace('/dashboard');
          return;
        }
        const docs = await apiFetch('/requirements/srs');
        setList(docs);
        const wanted = Number(router.query.srs);
        setSrsId(docs.some((d) => d.id === wanted) ? wanted : docs[0]?.id ?? null);
      } catch (err) {
        setError(err.message);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady]);

  const chooseSrs = (id) => {
    setSrsId(id);
    router.replace({ pathname: router.pathname, query: { ...router.query, srs: id } }, undefined, { shallow: true });
  };

  return { me, list, srsId, chooseSrs, off, error, setError };
}
