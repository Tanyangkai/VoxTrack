import { StateField, StateEffect } from "@codemirror/state";
import { EditorView, Decoration, DecorationSet } from "@codemirror/view";

// Define the effect to update the active range
export const setActiveRange = StateEffect.define<{ from: number, to: number } | null>();

// Define the decoration implementation
const activeWordMark = Decoration.mark({ class: "voxtrack-active-word" });

export const activeWordField = StateField.define<DecorationSet>({
    create() {
        return Decoration.none;
    },
    update(decorations, tr) {
        decorations = decorations.map(tr.changes);

        for (const e of tr.effects) {
            if (e.is(setActiveRange)) {
                if (e.value) {
                    decorations = Decoration.set([
                        activeWordMark.range(e.value.from, e.value.to)
                    ]);
                } else {
                    decorations = Decoration.none;
                }
            }
        }
        return decorations;
    },
    provide: f => EditorView.decorations.from(f)
});
