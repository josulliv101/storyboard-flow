var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
import { jsx as _jsx } from "react/jsx-runtime";
import { Avatar as AvatarPrimitive } from "@base-ui/react/avatar";
import { cn } from "@/lib/utils";
function Avatar(_a) {
    var { className, size = "default" } = _a, props = __rest(_a, ["className", "size"]);
    return (_jsx(AvatarPrimitive.Root, Object.assign({ "data-slot": "avatar", "data-size": size, className: cn("group/avatar relative flex size-8 shrink-0 rounded-full select-none after:absolute after:inset-0 after:rounded-full after:border after:border-border after:mix-blend-darken data-[size=lg]:size-10 data-[size=sm]:size-6 dark:after:mix-blend-lighten", className) }, props)));
}
function AvatarImage(_a) {
    var { className } = _a, props = __rest(_a, ["className"]);
    return (_jsx(AvatarPrimitive.Image, Object.assign({ "data-slot": "avatar-image", className: cn("aspect-square size-full rounded-full object-cover", className) }, props)));
}
function AvatarFallback(_a) {
    var { className } = _a, props = __rest(_a, ["className"]);
    return (_jsx(AvatarPrimitive.Fallback, Object.assign({ "data-slot": "avatar-fallback", className: cn("flex size-full items-center justify-center rounded-full bg-muted text-sm text-muted-foreground group-data-[size=sm]/avatar:text-xs", className) }, props)));
}
function AvatarBadge(_a) {
    var { className } = _a, props = __rest(_a, ["className"]);
    return (_jsx("span", Object.assign({ "data-slot": "avatar-badge", className: cn("absolute right-0 bottom-0 z-10 inline-flex items-center justify-center rounded-full bg-primary text-primary-foreground bg-blend-color ring-2 ring-background select-none", "group-data-[size=sm]/avatar:size-2 group-data-[size=sm]/avatar:[&>svg]:hidden", "group-data-[size=default]/avatar:size-2.5 group-data-[size=default]/avatar:[&>svg]:size-2", "group-data-[size=lg]/avatar:size-3 group-data-[size=lg]/avatar:[&>svg]:size-2", className) }, props)));
}
function AvatarGroup(_a) {
    var { className } = _a, props = __rest(_a, ["className"]);
    return (_jsx("div", Object.assign({ "data-slot": "avatar-group", className: cn("group/avatar-group flex -space-x-2 *:data-[slot=avatar]:ring-2 *:data-[slot=avatar]:ring-background", className) }, props)));
}
function AvatarGroupCount(_a) {
    var { className } = _a, props = __rest(_a, ["className"]);
    return (_jsx("div", Object.assign({ "data-slot": "avatar-group-count", className: cn("relative flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-sm text-muted-foreground ring-2 ring-background group-has-data-[size=lg]/avatar-group:size-10 group-has-data-[size=sm]/avatar-group:size-6 [&>svg]:size-4 group-has-data-[size=lg]/avatar-group:[&>svg]:size-5 group-has-data-[size=sm]/avatar-group:[&>svg]:size-3", className) }, props)));
}
export { Avatar, AvatarImage, AvatarFallback, AvatarGroup, AvatarGroupCount, AvatarBadge, };
