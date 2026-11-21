import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {AppState, NativeModules} from 'react-native';
import {createClient} from '@lan-tube/core';

export function useRemote(session, onRevoked) {
  const client = useMemo(() => session ? createClient(session.address, session.token) : null, [session]);
  const [state, setState] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const revision = useRef(0);
  const sending = useRef(false);
  useEffect(() => {
    if (!client) { setState(null); return; }
    let stopped = false, timer, controller, running = false, identified = false;
    const poll = async () => {
      if (stopped || running || AppState.currentState !== 'active') return;
      const before = revision.current;
      running = true; controller = new AbortController();
      try {
        if (!identified) {
          const {phoneId, phoneName} = NativeModules.RemoteTools.getConstants();
          try { await client.identify(phoneId, phoneName, controller.signal); identified = true; }
          catch (failure) { identified = failure.status === 404 || failure.status === 409; }
        }
        const next = await client.state(controller.signal);
        if (!stopped && !sending.current && before === revision.current) { setState(next); setError(''); }
      } catch (failure) {
        if (!stopped && !sending.current && before === revision.current && !controller.signal.aborted) {
          setState(null);
          if (failure.status === 401) onRevoked();
          else setError('Laptop unreachable. Check Wi-Fi and that the companion is running.');
        }
      } finally {
        running = false;
        if (!stopped && AppState.currentState === 'active') timer = setTimeout(poll, 2000);
      }
    };
    const subscription = AppState.addEventListener('change', value => {
      clearTimeout(timer);
      if (value === 'active') poll(); else controller?.abort();
    });
    poll();
    return () => { stopped = true; clearTimeout(timer); controller?.abort(); subscription.remove(); };
  }, [client, onRevoked]);
  const command = useCallback(async value => {
    if (!client || sending.current) return;
    sending.current = true; revision.current++;
    setBusy(true); setError('');
    try {
      const result = await client.command(value);
      if (!result.options && !result.playlists && !result.episodes) setState(result.state ?? await client.state());
      return result;
    }
    catch (failure) {
      if (failure.status === 401) onRevoked();
      else setError(failure.name === 'AbortError' ? 'The laptop took too long to respond.' : failure.message);
    } finally { sending.current = false; revision.current++; setBusy(false); }
  }, [client, onRevoked]);
  return {client, state, error, busy, command};
}
