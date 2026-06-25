import { Button } from "../../core/button";

export type TimelineToolbarProps = {
  disabled: boolean;
  onScrollToIndex: (index: number) => void;
};

export function TimelineToolbar({ disabled, onScrollToIndex }: TimelineToolbarProps) {
  return (
    <div className="grid w-full min-w-0 grid-cols-1 gap-2 sm:grid-cols-3">
      <div className="min-w-0">
        <Button
          variant="outline"
          size="sm"
          id="scroll-to-100"
          className="w-full min-w-0"
          disabled={disabled}
          onClick={() => onScrollToIndex(100)}
        >
          To 100
        </Button>
      </div>
      <div className="min-w-0">
        <Button
          variant="outline"
          size="sm"
          id="scroll-to-800"
          className="w-full min-w-0"
          disabled={disabled}
          onClick={() => onScrollToIndex(800)}
        >
          To 800
        </Button>
      </div>
      <div className="min-w-0">
        <Button
          variant="outline"
          size="sm"
          id="scroll-to-0"
          className="w-full min-w-0"
          disabled={disabled}
          onClick={() => onScrollToIndex(0)}
        >
          Start
        </Button>
      </div>
    </div>
  );
}
