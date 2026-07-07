import { jsx as _jsx } from "react/jsx-runtime";
export function ClipKindBadge({ kind }) {
    if (kind === "video") {
        return (_jsx("span", { className: "absolute left-1 top-1 z-20 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-amber-300", children: "VIDEO" }));
    }
    return (_jsx("span", { className: "absolute left-1 top-1 z-20 rounded bg-sky-950/80 px-1.5 py-0.5 text-[10px] font-medium text-sky-200", children: "COLLECTION" }));
}
