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
import { Menubar as MenubarPrimitive } from "@base-ui/react/menubar";
import { cn } from "@/lib/utils";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuPortal, DropdownMenuRadioGroup, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger, } from "@/core/dropdown-menu";
import { CheckIcon } from "lucide-react";
function Menubar(_a) {
    var { className } = _a, props = __rest(_a, ["className"]);
    return (_jsx(MenubarPrimitive, Object.assign({ "data-slot": "menubar", className: cn("flex h-8 items-center gap-0.5 rounded-lg border p-[3px]", className) }, props)));
}
function MenubarMenu(_a) {
    var props = __rest(_a, []);
    return _jsx(DropdownMenu, Object.assign({ "data-slot": "menubar-menu" }, props));
}
function MenubarGroup(_a) {
    var props = __rest(_a, []);
    return _jsx(DropdownMenuGroup, Object.assign({ "data-slot": "menubar-group" }, props));
}
function MenubarPortal(_a) {
    var props = __rest(_a, []);
    return _jsx(DropdownMenuPortal, Object.assign({ "data-slot": "menubar-portal" }, props));
}
function MenubarTrigger(_a) {
    var { className } = _a, props = __rest(_a, ["className"]);
    return (_jsx(DropdownMenuTrigger, Object.assign({ "data-slot": "menubar-trigger", className: cn("flex items-center rounded-sm px-1.5 py-[2px] text-sm font-medium outline-hidden select-none hover:bg-muted aria-expanded:bg-muted", className) }, props)));
}
function MenubarContent(_a) {
    var { className, align = "start", alignOffset = -4, sideOffset = 8 } = _a, props = __rest(_a, ["className", "align", "alignOffset", "sideOffset"]);
    return (_jsx(DropdownMenuContent, Object.assign({ "data-slot": "menubar-content", align: align, alignOffset: alignOffset, sideOffset: sideOffset, className: cn("min-w-36 rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95", className) }, props)));
}
function MenubarItem(_a) {
    var { className, inset, variant = "default" } = _a, props = __rest(_a, ["className", "inset", "variant"]);
    return (_jsx(DropdownMenuItem, Object.assign({ "data-slot": "menubar-item", "data-inset": inset, "data-variant": variant, className: cn("group/menubar-item gap-1.5 rounded-md px-1.5 py-1 text-sm focus:bg-accent focus:text-accent-foreground not-data-[variant=destructive]:focus:**:text-accent-foreground data-inset:pl-7 data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:bg-destructive/10 data-[variant=destructive]:focus:text-destructive dark:data-[variant=destructive]:focus:bg-destructive/20 data-disabled:opacity-50 [&_svg:not([class*='size-'])]:size-4 data-[variant=destructive]:*:[svg]:text-destructive!", className) }, props)));
}
function MenubarCheckboxItem(_a) {
    var { className, children, checked, inset } = _a, props = __rest(_a, ["className", "children", "checked", "inset"]);
    return (_jsxs(MenuPrimitive.CheckboxItem, Object.assign({ "data-slot": "menubar-checkbox-item", "data-inset": inset, className: cn("relative flex cursor-default items-center gap-1.5 rounded-md py-1 pr-1.5 pl-7 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground focus:**:text-accent-foreground data-inset:pl-7 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0", className), checked: checked }, props, { children: [_jsx("span", { className: "pointer-events-none absolute left-1.5 flex size-4 items-center justify-center [&_svg:not([class*='size-'])]:size-4", children: _jsx(MenuPrimitive.CheckboxItemIndicator, { children: _jsx(CheckIcon, {}) }) }), children] })));
}
function MenubarRadioGroup(_a) {
    var props = __rest(_a, []);
    return _jsx(DropdownMenuRadioGroup, Object.assign({ "data-slot": "menubar-radio-group" }, props));
}
function MenubarRadioItem(_a) {
    var { className, children, inset } = _a, props = __rest(_a, ["className", "children", "inset"]);
    return (_jsxs(MenuPrimitive.RadioItem, Object.assign({ "data-slot": "menubar-radio-item", "data-inset": inset, className: cn("relative flex cursor-default items-center gap-1.5 rounded-md py-1 pr-1.5 pl-7 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground focus:**:text-accent-foreground data-inset:pl-7 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4", className) }, props, { children: [_jsx("span", { className: "pointer-events-none absolute left-1.5 flex size-4 items-center justify-center [&_svg:not([class*='size-'])]:size-4", children: _jsx(MenuPrimitive.RadioItemIndicator, { children: _jsx(CheckIcon, {}) }) }), children] })));
}
function MenubarLabel(_a) {
    var { className, inset } = _a, props = __rest(_a, ["className", "inset"]);
    return (_jsx(DropdownMenuLabel, Object.assign({ "data-slot": "menubar-label", "data-inset": inset, className: cn("px-1.5 py-1 text-sm font-medium data-inset:pl-7", className) }, props)));
}
function MenubarSeparator(_a) {
    var { className } = _a, props = __rest(_a, ["className"]);
    return (_jsx(DropdownMenuSeparator, Object.assign({ "data-slot": "menubar-separator", className: cn("-mx-1 my-1 h-px bg-border", className) }, props)));
}
function MenubarShortcut(_a) {
    var { className } = _a, props = __rest(_a, ["className"]);
    return (_jsx(DropdownMenuShortcut, Object.assign({ "data-slot": "menubar-shortcut", className: cn("ml-auto text-xs tracking-widest text-muted-foreground group-focus/menubar-item:text-accent-foreground", className) }, props)));
}
function MenubarSub(_a) {
    var props = __rest(_a, []);
    return _jsx(DropdownMenuSub, Object.assign({ "data-slot": "menubar-sub" }, props));
}
function MenubarSubTrigger(_a) {
    var { className, inset } = _a, props = __rest(_a, ["className", "inset"]);
    return (_jsx(DropdownMenuSubTrigger, Object.assign({ "data-slot": "menubar-sub-trigger", "data-inset": inset, className: cn("gap-1.5 rounded-md px-1.5 py-1 text-sm focus:bg-accent focus:text-accent-foreground data-inset:pl-7 data-open:bg-accent data-open:text-accent-foreground [&_svg:not([class*='size-'])]:size-4", className) }, props)));
}
function MenubarSubContent(_a) {
    var { className } = _a, props = __rest(_a, ["className"]);
    return (_jsx(DropdownMenuSubContent, Object.assign({ "data-slot": "menubar-sub-content", className: cn("min-w-32 rounded-lg bg-popover p-1 text-popover-foreground shadow-lg ring-1 ring-foreground/10 duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95", className) }, props)));
}
export { Menubar, MenubarPortal, MenubarMenu, MenubarTrigger, MenubarContent, MenubarGroup, MenubarSeparator, MenubarLabel, MenubarItem, MenubarShortcut, MenubarCheckboxItem, MenubarRadioGroup, MenubarRadioItem, MenubarSub, MenubarSubTrigger, MenubarSubContent, };
