'use client';

type EditorFooterStatusBarProps = {
  activeSceneNumber: number;
  sceneCount: number;
};

export function EditorFooterStatusBar({ activeSceneNumber, sceneCount }: EditorFooterStatusBarProps) {
  return (
    <footer className="h-6 bg-[#0a0a0b] border-t border-zinc-800 flex items-center justify-between px-3 shrink-0 uppercase tracking-[0.2em]">
      <div className="flex items-center gap-4 text-[8px] text-zinc-600 font-bold">
        <span className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.5)]" />
          ENGINE NOMINAL
        </span>
        <span>MEM: 44.2MB</span>
      </div>
      <div className="text-[8px] text-zinc-600 font-bold">
        SCENE: {activeSceneNumber} / {sceneCount}
      </div>
    </footer>
  );
}
