// M65: filer fleet test — N isolated scenarios (own project/DB each), diverse
// personas, registers, and topics; each probes specific filer duties.
// Usage: HARNESSMAP_INFERENCE=api bun run src/eval/fleet.ts [filter]
import { randomUUID } from 'node:crypto';
import { Store } from '../store/db.js';
import { Translator, CANON_TYPES } from '../translator/translator.js';
import type { MapNode, Alteration } from '../types.js';

interface Round { user: string; assistant: string }
interface Check { name: string; fn: (nodes: MapNode[], history: Alteration[]) => boolean }
interface Scenario { name: string; persona: string; rounds: Round[]; checks: Check[] }

const has = (ns: MapNode[], p: (n: MapNode) => boolean) => ns.some(p);
const kw = (s: string, ...w: string[]) => w.some((x) => s.toLowerCase().includes(x));
const solid = ['accepted', 'decided', 'active', 'hard', 'chosen', 'done', 'live'];

const SCENARIOS: Scenario[] = [
  { name: 'phd-dissertation', persona: 'formal PhD student',
    rounds: [{ user: 'I need to structure my dissertation on urban heat islands. Hard deadline: full draft to my committee by December 1st. My central research question: do green roofs measurably reduce nighttime surface temperatures at neighborhood scale?', assistant: 'A clean three-part structure would work: methods, the Portland case study, and policy implications. For the research question, MODIS nighttime data at 1km resolution is the standard instrument.' }],
    checks: [
      { name: 'deadline constraint', fn: (n) => has(n, (x) => x.type === 'constraint' && kw(x.content, 'december')) },
      { name: 'research question captured', fn: (n) => has(n, (x) => x.type === 'question' && kw(x.content, 'green roof', 'nighttime')) },
    ] },
  { name: 'founder-pricing', persona: 'terse startup founder',
    rounds: [
      { user: 'Pricing. Going with $29/mo flat. No tiers. Simplicity wins.', assistant: 'Flat $29 is defensible. Watch for enterprise deals wanting invoicing.' },
      { user: 'Scratch that — talked to three customers, we need a $99 team tier. Keep $29 for individuals.', assistant: 'Two tiers then: $29 individual, $99 team.' }],
    checks: [
      { name: 'reversal applied (no stale flat-only decision solid)', fn: (n) => !has(n, (x) => kw(x.content, 'no tiers') && solid.includes(x.status)) },
      { name: 'team tier decision exists', fn: (n) => has(n, (x) => kw(x.content, '99') && solid.includes(x.status)) },
    ] },
  { name: 'parent-birthday', persona: 'rambling parent',
    rounds: [{ user: "Okay so Maya's party — she wants dinosaurs this year, which, fine. We're doing the backyard on the 14th. Oh and remind me to order the cake by Tuesday, the good bakery needs a week.", assistant: 'Dinosaur backyard party on the 14th. Cake order by Tuesday noted.' }],
    checks: [
      { name: 'cake reminder becomes a task', fn: (n) => has(n, (x) => x.type === 'task' && kw(x.content, 'cake')) },
      { name: 'date captured', fn: (n) => has(n, (x) => kw(x.content, '14th')) },
    ] },
  { name: 'novelist-plot', persona: 'doubting novelist',
    rounds: [{ user: "Chapter 12 is where the betrayal lands. I keep wondering — maybe the sister should be the villain instead of the uncle? Feels risky though, might undercut the mother storyline.", assistant: 'Sister-as-villain is a stronger reveal but you would need to reseed chapters 3 and 7.' }],
    checks: [
      { name: 'musing captured as exploratory', fn: (n) => has(n, (x) => x.status === 'exploratory' && kw(x.content, 'sister')) },
      { name: 'betrayal chapter fact captured', fn: (n) => has(n, (x) => kw(x.content, 'chapter 12', 'betrayal')) },
    ] },
  { name: 'coach-program', persona: 'fitness coach',
    rounds: [{ user: "New client program. Non-negotiable: she has a torn meniscus, so zero deep knee flexion — that's a hard line. Thinking either a hinge-dominant block or an upper/lower split to start.", assistant: 'With the meniscus restriction, hinge-dominant with box squats to parallel is safest.' }],
    checks: [
      { name: 'injury constraint hard/active', fn: (n) => has(n, (x) => x.type === 'constraint' && kw(x.content, 'knee', 'meniscus') && ['hard', 'active'].includes(x.status)) },
      { name: 'program options captured', fn: (n) => has(n, (x) => x.type === 'option' && kw(x.content, 'hinge', 'upper')) },
    ] },
  { name: 'lawyer-caseprep', persona: 'formal litigator',
    rounds: [{ user: 'For the Hendricks matter: the email of March 3rd establishes prior notice — that is our anchor exhibit. Open issue: whether the revised warranty even applies to refurbished units.', assistant: 'The March 3rd email is strong. On the warranty question, Section 4.2 arguably excludes refurbished units.' }],
    checks: [
      { name: 'anchor evidence captured', fn: (n) => has(n, (x) => x.type === 'evidence' && kw(x.content, 'march 3')) },
      { name: 'warranty question open', fn: (n) => has(n, (x) => x.type === 'question' && kw(x.content, 'warrant', 'refurb')) },
    ] },
  { name: 'teacher-switch', persona: 'teacher, mid-thought topic switch',
    rounds: [
      { user: 'Planning the photosynthesis unit: lab on Wednesday, quiz Friday.', assistant: 'Wednesday lab, Friday quiz — a light-absorption demo works well midweek.' },
      { user: 'Different thing entirely — a parent is disputing their kid\'s essay grade and wants a meeting. How do I handle that?', assistant: 'Offer a rubric walkthrough meeting; bring the graded essay and two anonymized comparisons.' }],
    checks: [
      { name: 'new-topic guarantee: grade dispute exists somewhere', fn: (n) => has(n, (x) => kw(x.content, 'dispute', 'parent', 'grade')) },
      { name: 'original unit intact and separate', fn: (n) => has(n, (x) => kw(x.content, 'photosynthesis', 'quiz')) },
    ] },
  { name: 'gamer-raid', persona: 'slangy guild leader',
    rounds: [{ user: "aight officers meeting done — locking sat night 8pm EST for the guild raid, thats final. still torn on comp tho, double healer or battle rez insurance", assistant: 'Saturday 8pm EST locked. For mythic week, double healer is the safer comp.' }],
    checks: [
      { name: 'slang commitment lands solid', fn: (n) => has(n, (x) => kw(x.content, 'saturday', 'sat') && solid.includes(x.status)) },
      { name: 'comp deliberation open', fn: (n) => has(n, (x) => kw(x.content, 'healer', 'comp') && !solid.includes(x.status)) },
    ] },
  { name: 'retiree-garden', persona: 'gentle retiree with a lookup',
    rounds: [{ user: "The rose bed plan is coming along. Quick question while I have you — what hardiness zone is Portland Oregon again?", assistant: 'Portland is USDA zone 9a these days. Your David Austins will be very happy.' }],
    checks: [
      { name: 'transient lookup captured answered', fn: (n) => has(n, (x) => kw(x.content, 'zone', '9a') && x.status === 'answered') },
    ] },
  { name: 'engineer-migration', persona: 'senior engineer',
    rounds: [{ user: 'Postgres migration plan: absolute requirement is zero downtime — we have SLAs. First task: inventory every service touching the old cluster. I also want a rollback runbook before anything moves.', assistant: 'Zero-downtime means logical replication + dual-write window. Service inventory first is right.' }],
    checks: [
      { name: 'zero-downtime constraint hard-ish', fn: (n) => has(n, (x) => x.type === 'constraint' && kw(x.content, 'downtime')) },
      { name: 'inventory task', fn: (n) => has(n, (x) => x.type === 'task' && kw(x.content, 'inventor', 'every service', 'touching')) },
      { name: 'runbook captured', fn: (n) => has(n, (x) => kw(x.content, 'rollback', 'runbook')) },
    ] },
  { name: 'musician-album', persona: 'musician parking a thread',
    rounds: [
      { user: 'Album sequencing: opener is Static, closer is Lighthouse, that much is settled. Big question is whether the ballad goes track 4 or track 7.', assistant: 'Static → Lighthouse frame is strong. Track 4 ballad risks early energy dip; 7 is safer.' },
      { user: "You know what, park the ballad question for now — I want fresh ears next week. Let's talk mixing instead: the drums on Static feel buried.", assistant: 'Ballad parked. For Static drums, try 2dB up on the room mics.' }],
    checks: [
      { name: 'ballad question parked', fn: (n) => has(n, (x) => kw(x.content, 'ballad') && x.status === 'parked') },
      { name: 'opener/closer decision NOT parked', fn: (n) => has(n, (x) => kw(x.content, 'static', 'lighthouse') && solid.includes(x.status)) },
      { name: 'mixing thread captured', fn: (n) => has(n, (x) => kw(x.content, 'drum', 'mix', 'buried')) },
    ] },
  { name: 'applicant-schools', persona: 'grad school applicant',
    rounds: [
      { user: 'Down to three: UCLA, Michigan, UW. My criteria: advisor fit first, funding second, weather honestly third.', assistant: 'On advisor fit, Michigan has two people in your exact area.' },
      { user: "Decision made — Michigan. The advisor fit outweighs everything.", assistant: 'Michigan it is.' }],
    checks: [
      { name: 'michigan chosen', fn: (n) => has(n, (x) => kw(x.content, 'michigan') && ['chosen', 'decided', 'accepted'].includes(x.status)) },
      { name: 'criteria captured', fn: (n) => has(n, (x) => kw(x.content, 'advisor fit')) },
    ] },
  { name: 'landlord-reno', persona: 'numbers-focused landlord',
    rounds: [{ user: 'Unit B renovation: cap is $12,400 all-in, that is what the reserve allows. Kitchen first, then bath only if quotes leave room.', assistant: 'At $12,400, a mid-range kitchen refresh runs $8-9k, leaving maybe $3k for bath basics.' }],
    checks: [
      { name: 'exact number preserved', fn: (n) => has(n, (x) => x.content.includes('12,400') || x.content.includes('12400')) },
      { name: 'sequencing decision', fn: (n) => has(n, (x) => kw(x.content, 'kitchen first')) },
    ] },
  { name: 'chef-rebuke', persona: 'chef issuing a correction',
    rounds: [
      { user: 'Tasting menu draft: five courses, spring theme.', assistant: 'Spring five-course: pea velouté with cream, lamb, rhubarb dessert.' },
      { user: "Why is there cream in the velouté? I said the whole menu is dairy-free — no butter, no cream, nothing. Fix that course.", assistant: 'Correcting: olive-oil pea velouté. Dairy-free across all five courses, noted firmly.' }],
    checks: [
      { name: 'rebuke → standing dairy-free constraint', fn: (n) => has(n, (x) => x.type === 'constraint' && kw(x.content, 'dairy') && solid.includes(x.status)) },
      { name: 'menu topic exists', fn: (n) => has(n, (x) => kw(x.content, 'tasting', 'five course', 'spring')) },
    ] },
  { name: 'traveler-morocco', persona: 'excited traveler, asides everywhere',
    rounds: [{ user: "Morocco in April! Two weeks. Must-dos: Fes medina and the Sahara camp. I absolutely will not do more than one internal flight — trains otherwise. Oh, and my sister gets vertigo so nothing with cliff roads.", assistant: 'April is ideal. Fes → desert via train and one flight works; the Tizi n\'Tichka pass would violate your cliff-road rule, so route south differently.' }],
    checks: [
      { name: 'one-flight constraint', fn: (n) => has(n, (x) => x.type === 'constraint' && kw(x.content, 'flight')) },
      { name: 'vertigo aside captured', fn: (n) => has(n, (x) => kw(x.content, 'vertigo', 'cliff')) },
    ] },
  { name: 'student-exam', persona: 'stressed student',
    rounds: [{ user: "Thermo final is in 9 days. Plan: past papers every morning, textbook chapters 6-8 after lunch. Don't let me forget to print the formula sheet — allowed one page double-sided.", assistant: 'Solid plan. Chapter 7 (entropy) is where most exam points concentrate.' }],
    checks: [
      { name: 'formula sheet task', fn: (n) => has(n, (x) => x.type === 'task' && kw(x.content, 'formula sheet')) },
      { name: 'study plan captured', fn: (n) => has(n, (x) => kw(x.content, 'past papers', 'chapters 6')) },
    ] },
  { name: 'scientist-experiment', persona: 'careful scientist',
    rounds: [{ user: 'Hypothesis: the biofilm resistance is plasmid-mediated, not chromosomal. Supporting: the cured strains lost resistance in all three replicates. Still open: whether horizontal transfer happens at body temperature.', assistant: 'Three-replicate curing result is strong support. For the transfer question, a filter-mating assay at 37°C is standard.' }],
    checks: [
      { name: 'hypothesis as claim', fn: (n) => has(n, (x) => x.type === 'claim' && kw(x.content, 'plasmid')) },
      { name: 'replicate evidence', fn: (n) => has(n, (x) => x.type === 'evidence' && kw(x.content, 'replicate', 'cured')) },
      { name: 'transfer question open', fn: (n) => has(n, (x) => x.type === 'question' && kw(x.content, 'transfer', 'temperature')) },
    ] },
  { name: 'shopper-laptop', persona: 'deliberating shopper',
    rounds: [
      { user: 'Laptop hunt: MacBook Air M3 vs the ThinkPad X1. I care about battery above all, then keyboard.', assistant: 'For battery the Air leads (15h+ real-world vs ~10h). ThinkPad wins keyboard.' },
      { user: 'Going with the Air. Battery wins.', assistant: 'MacBook Air M3 it is.' }],
    checks: [
      { name: 'air chosen', fn: (n) => has(n, (x) => kw(x.content, 'air', 'macbook') && ['chosen', 'decided', 'accepted'].includes(x.status)) },
      { name: 'thinkpad not still live-chosen', fn: (n) => !has(n, (x) => kw(x.content, 'thinkpad') && ['chosen', 'decided'].includes(x.status)) },
    ] },
  { name: 'habit-change', persona: 'reflective self-improver',
    rounds: [{ user: "I'm committing to running three mornings a week, for real this time. Though honestly... maybe I'm kidding myself, I've failed this exact resolution twice. Anyway — the rule is shoes by the door every night.", assistant: 'Shoes-by-the-door is a good friction hack. Two prior failures suggest starting with two mornings.' }],
    checks: [
      { name: 'commitment solid', fn: (n) => has(n, (x) => kw(x.content, 'three morning', 'running') && solid.includes(x.status)) },
      { name: 'self-doubt exploratory', fn: (n) => has(n, (x) => x.status === 'exploratory' && kw(x.content, 'kidding', 'failed', 'doubt')) },
    ] },
  { name: 'organizer-fundraiser', persona: 'community organizer with an aside',
    rounds: [{ user: "Fundraiser is locked for June 8th at the community hall. Venue deposit is paid. Unrelated — someone recommended a podcast called Maintenance Phase, want to check that out sometime.", assistant: 'June 8th locked with deposit down. Maintenance Phase is a good listen — it is about health science myths.' }],
    checks: [
      { name: 'date decision solid', fn: (n) => has(n, (x) => kw(x.content, 'june 8') && solid.includes(x.status)) },
      { name: 'podcast aside captured somewhere', fn: (n) => has(n, (x) => kw(x.content, 'podcast', 'maintenance phase')) },
    ] },
];

async function runScenario(sc: Scenario): Promise<{ name: string; pass: number; total: number; fails: string[]; nodes: number; offlist: number; toSort: boolean; ms: number }> {
  const store = new Store(':memory:');
  const projectId = store.ensureProject('default');
  const rootId = randomUUID();
  store.applyAlterations(projectId, [{ op: 'create_node', id: rootId, parentId: null, content: 'workspace', status: 'live', author: 'user' } as any], { kind: 'system' });
  const chatId = randomUUID();
  store.createChat({ id: chatId, projectId, focusContainerId: rootId, sdkSessionId: null });
  store.setLit(chatId, rootId, true);
  const translator = new Translator(store);
  const history: Alteration[] = [];
  const t0 = Date.now();
  for (const r of sc.rounds) {
    const turnId = randomUUID();
    store.appendTurn({ id: turnId, chatId, role: 'user', content: r.user, raw: null });
    const out = await translator.translateRound({ projectId, chatId, turnId, focusContainerId: rootId, userText: r.user, assistantText: r.assistant });
    if (out) history.push(...out.result.alterations);
  }
  const ms = Date.now() - t0;
  const nodes = store.getNodes(projectId).filter((n) => n.status !== 'removed');
  const fails: string[] = [];
  let pass = 0;
  for (const c of sc.checks) {
    if (c.fn(nodes, history)) pass += 1; else fails.push(c.name);
  }
  const offlist = ((store as any).db.prepare("SELECT COUNT(*) n FROM audit_log WHERE kind='offlist_type'").get() as any).n;
  const toSort = nodes.some((n) => (n.title || n.content).startsWith('to sort'));
  return { name: sc.name, pass, total: sc.checks.length, fails, nodes: nodes.length, offlist, toSort, ms };
}

const filter = process.argv[2];
const list = filter ? SCENARIOS.filter((s) => s.name.includes(filter)) : SCENARIOS;
let totalPass = 0, totalChecks = 0, totalOfflist = 0;
for (const sc of list) {
  const r = await runScenario(sc);
  totalPass += r.pass; totalChecks += r.total; totalOfflist += r.offlist;
  const flag = r.pass === r.total ? 'PASS' : 'FAIL';
  console.log(`${flag}  ${r.name.padEnd(22)} ${r.pass}/${r.total}  nodes:${String(r.nodes).padStart(2)}  ${r.toSort ? 'to-sort' : '       '}  ${Math.round(r.ms / 1000)}s${r.fails.length ? '  ✗ ' + r.fails.join('; ') : ''}`);
}
console.log(`\nTOTAL: ${totalPass}/${totalChecks} checks · offlist types: ${totalOfflist}`);
process.exit(totalPass / totalChecks >= 0.8 ? 0 : 1);
