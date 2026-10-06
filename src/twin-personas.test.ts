// M407 — the twin persona panel: twenty distinct, well-formed potential users, each resolvable by the twin.
import { test, expect } from 'bun:test';
import { TWIN_PERSONAS, TWIN_PERSONA_IDS, findTwinPersona, personaCalibration } from './twin-personas.js';
import { calibrationFor, PERSONA_CALIBRATION } from './twin.js';

test('M407: exactly twenty personas with unique, stable ids', () => {
  expect(TWIN_PERSONAS.length).toBe(20);
  expect(new Set(TWIN_PERSONA_IDS).size).toBe(20);
  for (const id of TWIN_PERSONA_IDS) expect(id).toMatch(/^[a-z][a-z0-9-]+$/);
});

test('M407: every persona is fully described', () => {
  for (const p of TWIN_PERSONAS) {
    for (const k of ['name', 'tagline', 'cli', 'sessionShape', 'values', 'severeWhen', 'calibration'] as const) expect(p[k].trim().length, `${p.id}.${k}`).toBeGreaterThan(8);
    expect(p.locale.trim().length, `${p.id}.locale`).toBeGreaterThan(3);
    expect(['new', 'some', 'seasoned']).toContain(p.agentExperience);
    expect(p.calibration.length, `${p.id} calibration too short`).toBeGreaterThan(300);
  }
});

test('M407: the panel is distinct — no two personas share a role line, and it spans languages and experience levels', () => {
  expect(new Set(TWIN_PERSONAS.map((p) => p.name)).size).toBe(20);
  const locales = new Set(TWIN_PERSONAS.map((p) => p.locale.split(/[ (]/)[0]));
  expect(locales.size).toBeGreaterThanOrEqual(6);                       // English, Chinese, Russian, Japanese, Spanish, Portuguese…
  expect(new Set(TWIN_PERSONAS.map((p) => p.agentExperience)).size).toBe(3);
  expect(TWIN_PERSONAS.filter((p) => p.agentExperience === 'new').length).toBeGreaterThanOrEqual(3);
});

test('M407: the twin resolves a persona id to its own calibration and still honours the two dials', () => {
  const amir = findTwinPersona('amir-embedded-firmware')!;
  const c = calibrationFor('amir-embedded-firmware');
  expect(c).toBe(personaCalibration(amir));
  expect(c).toContain('500 mA');
  expect(c).toContain('"amir-embedded-firmware"');
  expect(calibrationFor('normal')).toBe(PERSONA_CALIBRATION.normal);
  expect(calibrationFor('critic')).toBe(PERSONA_CALIBRATION.critic);
  expect(() => calibrationFor('nobody-here')).toThrow(/unknown twin persona/);
});
