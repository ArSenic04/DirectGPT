/**
 * Shared document editor (Figure 1, steps 1–2): CodeMirror 6 bound to the
 * room's Y.Text with live remote cursors/selections (y-codemirror.next) and
 * decorations that show every collaborator's pending AI request on the
 * anchored text, plus provenance underlines for accepted AI edits.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { EditorState, StateEffect, StateField, Compartment, type Extension } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, drawSelection, keymap, placeholder, type DecorationSet } from '@codemirror/view';
import { defaultKeymap } from '@codemirror/commands';
import * as Y from 'yjs';
import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next';
import type { Awareness } from 'y-protocols/awareness';

export interface RequestMark {
  id: string;
  from: number;
  to: number;
  color: string;
  label: string;
  kind: 'generating' | 'pending' | 'conflicted' | 'accepted';
  title: string;
}

export interface EditorApi {
  getSelection: () => { from: number; to: number };
  setSelection: (from: number, to: number) => void;
  focus: () => void;
}

interface EditorProps {
  ytext: Y.Text;
  awareness: Awareness;
  undoManager: Y.UndoManager;
  marks: RequestMark[];
  readOnly: boolean;
  onSelectionChange: (from: number, to: number) => void;
  onPaste: (text: string, replacedLength: number) => void;
  onMarkClick: (requestId: string) => void;
}

const setMarksEffect = StateEffect.define<RequestMark[]>();

class LabelWidget extends WidgetType {
  constructor(readonly mark: RequestMark) {
    super();
  }
  eq(other: LabelWidget) {
    return other.mark.id === this.mark.id && other.mark.label === this.mark.label && other.mark.kind === this.mark.kind && other.mark.color === this.mark.color;
  }
  toDOM() {
    const el = document.createElement('span');
    el.className = `cdg-mark-label cdg-mark-label-${this.mark.kind}`;
    el.style.backgroundColor = this.mark.color;
    el.textContent = this.mark.label;
    el.title = this.mark.title;
    el.setAttribute('data-request-id', this.mark.id);
    el.setAttribute('aria-label', this.mark.title);
    return el;
  }
  ignoreEvent() {
    return false;
  }
}

function buildDecorations(marks: RequestMark[], docLength: number): DecorationSet {
  const items: Array<{ from: number; to: number; deco: Decoration }> = [];
  for (const m of marks) {
    const from = Math.max(0, Math.min(m.from, docLength));
    const to = Math.max(from, Math.min(m.to, docLength));
    if (m.kind !== 'accepted') {
      items.push({ from, to: from, deco: Decoration.widget({ widget: new LabelWidget(m), side: -1 }) });
    }
    if (to > from) {
      items.push({
        from,
        to,
        deco: Decoration.mark({
          class: `cdg-mark cdg-mark-${m.kind}`,
          attributes: {
            style: m.kind === 'accepted' ? `text-decoration-color: ${m.color}` : `background-color: ${m.color}2e; box-shadow: inset 0 -2px 0 ${m.color}`,
            'data-request-id': m.id,
            title: m.title,
          },
        }),
      });
    }
  }
  return Decoration.set(items.map((it) => it.deco.range(it.from, it.to)), true);
}

const marksField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    let next = value.map(tr.changes);
    for (const e of tr.effects) if (e.is(setMarksEffect)) next = buildDecorations(e.value, tr.state.doc.length);
    return next;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const theme = EditorView.theme({
  '&': { height: '100%', fontSize: '17px', backgroundColor: '#fff' },
  '.cm-scroller': { fontFamily: "Georgia, 'Times New Roman', serif", lineHeight: '1.7', padding: '24px 0' },
  '.cm-content': { maxWidth: '760px', margin: '0 auto', padding: '0 32px', caretColor: '#111' },
  '&.cm-focused': { outline: 'none' },
  '.cm-selectionBackground': { backgroundColor: '#bfdbfe !important' },
  '&:not(.cm-focused) .cm-selectionBackground': { backgroundColor: '#dbeafe !important' },
  '.cm-ySelectionInfo': { fontFamily: 'system-ui, sans-serif', fontSize: '11px', opacity: '1', padding: '1px 4px', borderRadius: '3px', top: '-1.25em' },
});

export const Editor = forwardRef<EditorApi, EditorProps>(function Editor(props, ref) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const readOnlyCompartment = useRef(new Compartment());
  const callbacks = useRef(props);
  callbacks.current = props;

  useImperativeHandle(ref, () => ({
    getSelection: () => {
      const sel = viewRef.current?.state.selection.main;
      return sel ? { from: sel.from, to: sel.to } : { from: 0, to: 0 };
    },
    setSelection: (from, to) => {
      const view = viewRef.current;
      if (!view) return;
      const len = view.state.doc.length;
      view.dispatch({ selection: { anchor: Math.min(from, len), head: Math.min(to, len) }, scrollIntoView: true });
    },
    focus: () => viewRef.current?.focus(),
  }));

  useEffect(() => {
    if (!host.current) return;
    const extensions: Extension[] = [
      keymap.of([...yUndoManagerKeymap, ...defaultKeymap]),
      drawSelection(),
      EditorView.lineWrapping,
      placeholder('The document is empty.'),
      theme,
      marksField,
      readOnlyCompartment.current.of([EditorState.readOnly.of(props.readOnly), EditorView.editable.of(!props.readOnly)]),
      yCollab(props.ytext, props.awareness, { undoManager: props.undoManager }),
      EditorView.updateListener.of((update) => {
        if (update.selectionSet || update.docChanged) {
          const sel = update.state.selection.main;
          callbacks.current.onSelectionChange(sel.from, sel.to);
        }
        for (const tr of update.transactions) {
          if (tr.isUserEvent('input.paste')) {
            let pasted = '';
            let replaced = 0;
            tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
              pasted += inserted.toString();
              replaced += toA - fromA;
            });
            callbacks.current.onPaste(pasted, replaced);
          }
        }
      }),
      EditorView.domEventHandlers({
        mousedown(event) {
          const target = event.target as HTMLElement | null;
          const label = target?.closest?.('.cdg-mark-label');
          if (label) {
            const id = label.getAttribute('data-request-id');
            if (id) {
              event.preventDefault();
              callbacks.current.onMarkClick(id);
              return true;
            }
          }
          return false;
        },
      }),
      EditorView.contentAttributes.of({ 'aria-label': 'Shared document', 'data-testid': 'editor-content' }),
    ];
    const view = new EditorView({
      state: EditorState.create({ doc: props.ytext.toString(), extensions }),
      parent: host.current,
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // The editor is created once per Y.Text; other props are read through refs/effects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.ytext, props.awareness, props.undoManager]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: readOnlyCompartment.current.reconfigure([EditorState.readOnly.of(props.readOnly), EditorView.editable.of(!props.readOnly)]),
    });
  }, [props.readOnly]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: setMarksEffect.of(props.marks) });
  }, [props.marks]);

  return <div className="cdg-editor" ref={host} data-testid="editor" />;
});
