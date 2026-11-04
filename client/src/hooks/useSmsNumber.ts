import { useEffect, useState } from 'react';
import { get } from '../services/api';

const KEY = 'rq_sms_number';
/** Emergency SMS number configured by the administrators; cached so it is still known when the network is down. */
export function useSmsNumber(): string {
  const [n, setN] = useState<string>(() => {
    try {
      return localStorage.getItem(KEY) ?? '';
    } catch {
      return '';
    }
  });
  useEffect(() => {
    get<{ smsEmergencyNumber: string }>('/config/public')
      .then((c) => {
        setN(c.smsEmergencyNumber);
        try {
          localStorage.setItem(KEY, c.smsEmergencyNumber);
        } catch {
          /* ignore */
        }
      })
      .catch(() => undefined);
  }, []);
  return n;
}
