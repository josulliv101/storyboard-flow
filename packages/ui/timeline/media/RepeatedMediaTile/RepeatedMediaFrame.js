import { jsx as _jsx } from "react/jsx-runtime";
import { cva } from "class-variance-authority";
import { handleImageFallback } from "./image-fallback";
const repeatedMediaFrameVariant = cva("relative shrink-0 overflow-hidden", {
    variants: {
        variant: {
            default: "border-r border-black/35 bg-black last:border-r-0",
            unstyled: "",
        },
    },
    defaultVariants: {
        variant: "default",
    },
});
export function RepeatedMediaFrame({ src, alt, fallbackSrc, frameWidth, frameHeight, variant, }) {
    return (_jsx("div", { className: repeatedMediaFrameVariant({ variant }), style: { width: `${frameWidth}px`, height: `${frameHeight}px` }, children: _jsx("div", { className: "h-full w-full", children: _jsx("img", { src: src, alt: alt, className: "h-full w-full object-cover", draggable: false, onError: fallbackSrc
                    ? (event) => handleImageFallback(event, fallbackSrc)
                    : undefined }) }) }));
}
