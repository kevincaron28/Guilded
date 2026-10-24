import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

// Exercise the real submit handlers with a minimal document. The browser fixture separately
// checks translated rendering, editable drafts and the browser's native inert behavior.
function harness() {
  const nodes = new Map<string, { value: string; hidden: boolean; disabled: boolean; inert: boolean; textContent: string; className: string; handlers: Record<string, (...args: unknown[]) => unknown>; addEventListener: (name: string, cb: (...args: unknown[]) => unknown) => void; replaceChildren: () => void }>();
  const node = (id: string) => {
    if (!nodes.has(id)) nodes.set(id, { value: '', hidden: false, disabled: false, inert: false, textContent: '', className: '', handlers: {}, addEventListener(name, cb) { this.handlers[name] = cb; }, replaceChildren() {} });
    return nodes.get(id)!;
  };
  const manageView = vi.fn().mockResolvedValue({ ok: true, data: { itemNames: [], characters: [], cores: [], coreLootOnly: true } });
  const manageEdit = vi.fn().mockResolvedValue({ ok: false, error: 'Refused' });
  runInNewContext(readFileSync('companion-app/renderer/manage.js', 'utf8'), {
    window: { companion: { manageView, manageEdit }, companionLanguage: { t: (s: string) => s, message: (s: string) => s } },
    document: { getElementById: node, querySelectorAll: () => [], addEventListener: vi.fn() },
    location: { search: '' }, URLSearchParams
  });
  const load = () => node('btnCoreReload').handlers['click']!();
  const submit = () => node('priceAdd').handlers['submit']!({ preventDefault() {}, submitter: node('save') });
  return { node, manageView, manageEdit, load, submit };
}

describe('management save recovery', () => {
  it('does not reload or clear the draft after a refused save', async () => {
    const h = harness(); await h.load(); h.node('priceItem').value = 'Sulfuras'; h.node('priceGp').value = '777';
    await h.submit();
    expect(h.manageView).toHaveBeenCalledTimes(1);
    expect(h.node('priceGp').value).toBe('777');
    expect(h.node('coreNotice').textContent).toBe('Refused');
    expect(h.node('corePanels').inert).toBe(false);
  });
  it('handles a disconnected save without losing the draft or leaving controls locked', async () => {
    const h = harness(); await h.load(); h.node('priceGp').value = '777';
    h.manageEdit.mockRejectedValue(new Error('Disconnected'));
    await h.submit();
    expect(h.node('priceGp').value).toBe('777');
    expect(h.node('coreNotice').textContent).toContain('Could not confirm');
    expect(h.node('save').disabled).toBe(false);
    expect(h.node('corePanels').inert).toBe(false);
    expect(h.manageView).toHaveBeenCalledTimes(1);
  });
  it('blocks overlapping edits and reloads until the pending edit finishes', async () => {
    const h = harness(); await h.load();
    let finish!: (value: unknown) => void;
    h.manageEdit.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const pending = h.submit();
    expect(h.node('corePanels').inert).toBe(true);
    expect(h.node('wishPanel').inert).toBe(true);
    expect(h.node('btnCoreReload').disabled).toBe(true);
    await h.submit(); await h.load();
    expect(h.manageEdit).toHaveBeenCalledTimes(1);
    expect(h.manageView).toHaveBeenCalledTimes(1);
    finish({ ok: false, error: 'Refused' }); await pending;
    expect(h.node('btnCoreReload').disabled).toBe(false);
  });
  it('refreshes after confirmed success and clears only the submitted new-price fields', async () => {
    const h = harness(); await h.load(); h.node('priceItem').value = 'Sulfuras'; h.node('priceGp').value = '777';
    h.manageEdit.mockResolvedValue({ ok: true, data: { message: 'Saved.' } });
    await h.submit();
    expect(h.manageView).toHaveBeenCalledTimes(2);
    expect(h.node('priceItem').value).toBe('');
    expect(h.node('priceGp').value).toBe('');
  });
  it('shows a recoverable load error and allows a later reload', async () => {
    const h = harness(); h.manageView.mockRejectedValueOnce(new Error('Disconnected'));
    await h.load();
    expect(h.node('coreNotice').textContent).toContain('try Reload');
    await h.load(); expect(h.manageView).toHaveBeenCalledTimes(2);
  });
});
