/**
 * Antigravity 2.0 Desktop UI Translation Engine
 * Non-invasive, high-performance, real-time DOM localization observer.
 */

import { lookupTranslation, UI_DYNAMIC_RULES, EXCLUSION_SELECTORS } from './antigravity-ui-dict';
import { EVENT_LANGUAGE_CHANGED } from '../../../../src/injection-contract.cjs';

export type UILanguage = 'en' | 'zh';

const STORAGE_KEY = 'antigravity-stats-lang';

export class AntigravityUITranslator {
  private observer: MutationObserver | null = null;
  private isTranslating = false;
  private currentLang: UILanguage = 'en';
  private originalTextStore = new WeakMap<Node, { original: string; translated: string }>();
  private originalAttrStore = new WeakMap<Element, Record<string, { original: string; translated: string }>>();
  private excludedSelectorCombined = EXCLUSION_SELECTORS.join(', ');

  constructor() {
    this.currentLang = this.detectSavedLanguage();
  }

  public detectSavedLanguage(): UILanguage {
    if (typeof window === 'undefined') return 'en';
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'zh' || saved === 'en') return saved;
    const navLang = navigator.language?.toLowerCase();
    if (navLang?.startsWith('zh')) return 'zh';
    return 'en';
  }

  public getLanguage(): UILanguage {
    return this.currentLang;
  }

  public setLanguage(lang: UILanguage): void {
    if (this.currentLang === lang && this.observer) return;
    this.currentLang = lang;
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, lang);
    }
    if (lang === 'zh') {
      this.start();
    } else {
      this.stop();
    }
    // Dispatch synchronization event for any listening UI components
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(EVENT_LANGUAGE_CHANGED, { detail: { lang } }));
    }
  }

  public toggle(): void {
    this.setLanguage(this.currentLang === 'zh' ? 'en' : 'zh');
  }

  public start(): void {
    if (typeof document === 'undefined') return;

    if (!this.observer) {
      this.observer = new MutationObserver((mutations) => {
        if (this.isTranslating) return;
        this.handleMutations(mutations);
      });
    }

    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['placeholder', 'aria-label', 'title']
    });

    this.translateSubtree(document.body);
  }

  public stop(): void {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    this.revertSubtree(document.body);
  }

  private isExcluded(node: Node | null): boolean {
    if (!node) return true;
    const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
    if (!el) return false;
    try {
      if (el.matches(this.excludedSelectorCombined)) return true;
      if (el.closest(this.excludedSelectorCombined)) return true;
    } catch {
      // Ignore selector errors
    }
    return false;
  }

  public translateText(rawText: string): string | null {
    const trimmed = rawText.trim();
    if (!trimmed) return null;

    // 1. Exact match (case-insensitive fallback for sentence-case variants)
    const translated = lookupTranslation(trimmed);
    if (translated) {
      if (rawText === trimmed) return translated;
      // Preserve original surrounding whitespace
      const matchLeading = rawText.match(/^\s*/)?.[0] || '';
      const matchTrailing = rawText.match(/\s*$/)?.[0] || '';
      return `${matchLeading}${translated}${matchTrailing}`;
    }

    // 2. Dynamic pattern matching
    for (const rule of UI_DYNAMIC_RULES) {
      if (rule.pattern.test(trimmed)) {
        // @ts-expect-error String replace signature
        const replaced = trimmed.replace(rule.pattern, rule.replace);
        if (rawText === trimmed) return replaced;
        const matchLeading = rawText.match(/^\s*/)?.[0] || '';
        const matchTrailing = rawText.match(/\s*$/)?.[0] || '';
        return `${matchLeading}${replaced}${matchTrailing}`;
      }
    }

    return null;
  }

  private hasAdjacentTextSibling(node: Text): boolean {
    return (
      node.previousSibling?.nodeType === Node.TEXT_NODE ||
      node.nextSibling?.nodeType === Node.TEXT_NODE
    );
  }

  private collectTextRun(node: Text): Text[] {
    let first: Node = node;
    while (first.previousSibling?.nodeType === Node.TEXT_NODE) {
      first = first.previousSibling;
    }
    const run: Text[] = [];
    let curr: Node | null = first;
    while (curr && curr.nodeType === Node.TEXT_NODE) {
      run.push(curr as Text);
      curr = curr.nextSibling;
    }
    return run;
  }

  // React renders JSX interpolations like `No {type} yet` as adjacent Text siblings.
  // Translate the joined run as one sentence and keep every Text node in place for React reconciliation.
  private translateTextRun(run: Text[]): void {
    const originals = run.map((node) => {
      const currentVal = node.nodeValue || '';
      const stored = this.originalTextStore.get(node);
      return stored && stored.translated === currentVal ? stored.original : currentVal;
    });

    const rawCombined = originals.join('');
    const translated = rawCombined.trim() ? this.translateText(rawCombined) : null;

    if (!translated || translated === rawCombined) {
      for (const node of run) {
        const currentVal = node.nodeValue || '';
        const stored = this.originalTextStore.get(node);
        if (!stored) continue;
        if (stored.translated === currentVal) {
          node.nodeValue = stored.original;
        }
        this.originalTextStore.delete(node);
      }
      return;
    }

    for (let i = 0; i < run.length; i++) {
      const node = run[i];
      const targetVal = i === 0 ? translated : '';
      this.originalTextStore.set(node, { original: originals[i], translated: targetVal });
      if (node.nodeValue !== targetVal) {
        node.nodeValue = targetVal;
      }
    }
  }

  private translateTextNode(node: Text): void {
    if (this.isExcluded(node)) return;

    if (this.hasAdjacentTextSibling(node)) {
      this.translateTextRun(this.collectTextRun(node));
      return;
    }

    const currentVal = node.nodeValue || '';
    if (!currentVal.trim()) return;

    // Check if translation is needed
    const translated = this.translateText(currentVal);
    const stored = this.originalTextStore.get(node);
    if (!translated || translated === currentVal) {
      // The host replaced our translation with its own text; a stale original must not survive a revert.
      if (stored && stored.translated !== currentVal) this.originalTextStore.delete(node);
      return;
    }

    // Refresh the record when the host authored new text, keep it when this value is our own output.
    if (!stored || stored.translated !== currentVal) {
      this.originalTextStore.set(node, { original: currentVal, translated });
    }

    node.nodeValue = translated;
  }

  private translateAttributes(el: Element): void {
    if (this.isExcluded(el)) return;

    const attrs = ['placeholder', 'aria-label', 'title'] as const;
    let stored = this.originalAttrStore.get(el);

    for (const attr of attrs) {
      const val = el.getAttribute(attr);
      if (!val || !val.trim()) continue;
      const translated = this.translateText(val);
      const record = stored?.[attr];
      if (!translated || translated === val) {
        if (record && record.translated !== val) delete stored![attr];
        continue;
      }
      if (!record || record.translated !== val) {
        if (!stored) {
          stored = {};
          this.originalAttrStore.set(el, stored);
        }
        stored[attr] = { original: val, translated };
      }
      el.setAttribute(attr, translated);
    }
  }

  private translateSubtreeInner(root: Node): void {
    if (this.isExcluded(root)) return;

    if (root.nodeType === Node.TEXT_NODE) {
      this.translateTextNode(root as Text);
      return;
    }

    if (root.nodeType === Node.ELEMENT_NODE) {
      this.translateAttributes(root as Element);
    }

    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
      {
        acceptNode: (node) => {
          if (this.isExcluded(node)) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    let curr = walker.nextNode();
    while (curr) {
      if (curr.nodeType === Node.TEXT_NODE) {
        if (curr.previousSibling?.nodeType !== Node.TEXT_NODE) {
          this.translateTextNode(curr as Text);
        }
      } else if (curr.nodeType === Node.ELEMENT_NODE) {
        this.translateAttributes(curr as Element);
      }
      curr = walker.nextNode();
    }
  }

  public translateSubtree(root: Node): void {
    if (this.isExcluded(root)) return;

    this.isTranslating = true;
    try {
      this.translateSubtreeInner(root);
    } finally {
      this.observer?.takeRecords?.();
      this.isTranslating = false;
    }
  }

  public revertSubtree(root: Node): void {
    this.isTranslating = true;
    try {
      const walker = document.createTreeWalker(
        root,
        NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT
      );

      let curr = walker.nextNode();
      while (curr) {
        if (curr.nodeType === Node.TEXT_NODE) {
          const textNode = curr as Text;
          const currentVal = textNode.nodeValue || '';
          const original = this.originalTextStore.get(textNode)?.original;
          if (original !== undefined && original !== currentVal) {
            textNode.nodeValue = original;
          }
        } else if (curr.nodeType === Node.ELEMENT_NODE) {
          const el = curr as Element;
          const origAttrs = this.originalAttrStore.get(el);
          const attrs = ['placeholder', 'aria-label', 'title'] as const;
          for (const attr of attrs) {
            const currentVal = el.getAttribute(attr);
            if (!currentVal) continue;
            const original = origAttrs?.[attr]?.original;
            if (original !== undefined && original !== currentVal) {
              el.setAttribute(attr, original);
            }
          }
        }
        curr = walker.nextNode();
      }
    } finally {
      this.observer?.takeRecords?.();
      this.isTranslating = false;
    }
  }

  private handleMutations(mutations: MutationRecord[]): void {
    this.isTranslating = true;
    try {
      for (const mutation of mutations) {
        if (mutation.type === 'characterData' && mutation.target.nodeType === Node.TEXT_NODE) {
          const textNode = mutation.target as Text;
          this.originalTextStore.delete(textNode);
          this.translateTextNode(textNode);
        } else if (mutation.type === 'attributes' && mutation.target.nodeType === Node.ELEMENT_NODE) {
          this.translateAttributes(mutation.target as Element);
        } else if (mutation.type === 'childList') {
          const hasRemovedText = Array.from(mutation.removedNodes).some(
            (n) => n.nodeType === Node.TEXT_NODE
          );
          if (
            hasRemovedText &&
            mutation.target.nodeType === Node.ELEMENT_NODE &&
            !this.isExcluded(mutation.target)
          ) {
            mutation.target.childNodes.forEach((child) => {
              if (child.nodeType !== Node.TEXT_NODE) return;
              const textChild = child as Text;
              const stored = this.originalTextStore.get(textChild);
              if (stored && stored.translated === (textChild.nodeValue || '')) {
                textChild.nodeValue = stored.original;
                this.originalTextStore.delete(textChild);
              }
            });
            mutation.target.childNodes.forEach((child) => {
              if (child.nodeType === Node.TEXT_NODE && child.previousSibling?.nodeType !== Node.TEXT_NODE) {
                this.translateTextNode(child as Text);
              }
            });
          } else {
            mutation.addedNodes.forEach((node) => {
              this.translateSubtreeInner(node);
            });
          }
        }
      }
    } finally {
      this.observer?.takeRecords?.();
      this.isTranslating = false;
    }
  }
}

// Global singleton instance
export const antigravityI18n = new AntigravityUITranslator();

// Expose on window for easy external access, keyboard shortcuts and debugging
if (typeof window !== 'undefined') {
  (window as unknown as { AntigravityI18n: AntigravityUITranslator }).AntigravityI18n = antigravityI18n;
}
