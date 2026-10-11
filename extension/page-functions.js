// These functions are serialized into the target execution context.
export function visiblePageText(maxText = 20000) {
  const chunks = [(document.body?.innerText || '').slice(0, maxText)];
  let remaining = maxText - chunks[0].length;
  function visit(root) {
    if (remaining <= 0) return;
    for (const host of root.querySelectorAll('*')) {
      if (!host.shadowRoot || remaining <= 0) continue;
      const walker = document.createTreeWalker(host.shadowRoot, NodeFilter.SHOW_TEXT);
      let node, count = 0, text = '';
      while ((node = walker.nextNode()) && count++ < 10000 && text.length < remaining) {
        const parent = node.parentElement;
        if (!parent || ['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(parent.tagName)) continue;
        const style = getComputedStyle(parent);
        if (style.visibility === 'hidden' || style.display === 'none') continue;
        const range = document.createRange(); range.selectNodeContents(node);
        const bounds = range.getBoundingClientRect();
        if (bounds.width > 0 && bounds.height > 0) text += node.textContent + ' ';
      }
      text = text.slice(0, remaining); chunks.push(text); remaining -= text.length;
      visit(host.shadowRoot);
    }
  }
  visit(document); return chunks.join('\n').slice(0, maxText);
}
export function pageSnapshot({ maxElements = 300, maxText = 20000 } = {}) {
  const state = { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`, elements: new Map(), document };
  globalThis.__ohecoDshSnapshot = state;
  const visible = el => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden' && s.visibility !== 'collapse'; };
  const items = [];
  let total = 0;
  function visit(root) {
    for (const el of root.querySelectorAll('*')) {
      if (el.shadowRoot) visit(el.shadowRoot);
      if (!visible(el) || !el.matches('a[href],button,input,textarea,select,summary,[role],[contenteditable="true"],[tabindex]')) continue;
      total++;
      if (items.length >= maxElements) continue;
      const ref = `${state.id}-e${items.length + 1}`; state.elements.set(ref, el);
      const labels = Array.from(el.labels || []).map(l => l.innerText).join(' ');
      const ids = (el.getAttribute('aria-labelledby') || '').split(/\s+/).map(id => el.getRootNode().getElementById?.(id)?.textContent || '').join(' ');
      const name = (el.getAttribute('aria-label') || ids.trim() || labels || el.innerText || el.getAttribute('alt') || el.getAttribute('title') || el.placeholder || '').replace(/\s+/g, ' ').trim().slice(0, 250);
      const rect = el.getBoundingClientRect();
      const item = { ref, tag: el.tagName.toLowerCase(), role: el.getAttribute('role') || ({ BUTTON: 'button', A: 'link', SELECT: 'combobox', TEXTAREA: 'textbox', INPUT: ['checkbox', 'radio'].includes(el.type) ? el.type : 'textbox' }[el.tagName] || ''), name, disabled: !!el.disabled || el.getAttribute('aria-disabled') === 'true', bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } };
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') { item.inputType = el.type || ''; if (el.type !== 'password') item.value = String(el.value).slice(0, 500); if (['checkbox', 'radio'].includes(el.type)) item.checked = !!el.checked; }
      if (el.tagName === 'SELECT') item.options = Array.from(el.options).slice(0, 100).map(o => ({ value: o.value, label: o.label, selected: o.selected }));
      items.push(item);
    }
  }
  visit(document);
  return { title: document.title, url: location.href, readyState: document.readyState, viewport: { width: innerWidth, height: innerHeight, scrollX, scrollY }, text: visiblePageText(maxText), elements: items, totalElements: total, truncated: total > items.length };
}
export function pageTarget(args) {
  function resolve() {
    if (args.ref) {
      const state = globalThis.__ohecoDshSnapshot;
      const el = state?.document === document && state.elements.get(args.ref);
      if (!el || !el.isConnected) throw new Error('STALE_ELEMENT: Read browser_snapshot again before using this reference.');
      return el;
    }
    if (!args.selector) return null;
    let root = document, el;
    for (const part of args.selector.split('>>>').map(x => x.trim())) {
      if (!root) throw new Error('ELEMENT_NOT_FOUND: Shadow root is unavailable.');
      el = root.querySelector(part); root = el?.shadowRoot;
    }
    if (!el) throw new Error('ELEMENT_NOT_FOUND: No element matches this selector.');
    return el;
  }
  const el = resolve();
  if (!el) throw new Error('ELEMENT_REQUIRED: Specify a ref or selector.');
  if (!args.observe && (el.disabled || el.getAttribute('aria-disabled') === 'true')) throw new Error('ELEMENT_DISABLED: Element is disabled.');
  el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
  const r = el.getBoundingClientRect(), s = getComputedStyle(el);
  if (r.width <= 0 || r.height <= 0 || s.visibility === 'hidden' || s.display === 'none') throw new Error('ELEMENT_HIDDEN: Element is not visible.');
  if (args.focus) el.focus({ preventScroll: true });
  if (args.selectValue !== undefined) {
    if (el.tagName !== 'SELECT') throw new Error('INVALID_ELEMENT: select requires a select element.');
    const option = Array.from(el.options).find(o => o.value === args.selectValue || o.label === args.selectValue);
    if (!option || option.disabled) throw new Error('OPTION_NOT_FOUND: Select option is unavailable.');
    el.value = option.value; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, bounds: { x: r.left, y: r.top, width: r.width, height: r.height }, editable: el.isContentEditable || ['INPUT', 'TEXTAREA'].includes(el.tagName), inputType: el.type || '', selectedValue: el.tagName === 'SELECT' ? el.value : null };
}
export function pageCondition(args) {
  if (args.text !== undefined && !visiblePageText(100000).includes(args.text)) return false;
  if (args.url !== undefined && !location.href.includes(args.url)) return false;
  if (args.ref || args.selector) {
    let el;
    if (args.ref) { const s = globalThis.__ohecoDshSnapshot; if (s?.document !== document || !s.elements.has(args.ref)) throw new Error('STALE_ELEMENT: Read browser_snapshot again before using this reference.'); el = s.elements.get(args.ref); }
    else {
      let root = document;
      for (const part of args.selector.split('>>>').map(x => x.trim())) { el = root?.querySelector(part); root = el?.shadowRoot; }
    }
    const attached = !!el?.isConnected;
    const r = attached ? el.getBoundingClientRect() : null, s = attached ? getComputedStyle(el) : null;
    const visible = attached && r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
    if (args.state === 'hidden' ? visible : args.state === 'attached' ? !attached : !visible) return false;
  }
  return true;
}
