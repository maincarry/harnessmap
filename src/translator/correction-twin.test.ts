// dropCorrectionTwins (M253/M256): a decision/constraint created in the same round as a statement rewrite is dropped only when it
// RESTATES the rewritten text (≥60% of its rare words, at least two, already there). 2026-10-05 loop find: the tokenizer saw no
// Chinese words at all, so Chinese constraints were judged on their Latin identifiers alone and dropped as twins.
import { describe, expect, test } from 'bun:test';
import { dropCorrectionTwins } from './translator';

const run = (alts: any[], nodes: { title?: string | null; content: string }[]) => { const audits: any[] = []; const out = dropCorrectionTwins(alts, nodes, (d) => audits.push(d)); return { out, audits }; };
const map = (...contents: string[]) => contents.map((content, i) => ({ title: `n${i}`, content }));

describe('dropCorrectionTwins', () => {
  test('Chinese constraint with its own words survives a rewrite that shares only the identifier (scene-detect-zh field case)', () => {
    const nodes = map('ffmpeg-scene-change-detector 是一个场景切换检测项目。', '视频处理流程', '输出格式要求', '命令行参数说明', '安装步骤');
    const alts = [
      { op: 'update_node', id: 'x', content: 'ffmpeg-scene-change-detector 的最新网址是 https://github.com/EnriqueMoraga/ffmpeg-scene-change-detector。该项目提供基于 FFmpeg 命令行的视频场景切换检测工具。' },
      { op: 'create_node', id: 'c1', type: 'constraint', content: '使用 ffmpeg-scene-change-detector 需要基本的编程、命令行和 FFmpeg 知识。' },
    ];
    const { out, audits } = run(alts, nodes);
    expect(out).toHaveLength(2);
    expect(audits).toHaveLength(0);
  });
  test('a Chinese constraint that merely restates the rewritten statement is still dropped', () => {
    const nodes = map('ffmpeg-scene-change-detector 是一个场景切换检测项目。', '视频处理流程', '输出格式要求', '命令行参数说明', '安装步骤');
    const alts = [
      { op: 'update_node', id: 'x', content: '该项目提供基于 FFmpeg 命令行的视频场景切换检测工具。' },
      { op: 'create_node', id: 'c1', type: 'decision', content: '基于 FFmpeg 命令行的视频场景切换检测工具。' },
    ];
    const { out, audits } = run(alts, nodes);
    expect(out).toHaveLength(1);
    expect(audits).toHaveLength(1);
    expect(audits[0].rewrote).toBe('x');
  });
  test('M256 control: an English commitment with its own words survives, an English restatement is dropped', () => {
    const nodes = map('This session has command tools available.', 'Project setup', 'Testing plan', 'Deployment notes', 'Open questions');
    const kept = run([
      { op: 'update_node', id: 'x', content: 'This session has command tools and file access.' },
      { op: 'create_node', id: 'c1', type: 'constraint', content: 'Ask for approval before deleting files.' },
    ], nodes);
    expect(kept.out).toHaveLength(2);
    const dropped = run([
      { op: 'update_node', id: 'x', content: 'Deploy only after the integration tests pass on the staging cluster.' },
      { op: 'create_node', id: 'c1', type: 'decision', content: 'Deployment happens after integration tests pass on staging.' },
    ], nodes);
    expect(dropped.out).toHaveLength(1);
    expect(dropped.audits[0].dropped).toContain('Deployment happens');
  });
});
