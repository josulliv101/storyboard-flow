import { jsx as _jsx } from "react/jsx-runtime";
import React from 'react';
import { TensionChart } from './TensionChart';
const sampleData = [
    { name: 'Cold Open', tension: 1.2, suspense: 2.5, anticipation: 1.6, sceneIndex: 0, timestamp: 0 },
    { name: 'Signal Found', tension: 2.4, suspense: 3.3, anticipation: 2.8, sceneIndex: 1, timestamp: 38 },
    { name: 'False Lead', tension: 2.9, suspense: 4.1, anticipation: 3.2, sceneIndex: 2, timestamp: 82 },
    { name: 'Door Opens', tension: 4.2, suspense: 4.8, anticipation: 3.9, sceneIndex: 3, timestamp: 126 },
    { name: 'Quiet Beat', tension: 2.7, suspense: 3.5, anticipation: 4.4, sceneIndex: 4, timestamp: 171 },
    { name: 'Choice Point', tension: 3.8, suspense: 3.7, anticipation: 4.9, sceneIndex: 5, timestamp: 218 },
    { name: 'Reveal', tension: 5, suspense: 4.6, anticipation: 3.5, sceneIndex: 6, timestamp: 261 },
    { name: 'Aftermath', tension: 2.1, suspense: 1.8, anticipation: 2.4, sceneIndex: 7, timestamp: 312 },
];
const customMetricData = sampleData.map((point, index) => (Object.assign(Object.assign({}, point), { moral_pressure: Math.min(5, 1.5 + index * 0.45), visual_clarity: Math.max(0.5, 4.8 - index * 0.38) })));
function ChartFrame(props) {
    var _a;
    const [activeIndex, setActiveIndex] = React.useState((_a = props.activeIndex) !== null && _a !== void 0 ? _a : 2);
    return (_jsx("div", { className: "flex min-h-screen items-start bg-[#080809] p-8 text-zinc-100", children: _jsx("div", { className: "mx-auto w-full max-w-5xl", children: _jsx(TensionChart, Object.assign({ data: sampleData, activeIndex: activeIndex, onSelectScene: setActiveIndex }, props)) }) }));
}
function EditableChartFrame() {
    const [data, setData] = React.useState(sampleData);
    const [activeIndex, setActiveIndex] = React.useState(3);
    return (_jsx("div", { className: "flex min-h-screen items-start bg-[#080809] p-8 text-zinc-100", children: _jsx("div", { className: "mx-auto w-full max-w-5xl", children: _jsx(TensionChart, { data: data, activeIndex: activeIndex, onSelectScene: setActiveIndex, onUpdateValue: (sceneIndex, metric, newValue) => {
                    setData(current => current.map(point => point.sceneIndex === sceneIndex
                        ? Object.assign(Object.assign({}, point), { [metric]: newValue }) : point));
                } }) }) }));
}
const meta = {
    title: 'UI/Charts/TensionChart',
    component: ChartFrame,
    parameters: {
        layout: 'fullscreen',
        controls: {
            expanded: false,
        },
    },
};
export default meta;
export const AllMetrics = {
    render: () => _jsx(ChartFrame, {}),
};
export const TensionOnly = {
    render: () => _jsx(ChartFrame, { activeTab: "graph-tension", activeIndex: 6 }),
};
export const CustomColors = {
    render: () => (_jsx(ChartFrame, { activeIndex: 5, colors: {
            tension: '#fb7185',
            suspense: '#c084fc',
            anticipation: '#2dd4bf',
        } })),
};
export const EditableValues = {
    render: () => _jsx(EditableChartFrame, {}),
};
export const CustomMetrics = {
    render: () => (_jsx(ChartFrame, { data: customMetricData, metrics: [
            { id: 'moral_pressure', label: 'Moral Pressure', color: '#f59e0b' },
            { id: 'visual_clarity', label: 'Visual Clarity', color: '#14b8a6' },
        ], activeIndex: 4 })),
};
