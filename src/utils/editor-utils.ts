import { Editor } from 'obsidian';

export interface TextSelection {
    text: string;
    offset: number;
}

/**
 * Gets the currently selected text from the editor.
 * Returns null if no text is selected.
 */
export function getSelectedText(editor: Editor): TextSelection | null {
    if (editor.somethingSelected()) {
        const text = editor.getSelection();
        const from = editor.getCursor('from');
        const offset = editor.posToOffset(from);
        return { text, offset };
    }
    return null;
}

/**
 * Gets the full text of the document.
 */
export function getFullText(editor: Editor): TextSelection {
    return {
        text: editor.getValue(),
        offset: 0
    };
}
