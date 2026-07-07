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
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import { cn } from "@/lib/utils";
import { ChevronRightIcon, CheckIcon } from "lucide-react";
function DropdownMenu(_a) {
    var props = __rest(_a, []);
    return _jsx(MenuPrimitive.Root, Object.assign({ "data-slot": "dropdown-menu" }, props));
}
function DropdownMenuPortal(_a) {
    var props = __rest(_a, []);
    return _jsx(MenuPrimitive.Portal, Object.assign({ "data-slot": "dropdown-menu-portal" }, props));
}
function DropdownMenuTrigger(_a) {
    var props = __rest(_a, []);
    return _jsx(MenuPrimitive.Trigger, Object.assign({ "data-slot": "dropdown-menu-trigger" }, props));
}
function DropdownMenuContent(_a) {
    var { align = "start", alignOffset = 0, side = "bottom", sideOffset = 4, className } = _a, props = __rest(_a, ["align", "alignOffset", "side", "sideOffset", "className"]);
    return (_jsx(MenuPrimitive.Portal, { children: _jsx(MenuPrimitive.Positioner, { className: "isolate z-50 outline-none", align: align, alignOffset: alignOffset, side: side, sideOffset: sideOffset, children: _jsx(MenuPrimitive.Popup, Object.assign({ "data-slot": "dropdown-menu-content", className: cn("z-50 max-h-(--available-height) w-(--anchor-width) min-w-32 origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 outline-none data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:overflow-hidden data-closed:fade-out-0 data-closed:zoom-out-95", className) }, props)) }) }));
}
function DropdownMenuGroup(_a) {
    var props = __rest(_a, []);
    return _jsx(MenuPrimitive.Group, Object.assign({ "data-slot": "dropdown-menu-group" }, props));
}
function DropdownMenuLabel(_a) {
    var { className, inset } = _a, props = __rest(_a, ["className", "inset"]);
    return (_jsx(MenuPrimitive.GroupLabel, Object.assign({ "data-slot": "dropdown-menu-label", "data-inset": inset, className: cn("px-1.5 py-1 text-xs font-medium text-muted-foreground data-inset:pl-7", className) }, props)));
}
function DropdownMenuItem(_a) {
    var { className, inset, variant = "default" } = _a, props = __rest(_a, ["className", "inset", "variant"]);
    return (_jsx(MenuPrimitive.Item, Object.assign({ "data-slot": "dropdown-menu-item", "data-inset": inset, "data-variant": variant, className: cn("group/dropdown-menu-item relative flex cursor-default items-center gap-1.5 rounded-md px-1.5 py-1 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground not-data-[variant=destructive]:focus:**:text-accent-foreground data-inset:pl-7 data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:bg-destructive/10 data-[variant=destructive]:focus:text-destructive dark:data-[variant=destructive]:focus:bg-destructive/20 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 data-[variant=destructive]:*:[svg]:text-destructive", className) }, props)));
}
function DropdownMenuSub(_a) {
    var props = __rest(_a, []);
    return _jsx(MenuPrimitive.SubmenuRoot, Object.assign({ "data-slot": "dropdown-menu-sub" }, props));
}
function DropdownMenuSubTrigger(_a) {
    var { className, inset, children } = _a, props = __rest(_a, ["className", "inset", "children"]);
    return (_jsxs(MenuPrimitive.SubmenuTrigger, Object.assign({ "data-slot": "dropdown-menu-sub-trigger", "data-inset": inset, className: cn("flex cursor-default items-center gap-1.5 rounded-md px-1.5 py-1 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground not-data-[variant=destructive]:focus:**:text-accent-foreground data-inset:pl-7 data-popup-open:bg-accent data-popup-open:text-accent-foreground data-open:bg-accent data-open:text-accent-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4", className) }, props, { children: [children, _jsx(ChevronRightIcon, { className: "ml-auto" })] })));
}
function DropdownMenuSubContent(_a) {
    var { align = "start", alignOffset = -3, side = "right", sideOffset = 0, className } = _a, props = __rest(_a, ["align", "alignOffset", "side", "sideOffset", "className"]);
    return (_jsx(DropdownMenuContent, Object.assign({ "data-slot": "dropdown-menu-sub-content", className: cn("w-auto min-w-[96px] rounded-lg bg-popover p-1 text-popover-foreground shadow-lg ring-1 ring-foreground/10 duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95", className), align: align, alignOffset: alignOffset, side: side, sideOffset: sideOffset }, props)));
}
function DropdownMenuCheckboxItem(_a) {
    var { className, children, checked, inset } = _a, props = __rest(_a, ["className", "children", "checked", "inset"]);
    return (_jsxs(MenuPrimitive.CheckboxItem, Object.assign({ "data-slot": "dropdown-menu-checkbox-item", "data-inset": inset, className: cn("relative flex cursor-default items-center gap-1.5 rounded-md py-1 pr-8 pl-1.5 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground focus:**:text-accent-foreground data-inset:pl-7 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4", className), checked: checked }, props, { children: [_jsx("span", { className: "pointer-events-none absolute right-2 flex items-center justify-center", "data-slot": "dropdown-menu-checkbox-item-indicator", children: _jsx(MenuPrimitive.CheckboxItemIndicator, { children: _jsx(CheckIcon, {}) }) }), children] })));
}
function DropdownMenuRadioGroup(_a) {
    var props = __rest(_a, []);
    return (_jsx(MenuPrimitive.RadioGroup, Object.assign({ "data-slot": "dropdown-menu-radio-group" }, props)));
}
function DropdownMenuRadioItem(_a) {
    var { className, children, inset } = _a, props = __rest(_a, ["className", "children", "inset"]);
    return (_jsxs(MenuPrimitive.RadioItem, Object.assign({ "data-slot": "dropdown-menu-radio-item", "data-inset": inset, className: cn("relative flex cursor-default items-center gap-1.5 rounded-md py-1 pr-8 pl-1.5 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground focus:**:text-accent-foreground data-inset:pl-7 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4", className) }, props, { children: [_jsx("span", { className: "pointer-events-none absolute right-2 flex items-center justify-center", "data-slot": "dropdown-menu-radio-item-indicator", children: _jsx(MenuPrimitive.RadioItemIndicator, { children: _jsx(CheckIcon, {}) }) }), children] })));
}
function DropdownMenuSeparator(_a) {
    var { className } = _a, props = __rest(_a, ["className"]);
    return (_jsx(MenuPrimitive.Separator, Object.assign({ "data-slot": "dropdown-menu-separator", className: cn("-mx-1 my-1 h-px bg-border", className) }, props)));
}
function DropdownMenuShortcut(_a) {
    var { className } = _a, props = __rest(_a, ["className"]);
    return (_jsx("span", Object.assign({ "data-slot": "dropdown-menu-shortcut", className: cn("ml-auto text-xs tracking-widest text-muted-foreground group-focus/dropdown-menu-item:text-accent-foreground", className) }, props)));
}
export { DropdownMenu, DropdownMenuPortal, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuItem, DropdownMenuCheckboxItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent, };
