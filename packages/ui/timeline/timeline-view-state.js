const ITEM_SIZES = ["xs", "sm", "md", "lg", "xl"];
function getParam(searchParams, key) {
    var _a;
    if (searchParams instanceof URLSearchParams) {
        return (_a = searchParams.get(key)) !== null && _a !== void 0 ? _a : undefined;
    }
    const value = searchParams[key];
    return Array.isArray(value) ? value[0] : value;
}
function parseBoolean(value) {
    if (value === "1")
        return true;
    if (value === "0")
        return false;
    return undefined;
}
function parseItemSize(value) {
    return ITEM_SIZES.includes(value) ? value : undefined;
}
function parseZoom(value) {
    if (!value)
        return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}
export function parseTimelineViewState(searchParams) {
    const thumbnailMode = parseBoolean(getParam(searchParams, "thumb"));
    return {
        thumbnailMode,
        gridMode: thumbnailMode
            ? parseBoolean(getParam(searchParams, "grid"))
            : false,
        itemSize: parseItemSize(getParam(searchParams, "size")),
        manualOverhangScroll: parseBoolean(getParam(searchParams, "pin")),
        showPlayBarArea: parseBoolean(getParam(searchParams, "playbar")),
        showPassiveFilmstrips: parseBoolean(getParam(searchParams, "filmstrips")),
        zoom: parseZoom(getParam(searchParams, "zoom")),
    };
}
export function parseProjectViewMode(searchParams) {
    return getParam(searchParams, "view") === "workbench" ? "workbench" : "storyboard";
}
export function setSearchParam(searchParams, key, value) {
    const nextSearchParams = searchParams instanceof URLSearchParams
        ? new URLSearchParams(searchParams)
        : new URLSearchParams();
    if (!(searchParams instanceof URLSearchParams)) {
        Object.entries(searchParams).forEach(([entryKey, entryValue]) => {
            if (Array.isArray(entryValue)) {
                entryValue.forEach((item) => nextSearchParams.append(entryKey, item));
                return;
            }
            if (entryValue !== undefined) {
                nextSearchParams.set(entryKey, entryValue);
            }
        });
    }
    nextSearchParams.set(key, value);
    return nextSearchParams;
}
export function serializeTimelineViewState(state) {
    const searchParams = new URLSearchParams();
    searchParams.set("thumb", state.thumbnailMode ? "1" : "0");
    searchParams.set("grid", state.thumbnailMode && state.gridMode ? "1" : "0");
    searchParams.set("size", state.itemSize);
    searchParams.set("pin", state.manualOverhangScroll ? "1" : "0");
    searchParams.set("playbar", state.showPlayBarArea ? "1" : "0");
    searchParams.set("filmstrips", state.showPassiveFilmstrips ? "1" : "0");
    searchParams.set("zoom", String(Math.round(state.zoom)));
    return searchParams;
}
export function appendTimelineViewStateToHref(href, state) {
    const search = serializeTimelineViewState(state).toString();
    return search ? `${href}?${search}` : href;
}
