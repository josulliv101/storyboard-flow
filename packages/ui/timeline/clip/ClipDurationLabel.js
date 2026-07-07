import { jsx as _jsx } from "react/jsx-runtime";
import { formatSeconds } from "../utils";
export function ClipDurationLabel({ clip }) {
    if (clip.kind === "collection")
        return null;
    const label = clip.kind === "video"
        ? `${formatSeconds(clip.duration)} / ${formatSeconds(clip.sourceDuration)}`
        : formatSeconds(clip.duration);
    return (_jsx("span", { className: "absolute bottom-1 right-1 z-20 rounded bg-black/60 px-1.5 py-0.5 font-mono text-[10px] text-zinc-100", children: label }));
}
