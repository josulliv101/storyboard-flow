"use client";

import { useCallback, useRef, useState } from "react";
import { Badge } from "@storyboard/ui/core/badge";
import { Button } from "@storyboard/ui/core/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@storyboard/ui/core/card";
import { Kbd, KbdGroup } from "@storyboard/ui/core/kbd";
import { Separator } from "@storyboard/ui/core/separator";
import {
  buildGraph,
  CollectionPanels,
  DndCollections,
  HistoryLog,
  PaletteItem,
  TrashTarget,
  UndoRedoControls,
  parseNodeId,
  type CollectionItemNode,
  type CollectionsChange,
  type CollectionsGraph,
  type GraphNodeSpec,
} from "@storyboard/ui/dnd-collections";

const BOARD_COLLECTION_IDS = [
  parseNodeId("assembly-board"),
  parseNodeId("selects-board"),
  parseNodeId("review-board"),
  parseNodeId("montage-folder"),
] as const;
const TRASH_ID = parseNodeId("trash-board");

const INITIAL_GRAPH = createShowcaseGraph();

type ActivitySummary = Readonly<{
  commits: number;
  nodes: number;
  message: string;
}>;

const INITIAL_ACTIVITY: ActivitySummary = {
  commits: 0,
  nodes: INITIAL_GRAPH.nodesById.size,
  message: "No committed changes yet.",
};

function createShowcaseGraph(): CollectionsGraph {
  const specs: readonly GraphNodeSpec[] = [
    {
      kind: "collection",
      id: "assembly-board",
      name: "Scene assembly",
      children: [
        {
          kind: "media",
          id: "opening-wide",
          name: "Opening wide",
          durationSeconds: 8,
        },
        {
          kind: "media",
          id: "character-closeup",
          name: "Character close-up",
          durationSeconds: 5,
        },
        {
          kind: "collection",
          id: "montage-folder",
          name: "Montage selects",
          children: [
            {
              kind: "media",
              id: "city-cutaway",
              name: "City cutaway",
              durationSeconds: 4,
            },
          ],
        },
        {
          kind: "media",
          id: "interview-beat",
          name: "Interview beat",
          durationSeconds: 11,
        },
      ],
    },
    {
      kind: "collection",
      id: "selects-board",
      name: "B-roll selects",
      children: [
        {
          kind: "media",
          id: "hands-detail",
          name: "Hands detail",
          durationSeconds: 3,
        },
        {
          kind: "media",
          id: "hallway-drift",
          name: "Hallway drift",
          durationSeconds: 7,
        },
        {
          kind: "media",
          id: "window-reflection",
          name: "Window reflection",
          durationSeconds: 6,
        },
      ],
    },
    {
      kind: "collection",
      id: "review-board",
      name: "Review queue",
      children: [
        {
          kind: "media",
          id: "director-note",
          name: "Director note",
          durationSeconds: 9,
        },
      ],
    },
    {
      kind: "collection",
      id: "trash-board",
      name: "Trash",
      children: [],
    },
  ];

  const result = buildGraph(specs);
  if (!result.ok) {
    throw new Error(`Invalid DnD showcase graph: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

function describeChange(change: CollectionsChange): string {
  if (change.origin === "undo") return "Undid the most recent board change.";
  if (change.origin === "redo") return "Reapplied the most recently undone change.";
  if (!change.command) return "The board changed.";

  if (change.command.type === "add-nodes") {
    const count = change.command.nodes.length;
    return `Added ${count} new ${count === 1 ? "item" : "items"}.`;
  }

  const count = change.command.nodeIds.length;
  return `Moved ${count} ${count === 1 ? "item" : "items"}.`;
}

export function DndCollectionsShowcase() {
  const [boardVersion, setBoardVersion] = useState(0);
  const [activity, setActivity] = useState<ActivitySummary>(INITIAL_ACTIVITY);
  const paletteSequence = useRef(0);

  const handleChange = useCallback((change: CollectionsChange) => {
    setActivity((current) => ({
      commits: current.commits + 1,
      nodes: change.graph.nodesById.size,
      message: describeChange(change),
    }));
  }, []);

  const createPaletteMedia = useCallback((): CollectionItemNode => {
    paletteSequence.current += 1;
    const sequence = paletteSequence.current;
    return {
      id: parseNodeId(`palette-shot-${sequence}`),
      kind: "media",
      name: `New shot ${sequence}`,
      durationSeconds: 4 + (sequence % 5),
    };
  }, []);

  const createPaletteCollection = useCallback((): CollectionItemNode => {
    paletteSequence.current += 1;
    const sequence = paletteSequence.current;
    return {
      id: parseNodeId(`palette-folder-${sequence}`),
      kind: "collection",
      name: `Selects folder ${sequence}`,
    };
  }, []);

  const resetBoard = () => {
    paletteSequence.current = 0;
    setActivity(INITIAL_ACTIVITY);
    setBoardVersion((current) => current + 1);
  };

  return (
    <DndCollections
      key={boardVersion}
      initialGraph={INITIAL_GRAPH}
      onChange={handleChange}
    >
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>
                <h2>Interactive collection board</h2>
              </CardTitle>
              <CardDescription>
                Reorder cards, move them between collections, or drop a card onto the center of
                Montage selects to nest it.
              </CardDescription>
              <CardAction>
                <Button type="button" variant="outline" onClick={resetBoard}>
                  Reset board
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <ul className="flex flex-wrap items-center gap-2" aria-label="Board capabilities">
                <li><Badge>Command driven</Badge></li>
                <li><Badge variant="secondary">Undoable</Badge></li>
                <li><Badge variant="outline">Multi-container</Badge></li>
                <li><Badge variant="outline">Nested collections</Badge></li>
              </ul>

              <Separator />

              <CollectionPanels collectionIds={BOARD_COLLECTION_IDS} />
            </CardContent>
            <CardFooter className="flex flex-wrap justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                {activity.message}
              </p>
              <div className="flex gap-4 text-xs text-muted-foreground">
                <span>{activity.nodes} nodes</span>
                <span>{activity.commits} committed changes</span>
              </div>
            </CardFooter>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>
                <h2>Palette and trash</h2>
              </CardTitle>
              <CardDescription>
                Palette factories create fresh graph nodes at pickup. Trash is an ordinary hidden
                collection, so moving there remains undoable.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-center">
              <div className="flex flex-wrap gap-3" role="group" aria-label="New item palette">
                <PaletteItem paletteId="new-shot" createNode={createPaletteMedia}>
                  <span className="font-semibold text-foreground">New shot</span>
                  <span className="mt-1 text-[0.7rem] text-muted-foreground">Drag into a panel</span>
                </PaletteItem>
                <PaletteItem paletteId="new-folder" createNode={createPaletteCollection}>
                  <span className="font-semibold text-foreground">New collection</span>
                  <span className="mt-1 text-[0.7rem] text-muted-foreground">Nest other cards</span>
                </PaletteItem>
              </div>
              <TrashTarget trashId={TRASH_ID} />
            </CardContent>
          </Card>
        </div>

        <aside className="flex flex-col gap-6" aria-label="Board controls and guidance">
          <Card size="sm">
            <CardHeader>
              <CardTitle>
                <h2>History controls</h2>
              </CardTitle>
              <CardDescription>Every committed command produces a reversible patch.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <UndoRedoControls />
              <Separator />
              <HistoryLog />
            </CardContent>
          </Card>

          <Card size="sm">
            <CardHeader>
              <CardTitle>
                <h2>Try these interactions</h2>
              </CardTitle>
              <CardDescription>Pointer and semantic keyboard actions share one reducer.</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-col gap-3 text-sm text-muted-foreground">
                <li>Drag a card before or after another card to reorder it.</li>
                <li>Drop on the center of a collection card to nest inside it.</li>
                <li>Use Control or Command while clicking to build a multi-selection.</li>
                <li className="flex flex-wrap items-center gap-1.5">
                  <KbdGroup>
                    <Kbd>Alt</Kbd>
                    <span aria-hidden="true">+</span>
                    <Kbd>Left</Kbd>
                    <Kbd>Right</Kbd>
                  </KbdGroup>
                  <span>moves the focused item among siblings.</span>
                </li>
                <li className="flex flex-wrap items-center gap-1.5">
                  <KbdGroup>
                    <Kbd>Alt</Kbd>
                    <span aria-hidden="true">+</span>
                    <Kbd>Enter</Kbd>
                  </KbdGroup>
                  <span>nests into a neighboring collection.</span>
                </li>
                <li className="flex flex-wrap items-center gap-1.5">
                  <KbdGroup>
                    <Kbd>Alt</Kbd>
                    <span aria-hidden="true">+</span>
                    <Kbd>Backspace</Kbd>
                  </KbdGroup>
                  <span>moves an item out of its parent.</span>
                </li>
              </ul>
            </CardContent>
          </Card>
        </aside>
      </div>
    </DndCollections>
  );
}
