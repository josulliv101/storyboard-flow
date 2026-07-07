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
import { cn } from "@/lib/utils";
function MessageGroup(_a) {
    var { className } = _a, props = __rest(_a, ["className"]);
    return (_jsx("div", Object.assign({ "data-slot": "message-group", className: cn("flex min-w-0 flex-col gap-2", className) }, props)));
}
function Message(_a) {
    var { className, align = "start" } = _a, props = __rest(_a, ["className", "align"]);
    return (_jsx("div", Object.assign({ "data-slot": "message", "data-align": align, className: cn("group/message relative flex w-full min-w-0 gap-2 text-sm data-[align=end]:flex-row-reverse", className) }, props)));
}
function MessageAvatar(_a) {
    var { className } = _a, props = __rest(_a, ["className"]);
    return (_jsx("div", Object.assign({ "data-slot": "message-avatar", className: cn("flex w-fit min-w-8 shrink-0 items-center justify-center self-end overflow-hidden rounded-full bg-muted group-has-data-[slot=message-footer]/message:-translate-y-8", className) }, props)));
}
function MessageContent(_a) {
    var { className } = _a, props = __rest(_a, ["className"]);
    return (_jsx("div", Object.assign({ "data-slot": "message-content", className: cn("flex w-full min-w-0 flex-col gap-2.5 wrap-break-word group-data-[align=end]/message:*:data-slot:self-end", className) }, props)));
}
function MessageHeader(_a) {
    var { className } = _a, props = __rest(_a, ["className"]);
    return (_jsx("div", Object.assign({ "data-slot": "message-header", className: cn("flex max-w-full min-w-0 items-center px-3 text-xs font-medium text-muted-foreground group-has-data-[variant=ghost]/message:px-0", className) }, props)));
}
function MessageFooter(_a) {
    var { className } = _a, props = __rest(_a, ["className"]);
    return (_jsx("div", Object.assign({ "data-slot": "message-footer", className: cn("flex max-w-full min-w-0 items-center px-3 text-xs font-medium text-muted-foreground group-has-data-[variant=ghost]/message:px-0 group-data-[align=end]/message:justify-end", className) }, props)));
}
export { MessageGroup, Message, MessageAvatar, MessageContent, MessageFooter, MessageHeader, };
