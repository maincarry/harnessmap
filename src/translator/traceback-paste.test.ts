import { test, expect } from 'bun:test';
import { Translator } from './translator.js';

// 2026-10-18 (numpy-panorama p3, the long week, week2): a pasted traceback filed as nodes — "142     warped_image =" as a TITLE, the
// numbered source lines as content, eleven across four maps in one day. The error is already the person's evidence node; the source
// lines are not a record of anything said. Real guard chain, stub store.
function harness(nodes: any[]) {
  const audits: { kind: string; d: any }[] = [];
  const store: any = new Proxy({}, { get(_t, k) { if (k === 'audit') return (kind: string, d: any) => audits.push({ kind, d }); if (k === 'getSetting') return () => undefined; return () => undefined; } });
  const t = new Translator(store);
  const map: any = { nodes, links: [], projectId: 'proj' };
  return (alts: any[]) => ({ out: (t as any).guardScope(alts, new Set(nodes.map((n) => n.id)), map, { chatId: 'c', focusContainerId: 'p1', userText: '', assistantText: '' }) as any[], audits });
}
const at = '2026-10-18T18:54:38Z';
const root = { id: 'p1', parentId: null, content: 'NumPy panorama stitching', title: 'NumPy panorama stitching', status: 'live', author: 'user', type: null, createdAt: at, updatedAt: at };
const mk = (title: string, content: string) => ({ op: 'create_node', id: 'n' + Math.random().toString(16).slice(2, 8), parentId: 'p1', title, content, status: 'live', author: 'user' });

test('a numbered source line as a title, with only traceback lines as content, is dropped', () => {
  const r = harness([root])([mk('142     warped_image =', '142     warped_image = np.zeros((*img.shape[:2], 3), dtype=np.uint8) # Initialize a 3-channel image with zeros 143     for i in range(3): --> 144         warped_image[..., i][valid_target_coordinates[1], valid_target_coordinates[0]] = img[..., i][valid_source_coordinates[1], valid_source_coordinates[0]]')]);
  expect(r.out.filter((a) => a.op === 'create_node')).toHaveLength(0);
  expect(r.audits.map((a) => a.kind)).toContain('guard_traceback_paste');
});

test('a traceback arrow head with no prose is dropped even when the title is a code fragment', () => {
  const r = harness([root])([mk('134             destination_point =', '134             destination_point = np.array([j, i, 1]) 135             source_point = H @ destination_point')]);
  expect(r.out.filter((a) => a.op === 'create_node')).toHaveLength(0);
  const r2 = harness([root])([mk('88         h1, w1 = ref_img.shape[:2] def', '88         h1, w1 = ref_img.shape[:2] def feature_extraction(sub_images, method="SIFT"):')]);
  expect(r2.out.filter((a) => a.op === 'create_node')).toHaveLength(0);
});

test('a node with a worded title stays even when its content is code, and prose about a traceback stays', () => {
  const kept = harness([root])([mk('Loop Through Pixels', '131 132     for i in range(h): --> 133         for j in range(w):')]);
  expect(kept.out.filter((a) => a.op === 'create_node')).toHaveLength(1);
  const prose = harness([root])([mk('Warp index error persists', '`warp_perspective` raises IndexError: index 973 is out of bounds for axis 0 with size 973 at the indexed assignment on line 144. The error persists after the shape fix.')]);
  expect(prose.out.filter((a) => a.op === 'create_node')).toHaveLength(1);
  const snippet = harness([root])([mk('Target array shape', 'Use `np.zeros((h, w, 3))` for the target so the channel axis is last; the loop over channels stays as it is.')]);
  expect(snippet.out.filter((a) => a.op === 'create_node')).toHaveLength(1);
  expect(kept.audits.concat(prose.audits, snippet.audits).filter((a) => a.kind === 'guard_traceback_paste')).toHaveLength(0);
});

test('an update that would overwrite a statement with a traceback keeps the statement and files nothing', () => {
  // guard_rewrite_to_child (earlier in the chain) turns a content rewrite into a child create; the paste guard then drops that child.
  const cur = { id: 'e1', parentId: 'p1', content: 'The warp raises an index error.', title: 'Warp index error', status: 'noted', author: 'user', type: 'evidence', createdAt: at, updatedAt: at };
  const r = harness([root, cur])([{ op: 'update_node', id: 'e1', content: '142     warped_image = np.zeros(...) --> 144         warped_image[...]' }]);
  expect(r.out.find((a) => a.op === 'update_node' && a.id === 'e1' && typeof a.content === 'string')).toBeUndefined();
  expect(r.out.filter((a) => a.op === 'create_node')).toHaveLength(0);
  expect(r.audits.map((a) => a.kind)).toEqual(expect.arrayContaining(['guard_rewrite_to_child', 'guard_traceback_paste']));
});

// M488: the specifics guard (M474) is where the numbered-line nodes were born — an UNFENCED traceback's line numbers counted as the
// person's figures and the code lines were filed verbatim as her sentence. Driven directly here.
function specifics(nodes: any[], userText: string, alts: any[] = []) {
  const audits: { kind: string; d: any }[] = [];
  const store: any = new Proxy({}, { get(_t, k) { if (k === 'audit') return (kind: string, d: any) => audits.push({ kind, d }); if (k === 'getSetting') return () => undefined; return () => undefined; } });
  const t = new Translator(store);
  const out = (t as any).guardSpecificsKept(alts, { nodes }, { userText, assistantText: '', focusContainerId: 'p1' }) as any[];
  return { out, audits };
}
const TRACEBACK = 'the error persist in warp_perspective(img, H, target_shape)     148     warped_image = np.zeros((*img.shape[:2], 3), dtype=np.uint8)     149     for i in range(3): --> 150         warped_image[..., i][valid_target_coordinates[1], valid_target_coordinates[0]] = img[..., i][valid_source_coordinates[1], valid_source_coordinates[0]] IndexError: index 973 is out of bounds for axis 0 with size 973';

test('an unfenced traceback in the turn files no source line as the person\'s sentence; the error message is the specific kept', () => {
  const r = specifics([root], TRACEBACK);
  const creates = r.out.filter((a) => a.op === 'create_node');
  for (const c of creates) {
    expect(c.title).not.toMatch(/^\s*\d{1,4}\s{2,}/);
    expect(c.content).not.toMatch(/warped_image = np\.zeros/);
  }
  const missed = r.audits.filter((a) => a.kind === 'guard_specifics_kept').flatMap((a) => a.d.missed as string[]);
  expect(missed).not.toContain('148'); expect(missed).not.toContain('149'); expect(missed).not.toContain('150');
  // the error's figure is still a specific: either already on the map or filed as her words
  if (creates.length) expect(creates.some((c) => /973|warp_perspective/.test(c.content))).toBe(true);
});

test('the specifics guard still files a real missed figure stated in prose', () => {
  const r = specifics([root], 'Generate numbers until 15000, then print the first 10 in ascending order.');
  const creates = r.out.filter((a) => a.op === 'create_node');
  expect(creates).toHaveLength(1);
  expect(creates[0].content).toMatch(/15000/);
  expect(r.audits.some((a) => a.kind === 'guard_specifics_kept' && (a.d.missed as string[]).includes('15000'))).toBe(true);
});

// M489: a quoted lead-in inside a paste is not a specific, and a lead-in sentence is never the row filed.
test('a quoted lead-in ("Here is the description of the dataset:") files nothing; a real quoted rule still files', () => {
  const paste = 'Here is my assignment description if that helps: "Here is the description of the dataset: "Each image sequence contains a reference image and 5 target images taken under a different illumination and/or, for a planar scenes, a different viewpoint. The homographies are estimated with respect to the reference image.';
  const r = specifics([root], paste);
  const creates = r.out.filter((a) => a.op === 'create_node');
  for (const c of creates) expect(c.content).not.toMatch(/^Here is my assignment description/);
  const missed = r.audits.filter((a) => a.kind === 'guard_specifics_kept').flatMap((a) => a.d.missed as string[]);
  expect(missed.some((m) => /^Here is the description/.test(m))).toBe(false);
  const rule = specifics([root], 'Record this as my rule: "never kick the watchdog from inside a wait loop".');
  const kept = rule.out.filter((a) => a.op === 'create_node');
  expect(kept).toHaveLength(1);
  expect(kept[0].content).toMatch(/never kick the watchdog/);
});

// M490: string literals inside unfenced pasted code are not quoted phrases, and a pasted statement is never the row filed.
const PASTED_CODE = 'Here is the code:\n\ndef read_ground_truth_homographies(dataset_path):\n    H_files = sorted(glob.glob(os.path.join(dataset_path, "H_.txt")))\n    ground_truth_homographies = []\n    for filename in H_files:\n        H = np.loadtxt(filename)\n        ground_truth_homographies.append(H)\n    return ground_truth_homographies\n\nprint(f"Image {i} was skipped due to homography failure")\nimages = sorted(glob.glob(os.path.join(dataset_path, "*.png")))\n';
test('unfenced pasted Python files no statement as the person\'s row, and its string literals are not specifics', () => {
  const r = specifics([root], PASTED_CODE);
  const creates = r.out.filter((a) => a.op === 'create_node');
  for (const c of creates) {
    expect(c.content).not.toMatch(/H_files = sorted|^def |print\(f"/);
    expect(c.title).not.toMatch(/^H_files =/);
  }
  const missed = r.audits.filter((a) => a.kind === 'guard_specifics_kept').flatMap((a) => a.d.missed as string[]);
  expect(missed.some((m) => /^Image \{i\}|^\*\.png$/.test(m))).toBe(false);
  // a filename spoken in prose is still a specific worth keeping
  const prose = specifics([root], 'Please keep the ground truth list in homographies.txt, not in the notebook, so the grader can read it.');
  const kept = prose.out.filter((a) => a.op === 'create_node');
  expect(kept).toHaveLength(1);
  expect(kept[0].content).toMatch(/homographies\.txt/);
});

// M493: a smart-quoted, unindented code paste (WildChat shape) files no fragment as the person's row; a curly-quoted phrase in prose still does.
const SMART_PASTE = 'Here is my code:\nprompt_logfile = “prompt.txt”\ntry:\nwith open(prompt_logfile, “r”, encoding=“utf-8”) as f:\nprompt_text = f.read()\nexcept FileNotFoundError:\n# If the prompt log file doesn’t exist, use the default prompt text\nprompt_text = “Translate the following text: {text_to_translate}”\ncompletion = openai.ChatCompletion.create(\nmodel=“gpt-3.5-turbo-0301”,\ntemperature=1,\nmessages=[\n{\n“role”: “user”,\n“content”: f"{prompt}“,\n}\n],\n)\ntranslated_text = (\ncompletion[“choices”][0]\n.get(“message”)\n.get(“content”)\n)\nuntranslated_textbox = tk.Text(root, font=font.Font(family=“Arial”, size=10), bg=“white”, width=50)\n';
test('a smart-quoted unindented paste files no code fragment; its keys and literals are not specifics', () => {
  const r = specifics([root], SMART_PASTE);
  const creates = r.out.filter((a) => a.op === 'create_node');
  for (const c of creates) expect(c.content).not.toMatch(/“role”|font\.Font|prompt_logfile =|\.get\(|^\s*[{}\]],?\s*$/m);
  const missed = r.audits.filter((a) => a.kind === 'guard_specifics_kept').flatMap((a) => a.d.missed as string[]);
  expect(missed.some((m) => /^(role|user|content|white|Arial)$/.test(m))).toBe(false);
  const prose = specifics([root], 'She told me to keep the “white” theme as the default, so leave it there.');
  const kept = prose.out.filter((a) => a.op === 'create_node');
  expect(kept).toHaveLength(1);
  expect(kept[0].content).toMatch(/keep the “white” theme/);
});

// M493b: a prose sentence that mentions a call with keyword arguments is prose, not a code line.
test('prose that names a keyword-argument call still files its own specifics', () => {
  const r = specifics([root], 'Update the matching-plot loop to call cv2.drawMatches(img1, kp1, img2, kp2, matches, None, flags=2) for each pair, limit 50 matches.');
  const kept = r.out.filter((a) => a.op === 'create_node');
  expect(kept).toHaveLength(1);
  expect(kept[0].content).toMatch(/matching-plot loop/);
});

// M500: pasted "Label: numbers" data lines are never the sentence filed; a prose sentence with a figure still is.
test('pasted Input/Result data lines file no fragment under her name', () => {
  const paste = 'Here are the pairs of (input, result)\n\nInput: 1, 6, 2, 2\nResult: 6\n\nInput: 2, 6, 6, 0\nResult: 13\n\nInput: 2, 6, 4, 4\nResult: 263\n\nInput: 3, 4, 4, 4\nResult: 302\n';
  const r = specifics([root], paste);
  const creates = r.out.filter((a) => a.op === 'create_node');
  for (const c of creates) expect(c.content).not.toMatch(/^(?:Input|Result):/);
  // M501: the block is on the record once, as one "Pasted data" row in her name — not as fragments, not nowhere
  expect(creates).toHaveLength(1);
  expect(creates[0].content).toMatch(/^Pasted data \(8 lines\): Input: 1, 6, 2, 2; Result: 6; /);
  expect(creates[0].author).toBe('user');
  expect(r.audits.some((a) => a.kind === 'guard_specifics_kept' && a.d.how === 'data-block')).toBe(true);
  const prose = specifics([root], 'The teacher said the expected result for the last pair is 302, not 263.');
  const kept = prose.out.filter((a) => a.op === 'create_node');
  expect(kept).toHaveLength(1);
  expect(kept[0].content).toMatch(/302/);
});

// M516 (react-router-layout 2026-10-25): a pasted JSX/markup line is never the person's row; a figure with a unit in prose still is.
test('a pasted JSX line with a px figure files no markup fragment; the same figure in prose is kept', () => {
  const r = specifics([root], "Dont think have any Problem withit\n<Search style={{ maxWidth: '200px' }} placeholder=\"Search\" />\n</div>");
  for (const c of r.out.filter((a) => a.op === 'create_node')) { expect(c.content).not.toMatch(/^<Search|^<\/div>/); expect(String(c.title ?? '')).not.toMatch(/^<Search/); }
  const prose = specifics([root], 'Keep the search box at 200px wide, not the full row, so the grid view still fits.');
  const kept = prose.out.filter((a) => a.op === 'create_node');
  expect(kept).toHaveLength(1);
  expect(kept[0].content).toMatch(/200px/);
});

// M526 (android-photos 2026-10-25): an XML declaration and the bare attribute lines of a multi-line tag are code, never the person's row.
test('a pasted XML declaration and attribute lines file no row; a sentence about the encoding still is kept', () => {
  const r = specifics([root], 'Use an android development documentation. A sample blank xml file looks like\n<?xml version="1.0" encoding="utf-8"?>\n<androidx.constraintlayout.widget.ConstraintLayout xmlns:android="http://schemas.android.com/apk/res/android"\n    xmlns:app="http://schemas.android.com/apk/res-auto"\n    android:layout_width="match_parent">');
  for (const c of r.out.filter((a) => a.op === 'create_node')) { expect(c.content).not.toMatch(/^<\?xml|^\s*xmlns:|^\s*android:/); expect(String(c.title ?? '')).not.toMatch(/^<\?xml/); }
  const prose = specifics([root], 'Keep the header 200px tall with encoding="utf-8" declared at the top, the grader rejects anything else.');
  const kept = prose.out.filter((a) => a.op === 'create_node');
  expect(kept).toHaveLength(1);
  expect(kept[0].content).toMatch(/200px/);
});

// M519 (data-platform-zh 2026-10-25): a segment of a dotted package path is not a file name; a real file in prose still is, even before a full stop.
test('a dotted package path yields no file-name specific; a file named in prose is kept', () => {
  const r = specifics([root], 'User class threw exception: org.apache.spark.sql.streaming.StreamingQueryException: Unable to close file because the last block does not have enough number of replicas.');
  expect(r.out.filter((a) => a.op === 'create_node')).toHaveLength(0);
  const missed = r.audits.filter((a) => a.kind === 'guard_specifics_kept').flatMap((a) => a.d.missed as string[]);
  expect(missed).not.toContain('spark.sql');
  const prose = specifics([root], 'Please move the long query into reports.sql, not the notebook, so the grader can read it.');
  const kept = prose.out.filter((a) => a.op === 'create_node');
  expect(kept).toHaveLength(1);
  expect(kept[0].content).toMatch(/reports\.sql/);
  const stop = specifics([root], 'Keep the limits in config.yaml.');
  expect(stop.out.filter((a) => a.op === 'create_node').some((c) => /config\.yaml/.test(c.content))).toBe(true);
});

// M520a (book-links 2026-10-25): a short specifics row keeps its whole content as the title; a long one is cut at a word.
test('a short kept row is titled with its whole content; a long one is cut at a word boundary', () => {
  const r = specifics([root], '"Page Not Found"');
  const kept = r.out.filter((a) => a.op === 'create_node');
  expect(kept).toHaveLength(1);
  expect(kept[0].title).toBe('"Page Not Found"');
  const long = specifics([root], 'The grader said the homographies.txt file must list every pair in order, and that the notebook is not read at all.');
  const k2 = long.out.filter((a) => a.op === 'create_node');
  expect(k2).toHaveLength(1);
  expect(k2[0].title.length).toBeLessThanOrEqual(48);
  expect(k2[0].title).not.toMatch(/\s$/);
  expect(k2[0].content.startsWith(k2[0].title)).toBe(true);
});

// M523 (kotlin-graph 2026-10-25): a C-style comment line is code; her prose question after it is still kept, alone.
test('a // comment line is never the row filed; the prose sentence after it is kept without it', () => {
  const r = specifics([root], '// Monthly: Showing 12 months in a year\nwhy do you think the date is March 14 and May 15, I want it to only show the 12 months of this year.');
  const kept = r.out.filter((a) => a.op === 'create_node');
  expect(kept).toHaveLength(1);
  expect(kept[0].content).not.toMatch(/^\/\//);
  expect(kept[0].content).toMatch(/March 14 and May 15/);
  const r2 = specifics([root], '// Weekly: Showing 4 weeks in a month\nendCalendar.add(Calendar.DATE, 4 * 7 - 1) // Move forward 4 weeks (minus 1 day)');
  expect(r2.out.filter((a) => a.op === 'create_node')).toHaveLength(0);
});

// M524 (save-image-path 2026-10-25): a small count the filer wrote in words is the figure she said in digits — nothing is missed, no row is kept for it.
test('a figure present on the map in words is not a missed specific', () => {
  const onMap = [root, { id: 'd1', parentId: 'p1', content: 'The user spent two weeks completing the image-saving assignment and is now tired of it.', title: 'Assignment duration', status: 'noted', author: 'user', type: 'evidence', createdAt: at, updatedAt: at }];
  const r = specifics(onMap, 'I am too tired of this assignment took me 2 weeks to complete and I still need to prepare report');
  expect(r.out.filter((a) => a.op === 'create_node')).toHaveLength(0);
  const r2 = specifics([root], 'I am too tired of this assignment took me 2 weeks to complete and I still need to prepare report');
  expect(r2.out.filter((a) => a.op === 'create_node')).toHaveLength(1);
});

