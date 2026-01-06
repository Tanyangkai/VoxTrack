import { Extension } from "@codemirror/state";
import { activeWordField } from "./decorations";

export function voxTrackExtensions(): Extension[] {
    return [
        activeWordField,
        // Any other extensions like event listeners or theme overrides can go here
    ];
}
