/**
 * Kage A9d-1 I-3: E4 deleted the mobile-tab re-pin, the only caller of ChatLog's imperative `scrollToBottom`, and left
 * the handle (ChatLogHandle, StoryLog's forwardRef, useTranscript's chatLogRef, page.tsx's `ref`) and Drawer's
 * `className` behind: declared fields with no reader. They are deleted (A9d-2); this keeps them deleted.
 */
import fs from 'node:fs';
import path from 'node:path';

const walk = (dir: string, out: string[] = []): string[] => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== '__tests__') walk(p, out); } else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
};
const code = (p: string) => fs.readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const files = walk(path.resolve(process.cwd(), 'src'));

describe('dead imperative-handle API stays deleted', () => {
  it.each([
    ['ChatLogHandle', /\bChatLogHandle\b/],
    ['chatLogRef', /\bchatLogRef\b/],
    ['useImperativeHandle', /\buseImperativeHandle\b/],
    ['scrollToBottom', /\bscrollToBottom\b/],
  ])('no source file uses %s', (_n, re) => {
    expect(files.filter((f) => re.test(code(f))).map((f) => path.relative(process.cwd(), f))).toEqual([]);
  });

  it('control: the scanner sees a real use (ChatLog.tsx uses useLayoutEffect)', () => {
    expect(code(path.resolve(process.cwd(), 'src/components/ChatLog.tsx'))).toMatch(/useLayoutEffect/);
  });

  it('Drawer takes no caller class: <Drawer ... className> has no reader', () => {
    expect(code(path.resolve(process.cwd(), 'src/components/Drawer.tsx'))).not.toMatch(/\bclassName\?:|className \?\? /);
  });
});
