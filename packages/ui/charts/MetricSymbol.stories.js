import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { MetricSymbol } from './MetricSymbol';
const metricExamples = [
    { name: 'Tension', color: '#f43f5e', value: 'Circle' },
    { name: 'Suspense', color: '#a855f7', value: 'Diamond' },
    { name: 'Anticipation', color: '#06b6d4', value: 'Triangle' },
    { name: 'Stakes', color: '#22c55e', value: 'Triangle alias' },
    { name: 'Momentum', color: '#f59e0b', value: 'Default square' },
];
const meta = {
    title: 'UI/Charts/MetricSymbol',
    component: MetricSymbol,
    args: {
        name: 'Tension',
    },
    decorators: [
        Story => (_jsx("div", { className: "min-h-screen bg-zinc-950 p-8 text-zinc-100", children: _jsx(Story, {}) })),
    ],
};
export default meta;
export const Playground = {
    render: args => (_jsxs("div", { className: "flex items-center gap-3", children: [_jsx(MetricSymbol, Object.assign({}, args, { className: "h-12 w-12", style: { color: '#f43f5e' } })), _jsxs("div", { children: [_jsx("div", { className: "text-sm font-semibold text-zinc-100", children: args.name }), _jsx("div", { className: "text-xs text-zinc-500", children: "Uses currentColor for the SVG fill." })] })] })),
};
export const AllMetrics = {
    render: () => (_jsx("div", { className: "grid max-w-2xl grid-cols-1 gap-3 sm:grid-cols-2", children: metricExamples.map(metric => (_jsxs("div", { className: "flex items-center justify-between rounded-md border border-zinc-800 bg-zinc-900/70 px-4 py-3", children: [_jsxs("div", { className: "flex items-center gap-3", children: [_jsx(MetricSymbol, { name: metric.name, className: "h-7 w-7", style: { color: metric.color } }), _jsx("span", { className: "text-sm font-semibold text-zinc-100", children: metric.name })] }), _jsx("span", { className: "font-mono text-[10px] font-bold uppercase tracking-widest text-zinc-500", children: metric.value })] }, metric.name))) })),
};
