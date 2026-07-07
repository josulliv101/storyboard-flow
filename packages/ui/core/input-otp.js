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
import * as React from "react";
import { OTPInput, OTPInputContext } from "input-otp";
import { cn } from "@/lib/utils";
import { MinusIcon } from "lucide-react";
function InputOTP(_a) {
    var { className, containerClassName } = _a, props = __rest(_a, ["className", "containerClassName"]);
    return (_jsx(OTPInput, Object.assign({ "data-slot": "input-otp", containerClassName: cn("cn-input-otp flex items-center has-disabled:opacity-50", containerClassName), spellCheck: false, className: cn("disabled:cursor-not-allowed", className) }, props)));
}
function InputOTPGroup(_a) {
    var { className } = _a, props = __rest(_a, ["className"]);
    return (_jsx("div", Object.assign({ "data-slot": "input-otp-group", className: cn("flex items-center rounded-lg has-aria-invalid:border-destructive has-aria-invalid:ring-3 has-aria-invalid:ring-destructive/20 dark:has-aria-invalid:ring-destructive/40", className) }, props)));
}
function InputOTPSlot(_a) {
    var _b;
    var { index, className } = _a, props = __rest(_a, ["index", "className"]);
    const inputOTPContext = React.useContext(OTPInputContext);
    const { char, hasFakeCaret, isActive } = (_b = inputOTPContext === null || inputOTPContext === void 0 ? void 0 : inputOTPContext.slots[index]) !== null && _b !== void 0 ? _b : {};
    return (_jsxs("div", Object.assign({ "data-slot": "input-otp-slot", "data-active": isActive, className: cn("relative flex size-8 items-center justify-center border-y border-r border-input text-sm transition-all outline-none first:rounded-l-lg first:border-l last:rounded-r-lg aria-invalid:border-destructive data-[active=true]:z-10 data-[active=true]:border-ring data-[active=true]:ring-3 data-[active=true]:ring-ring/50 data-[active=true]:aria-invalid:border-destructive data-[active=true]:aria-invalid:ring-destructive/20 dark:bg-input/30 dark:data-[active=true]:aria-invalid:ring-destructive/40", className) }, props, { children: [char, hasFakeCaret && (_jsx("div", { className: "pointer-events-none absolute inset-0 flex items-center justify-center", children: _jsx("div", { className: "h-4 w-px animate-caret-blink bg-foreground duration-1000" }) }))] })));
}
function InputOTPSeparator(_a) {
    var props = __rest(_a, []);
    return (_jsx("div", Object.assign({ "data-slot": "input-otp-separator", className: "flex items-center [&_svg:not([class*='size-'])]:size-4", role: "separator" }, props, { children: _jsx(MinusIcon, {}) })));
}
export { InputOTP, InputOTPGroup, InputOTPSlot, InputOTPSeparator };
