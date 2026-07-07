"use client";
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
import { useMemo } from "react";
import { cva } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { Label } from "@/core/label";
import { Separator } from "@/core/separator";
function FieldSet(_a) {
    var { className } = _a, props = __rest(_a, ["className"]);
    return (_jsx("fieldset", Object.assign({ "data-slot": "field-set", className: cn("flex flex-col gap-4 has-[>[data-slot=checkbox-group]]:gap-3 has-[>[data-slot=radio-group]]:gap-3", className) }, props)));
}
function FieldLegend(_a) {
    var { className, variant = "legend" } = _a, props = __rest(_a, ["className", "variant"]);
    return (_jsx("legend", Object.assign({ "data-slot": "field-legend", "data-variant": variant, className: cn("mb-1.5 font-medium data-[variant=label]:text-sm data-[variant=legend]:text-base", className) }, props)));
}
function FieldGroup(_a) {
    var { className } = _a, props = __rest(_a, ["className"]);
    return (_jsx("div", Object.assign({ "data-slot": "field-group", className: cn("group/field-group @container/field-group flex w-full flex-col gap-5 data-[slot=checkbox-group]:gap-3 *:data-[slot=field-group]:gap-4", className) }, props)));
}
const fieldVariants = cva("group/field flex w-full gap-2 data-[invalid=true]:text-destructive", {
    variants: {
        orientation: {
            vertical: "flex-col *:w-full [&>.sr-only]:w-auto",
            horizontal: "flex-row items-center has-[>[data-slot=field-content]]:items-start *:data-[slot=field-label]:flex-auto has-[>[data-slot=field-content]]:[&>[role=checkbox],[role=radio]]:mt-px",
            responsive: "flex-col *:w-full @md/field-group:flex-row @md/field-group:items-center @md/field-group:*:w-auto @md/field-group:has-[>[data-slot=field-content]]:items-start @md/field-group:*:data-[slot=field-label]:flex-auto [&>.sr-only]:w-auto @md/field-group:has-[>[data-slot=field-content]]:[&>[role=checkbox],[role=radio]]:mt-px",
        },
    },
    defaultVariants: {
        orientation: "vertical",
    },
});
function Field(_a) {
    var { className, orientation = "vertical" } = _a, props = __rest(_a, ["className", "orientation"]);
    return (_jsx("div", Object.assign({ role: "group", "data-slot": "field", "data-orientation": orientation, className: cn(fieldVariants({ orientation }), className) }, props)));
}
function FieldContent(_a) {
    var { className } = _a, props = __rest(_a, ["className"]);
    return (_jsx("div", Object.assign({ "data-slot": "field-content", className: cn("group/field-content flex flex-1 flex-col gap-0.5 leading-snug", className) }, props)));
}
function FieldLabel(_a) {
    var { className } = _a, props = __rest(_a, ["className"]);
    return (_jsx(Label, Object.assign({ "data-slot": "field-label", className: cn("group/field-label peer/field-label flex w-fit gap-2 leading-snug group-data-[disabled=true]/field:opacity-50 has-data-checked:border-primary/30 has-data-checked:bg-primary/5 has-[>[data-slot=field]]:rounded-lg has-[>[data-slot=field]]:border *:data-[slot=field]:p-2.5 dark:has-data-checked:border-primary/20 dark:has-data-checked:bg-primary/10", "has-[>[data-slot=field]]:w-full has-[>[data-slot=field]]:flex-col", className) }, props)));
}
function FieldTitle(_a) {
    var { className } = _a, props = __rest(_a, ["className"]);
    return (_jsx("div", Object.assign({ "data-slot": "field-label", className: cn("flex w-fit items-center gap-2 text-sm font-medium group-data-[disabled=true]/field:opacity-50", className) }, props)));
}
function FieldDescription(_a) {
    var { className } = _a, props = __rest(_a, ["className"]);
    return (_jsx("p", Object.assign({ "data-slot": "field-description", className: cn("text-left text-sm leading-normal font-normal text-muted-foreground group-has-data-horizontal/field:text-balance [[data-variant=legend]+&]:-mt-1.5", "last:mt-0 nth-last-2:-mt-1", "[&>a]:underline [&>a]:underline-offset-4 [&>a:hover]:text-primary", className) }, props)));
}
function FieldSeparator(_a) {
    var { children, className } = _a, props = __rest(_a, ["children", "className"]);
    return (_jsxs("div", Object.assign({ "data-slot": "field-separator", "data-content": !!children, className: cn("relative -my-2 h-5 text-sm group-data-[variant=outline]/field-group:-mb-2", className) }, props, { children: [_jsx(Separator, { className: "absolute inset-0 top-1/2" }), children && (_jsx("span", { className: "relative mx-auto block w-fit bg-background px-2 text-muted-foreground", "data-slot": "field-separator-content", children: children }))] })));
}
function FieldError(_a) {
    var { className, children, errors } = _a, props = __rest(_a, ["className", "children", "errors"]);
    const content = useMemo(() => {
        var _a;
        if (children) {
            return children;
        }
        if (!(errors === null || errors === void 0 ? void 0 : errors.length)) {
            return null;
        }
        const uniqueErrors = [
            ...new Map(errors.map((error) => [error === null || error === void 0 ? void 0 : error.message, error])).values(),
        ];
        if ((uniqueErrors === null || uniqueErrors === void 0 ? void 0 : uniqueErrors.length) == 1) {
            return (_a = uniqueErrors[0]) === null || _a === void 0 ? void 0 : _a.message;
        }
        return (_jsx("ul", { className: "ml-4 flex list-disc flex-col gap-1", children: uniqueErrors.map((error, index) => (error === null || error === void 0 ? void 0 : error.message) && _jsx("li", { children: error.message }, index)) }));
    }, [children, errors]);
    if (!content) {
        return null;
    }
    return (_jsx("div", Object.assign({ role: "alert", "data-slot": "field-error", className: cn("text-sm font-normal text-destructive", className) }, props, { children: content })));
}
export { Field, FieldLabel, FieldDescription, FieldError, FieldGroup, FieldLegend, FieldSeparator, FieldSet, FieldContent, FieldTitle, };
