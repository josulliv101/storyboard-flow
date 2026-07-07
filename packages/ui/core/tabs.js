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
import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import { cva } from "class-variance-authority";
import { cn } from "@/lib/utils";
function Tabs(_a) {
    var { className, orientation = "horizontal" } = _a, props = __rest(_a, ["className", "orientation"]);
    return (_jsx(TabsPrimitive.Root, Object.assign({ "data-slot": "tabs", "data-orientation": orientation, className: cn("group/tabs flex gap-2 data-horizontal:flex-col", className) }, props)));
}
const tabsListVariants = cva("group/tabs-list inline-flex w-fit items-center justify-center rounded-lg p-[3px] text-muted-foreground group-data-horizontal/tabs:h-8 group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col data-[variant=line]:rounded-none", {
    variants: {
        variant: {
            default: "bg-muted",
            line: "gap-1 bg-transparent",
        },
    },
    defaultVariants: {
        variant: "default",
    },
});
function TabsList(_a) {
    var { className, variant = "default" } = _a, props = __rest(_a, ["className", "variant"]);
    return (_jsx(TabsPrimitive.List, Object.assign({ "data-slot": "tabs-list", "data-variant": variant, className: cn(tabsListVariants({ variant }), className) }, props)));
}
function TabsTrigger(_a) {
    var { className } = _a, props = __rest(_a, ["className"]);
    return (_jsx(TabsPrimitive.Tab, Object.assign({ "data-slot": "tabs-trigger", className: cn("relative inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent px-1.5 py-0.5 text-sm font-medium whitespace-nowrap text-foreground/60 transition-all group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 has-data-[icon=inline-end]:pr-1 has-data-[icon=inline-start]:pl-1 aria-disabled:pointer-events-none aria-disabled:opacity-50 dark:text-muted-foreground dark:hover:text-foreground group-data-[variant=default]/tabs-list:data-active:shadow-sm group-data-[variant=line]/tabs-list:data-active:shadow-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4", "group-data-[variant=line]/tabs-list:bg-transparent group-data-[variant=line]/tabs-list:data-active:bg-transparent dark:group-data-[variant=line]/tabs-list:data-active:border-transparent dark:group-data-[variant=line]/tabs-list:data-active:bg-transparent", "data-active:bg-background data-active:text-foreground dark:data-active:border-input dark:data-active:bg-input/30 dark:data-active:text-foreground", "after:absolute after:bg-foreground after:opacity-0 after:transition-opacity group-data-horizontal/tabs:after:inset-x-0 group-data-horizontal/tabs:after:bottom-[-5px] group-data-horizontal/tabs:after:h-0.5 group-data-vertical/tabs:after:inset-y-0 group-data-vertical/tabs:after:-right-1 group-data-vertical/tabs:after:w-0.5 group-data-[variant=line]/tabs-list:data-active:after:opacity-100", className) }, props)));
}
function TabsContent(_a) {
    var { className } = _a, props = __rest(_a, ["className"]);
    return (_jsx(TabsPrimitive.Panel, Object.assign({ "data-slot": "tabs-content", className: cn("flex-1 text-sm outline-none", className) }, props)));
}
export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants };
