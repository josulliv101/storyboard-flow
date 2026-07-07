import { jsx as _jsx } from "react/jsx-runtime";
import { expect, fn, userEvent } from "storybook/test";
import { CollectionRepeatedMediaTile } from "./CollectionRepeatedMediaTile";
import { collectionClip, emptyCollectionClip } from "./story-fixtures";
const withCollectionFrame = (Story, context) => {
    var _a, _b, _c, _d;
    const frame = ((_a = context.parameters.repeatedMediaFrame) !== null && _a !== void 0 ? _a : {});
    return (_jsx("div", { className: "font-sans text-white", style: {
            width: (_b = frame.width) !== null && _b !== void 0 ? _b : 360,
            height: (_c = frame.height) !== null && _c !== void 0 ? _c : 180,
            background: "#18181b",
            borderRadius: 8,
            overflow: "clip",
            padding: (_d = frame.padding) !== null && _d !== void 0 ? _d : 12,
        }, children: _jsx(Story, {}) }));
};
const meta = {
    title: "UI/Timeline/media/RepeatedMediaTile/CollectionRepeatedMediaTile",
    component: CollectionRepeatedMediaTile,
    decorators: [withCollectionFrame],
    args: {
        clip: collectionClip,
        isXS: false,
    },
};
export default meta;
export const Default = {
    play: async ({ canvas }) => {
        await expect(canvas.getByLabelText("Scene Selects contains 12 items")).toBeVisible();
        await expect(canvas.getByAltText("Opening shot")).toBeVisible();
        await expect(canvas.queryByAltText("Middle insert")).not.toBeInTheDocument();
        await expect(canvas.getByAltText("Closing frame")).toBeVisible();
        await expect(canvas.queryByText("12 assets")).not.toBeInTheDocument();
    },
};
export const OpenTimelineFromCount = {
    args: {
        collectionHref: "/timeline/scene-selects",
        onOpenCollection: fn(),
    },
    play: async ({ args, canvas }) => {
        const openLink = canvas.getByRole("link", {
            name: "Open Scene Selects timeline (12 items)",
        });
        await expect(openLink).toHaveAttribute("href", "/timeline/scene-selects");
        await expect(canvas.queryByText("Open timeline")).not.toBeInTheDocument();
        await userEvent.click(openLink);
        await expect(args.onOpenCollection).toHaveBeenCalledWith("scene-selects", "/timeline/scene-selects");
    },
};
export const EndpointSelection = {
    args: {
        collectionEndpointSelection: {
            first: true,
            last: true,
        },
        onCollectionEndpointClick: fn(),
    },
    play: async ({ args, canvas }) => {
        const firstEndpoint = canvas.getByRole("button", {
            name: "Scene Selects first item",
        });
        const lastEndpoint = canvas.getByRole("button", {
            name: "Scene Selects last item",
        });
        await expect(firstEndpoint).toHaveAttribute("aria-pressed", "true");
        await expect(lastEndpoint).toHaveAttribute("aria-pressed", "true");
        await expect(firstEndpoint).toHaveClass(/opacity-45/);
        await expect(lastEndpoint).toHaveClass(/opacity-45/);
        await userEvent.click(firstEndpoint);
        await userEvent.click(lastEndpoint);
        await expect(args.onCollectionEndpointClick).toHaveBeenCalledWith("first");
        await expect(args.onCollectionEndpointClick).toHaveBeenCalledWith("last");
    },
};
export const FirstThumbnailSelected = {
    args: {
        collectionEndpointSelection: {
            first: true,
        },
        onCollectionEndpointClick: fn(),
    },
    play: async ({ args, canvas }) => {
        const firstEndpoint = canvas.getByRole("button", {
            name: "Scene Selects first item",
        });
        const lastEndpoint = canvas.getByRole("button", {
            name: "Scene Selects last item",
        });
        await expect(firstEndpoint).toHaveAttribute("aria-pressed", "true");
        await expect(lastEndpoint).toHaveAttribute("aria-pressed", "false");
        await expect(firstEndpoint).toHaveClass(/opacity-45/);
        await expect(lastEndpoint).not.toHaveClass(/opacity-45/);
        await userEvent.click(firstEndpoint);
        await expect(args.onCollectionEndpointClick).toHaveBeenCalledWith("first");
    },
};
export const LastThumbnailSelected = {
    args: {
        collectionEndpointSelection: {
            last: true,
        },
        onCollectionEndpointClick: fn(),
    },
    play: async ({ args, canvas }) => {
        const firstEndpoint = canvas.getByRole("button", {
            name: "Scene Selects first item",
        });
        const lastEndpoint = canvas.getByRole("button", {
            name: "Scene Selects last item",
        });
        await expect(lastEndpoint).toHaveAttribute("aria-pressed", "true");
        await expect(firstEndpoint).toHaveAttribute("aria-pressed", "false");
        await expect(lastEndpoint).toHaveClass(/opacity-45/);
        await expect(firstEndpoint).not.toHaveClass(/opacity-45/);
        await userEvent.click(lastEndpoint);
        await expect(args.onCollectionEndpointClick).toHaveBeenCalledWith("last");
    },
};
export const EditableName = {
    args: {
        onTitleChange: fn(),
    },
    play: async ({ args, canvas }) => {
        await userEvent.click(canvas.getByRole("button", { name: "Scene Selects" }));
        const input = canvas.getByLabelText("Collection name");
        await expect(input).toHaveFocus();
        await userEvent.clear(input);
        await userEvent.type(input, "Act One Selects{enter}");
        await expect(args.onTitleChange).toHaveBeenCalledWith("Act One Selects");
    },
};
export const SiblingAccentBars = {
    render: (args) => (_jsx("div", { className: "grid h-full grid-cols-3 gap-3", children: [0, 1, 2].map((accentIndex) => (_jsx(CollectionRepeatedMediaTile, Object.assign({}, args, { clip: Object.assign(Object.assign({}, collectionClip), { id: `${collectionClip.id}-${accentIndex}`, title: `Collection ${accentIndex + 1}`, viewCollectionAccentIndex: accentIndex }) }), accentIndex))) })),
    parameters: {
        repeatedMediaFrame: {
            width: 760,
            height: 190,
        },
    },
    play: async ({ canvas }) => {
        const bars = canvas.getAllByTestId("collection-accent-bar");
        await expect(bars[0].style.background).not.toBe(bars[1].style.background);
        await expect(bars[1].style.background).not.toBe(bars[2].style.background);
    },
};
export const EmptyCollection = {
    args: {
        clip: emptyCollectionClip,
    },
};
export const CompactHeight = {
    args: {
        isXS: true,
    },
    parameters: {
        repeatedMediaFrame: {
            width: 240,
            height: 80,
            padding: 8,
        },
    },
};
