import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import en from '../i18n/locales/en';
import ta from '../i18n/locales/ta';
import { ASSISTANCE, BLOCKAGE_TYPES, EMERGENCY_TYPES, FACILITIES, PRIORITIES, ROLES, SEVERITIES, STATUSES, VULNERABLE } from '../utils/enums';

type Tree = { [k: string]: string | Tree };
const flatten = (o: Tree, prefix = ''): Record<string, string> =>
  Object.entries(o).reduce<Record<string, string>>((acc, [k, v]) => {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') acc[key] = v;
    else Object.assign(acc, flatten(v, key));
    return acc;
  }, {});
const E = flatten(en as Tree);
const T = flatten(ta as Tree);
const vars = (s: string) => [...s.matchAll(/{{\s*(\w+)\s*}}/g)].map((m) => m[1]).sort();

describe('translations', () => {
  it('Tamil has exactly the same keys as English', () => {
    const missingInTa = Object.keys(E).filter((k) => !(k in T));
    const extraInTa = Object.keys(T).filter((k) => !(k in E));
    expect({ missingInTa, extraInTa }).toEqual({ missingInTa: [], extraInTa: [] });
  });
  it('no empty strings', () => {
    expect(Object.entries(E).filter(([, v]) => !v.trim())).toEqual([]);
    expect(Object.entries(T).filter(([, v]) => !v.trim())).toEqual([]);
  });
  it('interpolation variables match between languages', () => {
    const bad = Object.keys(E).filter((k) => T[k] && JSON.stringify(vars(E[k])) !== JSON.stringify(vars(T[k])));
    expect(bad).toEqual([]);
  });
  it('Tamil text is really Tamil (not copied English) for user-facing keys', () => {
    const copied = Object.keys(E).filter((k) => /[A-Za-z]{4,}/.test(E[k]) && T[k] === E[k] && !/^(common\.appName|kind\.sos|nav\.sos)$/.test(k));
    expect(copied).toEqual([]);
  });
  it('every static t("key") used in source exists in English', () => {
    const files: string[] = [];
    const walk = (d: string) => readdirSync(d).forEach((f) => { const p = join(d, f); if (statSync(p).isDirectory()) { if (f !== '__tests__' && f !== 'locales') walk(p); } else if (/\.tsx?$/.test(f)) files.push(p); });
    walk(join(__dirname, '..'));
    const missing = new Set<string>();
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/\bt\(\s*'([a-zA-Z_.]+)'/g)) if (!(m[1] in E)) missing.add(`${m[1]} (${f.split('src/')[1]})`);
      for (const m of src.matchAll(/label:\s*'([a-zA-Z.]+)'/g)) if (m[1].includes('.') && !(m[1] in E)) missing.add(`${m[1]} (${f.split('src/')[1]})`);
    }
    expect([...missing]).toEqual([]);
  });
  it('enumerations have a translation each', () => {
    const need: [string, readonly string[]][] = [
      ['emergencyType', EMERGENCY_TYPES], ['status', STATUSES], ['priority', PRIORITIES], ['severity', SEVERITIES], ['blockageType', BLOCKAGE_TYPES],
      ['facility', FACILITIES], ['vulnerable', VULNERABLE], ['assistance', ASSISTANCE], ['role', ROLES],
    ];
    const missing = need.flatMap(([ns, vals]) => vals.filter((v) => !(`${ns}.${v}` in E) || !(`${ns}.${v}` in T)).map((v) => `${ns}.${v}`));
    expect(missing).toEqual([]);
  });
  it('API error and validation codes are translated', () => {
    for (const c of ['PRIORITY_NOT_CONFIRMED', 'FOOD_OVER_ALLOCATION', 'OCCUPANCY_EXCEEDS_CAPACITY', 'RATE_LIMIT_REPORTS', 'NETWORK_ERROR']) expect(T[`errors.${c}`]).toBeTruthy();
    for (const c of ['required', 'too_short', 'invalid_phone', 'invalid_coordinates', 'reason_required']) expect(T[`validation.${c}`]).toBeTruthy();
  });
});
