'use client';

import { useEffect, useRef, useState } from 'react';
import { getGatewayUpdateSummary } from '@/modules/gateways/services/gateways.service';

const POLL_INTERVAL_MS = 60_000;

/**
 * Polls the gateway update-summary endpoint every 60s and returns the number
 * of online gateways that have an update available. Returns 0 on error or
 * while loading so no false-positive badge is shown.
 *
 * @param enabled - when false the hook is a no-op (hook call stays unconditional;
 *   only the effect body is gated). Pass false for roles that never see the
 *   Gateways nav item (e.g. CLIENTE) to avoid spurious 403s.
 */
export function useGatewayUpdateBadge(enabled: boolean): number {
  const [updatable, setUpdatable] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    if (!enabled) return;

    mountedRef.current = true;

    async function fetchSummary() {
      try {
        const data = await getGatewayUpdateSummary();
        if (mountedRef.current) setUpdatable(data.updatable);
      } catch {
        // On error: keep current value; first load starts at 0 (no false positive).
      }
    }

    void fetchSummary();

    function schedule() {
      timerRef.current = setTimeout(async () => {
        await fetchSummary();
        if (mountedRef.current) schedule();
      }, POLL_INTERVAL_MS);
    }
    schedule();

    return () => {
      mountedRef.current = false;
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, [enabled]);

  return updatable;
}
