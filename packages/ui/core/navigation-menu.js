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
import { NavigationMenu as NavigationMenuPrimitive } from "@base-ui/react/navigation-menu";
import { cva } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { ChevronDownIcon } from "lucide-react";
function NavigationMenu(_a) {
    var { align = "start", className, children } = _a, props = __rest(_a, ["align", "className", "children"]);
    return (_jsxs(NavigationMenuPrimitive.Root, Object.assign({ "data-slot": "navigation-menu", className: cn("group/navigation-menu relative flex max-w-max flex-1 items-center justify-center", className) }, props, { children: [children, _jsx(NavigationMenuPositioner, { align: align })] })));
}
function NavigationMenuList(_a) {
    var { className } = _a, props = __rest(_a, ["className"]);
    return (_jsx(NavigationMenuPrimitive.List, Object.assign({ "data-slot": "navigation-menu-list", className: cn("group flex flex-1 list-none items-center justify-center gap-0", className) }, props)));
}
function NavigationMenuItem(_a) {
    var { className } = _a, props = __rest(_a, ["className"]);
    return (_jsx(NavigationMenuPrimitive.Item, Object.assign({ "data-slot": "navigation-menu-item", className: cn("relative", className) }, props)));
}
const navigationMenuTriggerStyle = cva("group/navigation-menu-trigger inline-flex h-9 w-max items-center justify-center rounded-lg px-2.5 py-1.5 text-sm font-medium transition-all outline-none hover:bg-muted focus:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-1 disabled:pointer-events-none disabled:opacity-50 data-popup-open:bg-muted/50 data-popup-open:hover:bg-muted data-open:bg-muted/50 data-open:hover:bg-muted data-open:focus:bg-muted");
function NavigationMenuTrigger(_a) {
    var { className, children } = _a, props = __rest(_a, ["className", "children"]);
    return (_jsxs(NavigationMenuPrimitive.Trigger, Object.assign({ "data-slot": "navigation-menu-trigger", className: cn(navigationMenuTriggerStyle(), "group", className) }, props, { children: [children, " ", _jsx(ChevronDownIcon, { className: "relative top-px ml-1 size-3 transition duration-300 group-data-popup-open/navigation-menu-trigger:rotate-180 group-data-open/navigation-menu-trigger:rotate-180", "aria-hidden": "true" })] })));
}
function NavigationMenuContent(_a) {
    var { className } = _a, props = __rest(_a, ["className"]);
    return (_jsx(NavigationMenuPrimitive.Content, Object.assign({ "data-slot": "navigation-menu-content", className: cn("data-ending-style:data-activation-direction=left:translate-x-[50%] data-ending-style:data-activation-direction=right:translate-x-[-50%] data-starting-style:data-activation-direction=left:translate-x-[-50%] data-starting-style:data-activation-direction=right:translate-x-[50%] h-full w-auto p-1 transition-[opacity,transform,translate] duration-[0.35s] ease-[cubic-bezier(0.22,1,0.36,1)] group-data-[viewport=false]/navigation-menu:rounded-lg group-data-[viewport=false]/navigation-menu:bg-popover group-data-[viewport=false]/navigation-menu:text-popover-foreground group-data-[viewport=false]/navigation-menu:shadow group-data-[viewport=false]/navigation-menu:ring-1 group-data-[viewport=false]/navigation-menu:ring-foreground/10 group-data-[viewport=false]/navigation-menu:duration-300 data-ending-style:opacity-0 data-starting-style:opacity-0 data-[motion=from-end]:slide-in-from-right-52 data-[motion=from-start]:slide-in-from-left-52 data-[motion=to-end]:slide-out-to-right-52 data-[motion=to-start]:slide-out-to-left-52 data-[motion^=from-]:animate-in data-[motion^=from-]:fade-in data-[motion^=to-]:animate-out data-[motion^=to-]:fade-out **:data-[slot=navigation-menu-link]:focus:ring-0 **:data-[slot=navigation-menu-link]:focus:outline-none group-data-[viewport=false]/navigation-menu:data-open:animate-in group-data-[viewport=false]/navigation-menu:data-open:fade-in-0 group-data-[viewport=false]/navigation-menu:data-open:zoom-in-95 group-data-[viewport=false]/navigation-menu:data-closed:animate-out group-data-[viewport=false]/navigation-menu:data-closed:fade-out-0 group-data-[viewport=false]/navigation-menu:data-closed:zoom-out-95", className) }, props)));
}
function NavigationMenuPositioner(_a) {
    var { className, side = "bottom", sideOffset = 8, align = "start", alignOffset = 0 } = _a, props = __rest(_a, ["className", "side", "sideOffset", "align", "alignOffset"]);
    return (_jsx(NavigationMenuPrimitive.Portal, { children: _jsx(NavigationMenuPrimitive.Positioner, Object.assign({ side: side, sideOffset: sideOffset, align: align, alignOffset: alignOffset, className: cn("isolate z-50 h-(--positioner-height) w-(--positioner-width) max-w-(--available-width) transition-[top,left,right,bottom] duration-[0.35s] ease-[cubic-bezier(0.22,1,0.36,1)] data-instant:transition-none data-[side=bottom]:before:top-[-10px] data-[side=bottom]:before:right-0 data-[side=bottom]:before:left-0", className) }, props, { children: _jsx(NavigationMenuPrimitive.Popup, { className: "data-[ending-style]:easing-[ease] xs:w-(--popup-width) relative h-(--popup-height) w-(--popup-width) origin-(--transform-origin) rounded-lg bg-popover text-popover-foreground shadow ring-1 ring-foreground/10 transition-[opacity,transform,width,height,scale,translate] duration-[0.35s] ease-[cubic-bezier(0.22,1,0.36,1)] outline-none data-ending-style:scale-90 data-ending-style:opacity-0 data-ending-style:duration-150 data-starting-style:scale-90 data-starting-style:opacity-0", children: _jsx(NavigationMenuPrimitive.Viewport, { className: "relative size-full overflow-hidden" }) }) })) }));
}
function NavigationMenuLink(_a) {
    var { className } = _a, props = __rest(_a, ["className"]);
    return (_jsx(NavigationMenuPrimitive.Link, Object.assign({ "data-slot": "navigation-menu-link", className: cn("flex items-center gap-2 rounded-lg p-2 text-sm transition-all outline-none hover:bg-muted focus:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-1 in-data-[slot=navigation-menu-content]:rounded-md data-active:bg-muted/50 data-active:hover:bg-muted data-active:focus:bg-muted [&_svg:not([class*='size-'])]:size-4", className) }, props)));
}
function NavigationMenuIndicator(_a) {
    var { className } = _a, props = __rest(_a, ["className"]);
    return (_jsx(NavigationMenuPrimitive.Icon, Object.assign({ "data-slot": "navigation-menu-indicator", className: cn("top-full z-1 flex h-1.5 items-end justify-center overflow-hidden data-[state=hidden]:animate-out data-[state=hidden]:fade-out data-[state=visible]:animate-in data-[state=visible]:fade-in", className) }, props, { children: _jsx("div", { className: "relative top-[60%] h-2 w-2 rotate-45 rounded-tl-sm bg-border shadow-md" }) })));
}
export { NavigationMenu, NavigationMenuContent, NavigationMenuIndicator, NavigationMenuItem, NavigationMenuLink, NavigationMenuList, NavigationMenuTrigger, navigationMenuTriggerStyle, NavigationMenuPositioner, };
