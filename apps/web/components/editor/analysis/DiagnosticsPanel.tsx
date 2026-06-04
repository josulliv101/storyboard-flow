import React from "react";
import { Activity, RotateCcw, ChevronUp, ChevronDown, AlertTriangle } from "lucide-react";

interface DiagnosticsPanelProps {
  apiHealth: { status: string; has_genai_sdk: boolean; has_api_key: boolean } | null;
  ollamaStatus: { status: string; models: string[]; error?: string } | null;
  isCheckingDiagnostics: boolean;
  isDiagnosticsOpen: boolean;
  setIsDiagnosticsOpen: (open: boolean) => void;
  elapsedTime: number;
  isLoading: boolean;
  checkDiagnostics: () => Promise<void>;
  selectedOllamaModel: string;
  setSelectedOllamaModel: (model: string) => void;
}

export default function DiagnosticsPanel({
  apiHealth,
  ollamaStatus,
  isCheckingDiagnostics,
  isDiagnosticsOpen,
  setIsDiagnosticsOpen,
  elapsedTime,
  isLoading,
  checkDiagnostics,
  selectedOllamaModel,
  setSelectedOllamaModel,
}: DiagnosticsPanelProps) {
  return (
    <div className="w-full bg-zinc-950/60 border border-zinc-800 rounded-2xl p-5 shadow-xl backdrop-blur-md transition-all duration-300">
      {/* Header */}
      <div
        className="flex items-center justify-between pb-3 border-b border-zinc-900 cursor-pointer select-none"
        onClick={() => setIsDiagnosticsOpen(!isDiagnosticsOpen)}
      >
        <div className="flex items-center space-x-2">
          <Activity
            size={13}
            className={`text-indigo-400 ${isCheckingDiagnostics ? "animate-spin" : "animate-pulse"}`}
          />
          <span className="text-[10px] font-mono font-bold tracking-wider text-zinc-400 uppercase">
            Diagnostics Console
          </span>
        </div>
        <div className="flex items-center space-x-2.5">
          {/* Status Indicator Dots */}
          <div className="flex space-x-1.5 items-center">
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                apiHealth?.status === "healthy"
                  ? "bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.6)]"
                  : "bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.6)]"
              }`}
              title={apiHealth?.status === "healthy" ? "Core Online" : "Core Offline"}
            ></span>
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                ollamaStatus?.status === "online"
                  ? "bg-sky-400 animate-pulse shadow-[0_0_8px_rgba(56,189,248,0.6)]"
                  : "bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.6)]"
              }`}
              title={ollamaStatus?.status === "online" ? "Ollama Online" : "Ollama Offline"}
            ></span>
          </div>
          {isDiagnosticsOpen ? (
            <ChevronUp size={13} className="text-zinc-550" />
          ) : (
            <ChevronDown size={13} className="text-zinc-550" />
          )}
        </div>
      </div>

      {/* Body */}
      {isDiagnosticsOpen && (
        <div className="pt-3.5 space-y-3 bg-transparent text-[11px] font-mono leading-relaxed">
          {/* API Service Health */}
          <div className="flex items-start justify-between border-b border-zinc-900 pb-2.5">
            <div>
              <div className="flex items-center space-x-1.5">
                <span className="font-semibold text-zinc-400">FastAPI Core API:</span>
                <span
                  className={`text-[9px] px-1.5 py-0.25 font-bold uppercase rounded ${
                    apiHealth?.status === "healthy"
                      ? "bg-emerald-950/60 text-emerald-455 border border-emerald-900/30"
                      : "bg-rose-950/60 text-rose-455 border border-rose-900/30"
                  }`}
                >
                  {apiHealth?.status === "healthy" ? "Online" : "Offline"}
                </span>
              </div>
              <p className="text-[9.5px] text-zinc-500 mt-0.5 leading-normal">
                Host: http://127.0.0.1:8000
              </p>
            </div>
            <span className="text-[10px] text-zinc-400 font-semibold">
              {apiHealth?.status === "healthy" ? "127.0.0.1" : "No Response"}
            </span>
          </div>

          {/* Gemini Key Status */}
          <div className="flex items-start justify-between border-b border-zinc-900 pb-2.5">
            <div>
              <div className="flex items-center space-x-1.5">
                <span className="font-semibold text-zinc-400">Google Gemini Key:</span>
                <span
                  className={`text-[9px] px-1.5 py-0.25 font-bold uppercase rounded ${
                    apiHealth?.has_api_key
                      ? "bg-emerald-950/60 text-emerald-455 border border-emerald-900/30"
                      : "bg-amber-950/60 text-amber-400 border border-amber-900/30"
                  }`}
                >
                  {apiHealth?.has_api_key ? 'Connected' : 'Not Set'}
                </span>
              </div>
              <p className="text-[9.5px] text-zinc-500 mt-0.5 leading-normal">
                {apiHealth?.has_api_key
                  ? 'Gemini 2.5 Active'
                  : 'Fallback: Local heuristics engine'}
              </p>
            </div>
            <span className="text-[10px] text-zinc-400 font-semibold">
              {apiHealth?.has_genai_sdk ? 'SDK OK' : 'No SDK'}
            </span>
          </div>

          {/* Ollama Server Health */}
          <div className="flex items-start justify-between pb-1">
            <div className="flex-1 min-w-0">
              <div className="flex items-center space-x-1.5">
                <span className="font-semibold text-zinc-400">Local Ollama Server:</span>
                <span
                  className={`text-[9px] px-1.5 py-0.25 font-bold uppercase rounded ${
                    ollamaStatus?.status === "online"
                      ? "bg-sky-950/60 text-sky-400 border border-sky-900/30"
                      : "bg-rose-950/60 text-rose-455 border border-rose-900/30"
                  }`}
                >
                  {ollamaStatus?.status === "online" ? "Online" : "Offline"}
                </span>
              </div>

              {ollamaStatus?.status === "online" ? (
                <div className="mt-2 bg-zinc-950 border border-zinc-900 rounded p-2">
                  <span className="text-[9px] text-zinc-500 block mb-1 uppercase tracking-wider font-bold font-mono">
                    Models:
                  </span>
                  <div className="flex flex-wrap gap-1">
                    {ollamaStatus.models.length > 0 ? (
                      ollamaStatus.models.map((model, idx) => (
                        <span
                          key={idx}
                          className="text-[9px] font-semibold px-2 py-0.5 bg-zinc-900 border border-zinc-800 rounded text-zinc-300"
                        >
                          {model}
                        </span>
                      ))
                    ) : (
                      <span className="text-[9px] text-amber-400/80 italic">
                        No models loaded. Please pull 'gemma4' or similar.
                      </span>
                    )}
                  </div>
                </div>
              ) : (
                <div className="mt-2 bg-zinc-950/65 border border-zinc-900 p-2.5 rounded text-[9.5px] text-rose-400 italic flex items-start leading-normal">
                  <AlertTriangle size={10} className="text-rose-500 mr-2 mt-0.5 flex-shrink-0" />
                  <span>
                    {ollamaStatus?.error || "Ollama server unreachable at http://localhost:11434"}
                  </span>
                </div>
              )}
            </div>
          </div>

          {isLoading && (
            <div className="bg-zinc-950 border border-zinc-900/60 p-2 rounded flex items-center justify-between text-[9px] text-indigo-400 font-mono animate-pulse">
              <span className="font-bold uppercase tracking-wider">⏱️ Pipeline stopwatch:</span>
              <span className="font-bold text-zinc-200 tabular-nums">
                {elapsedTime.toFixed(1)}s elapsed
              </span>
            </div>
          )}

          {/* Diagnostic Action footer */}
          <div className="flex items-center justify-between pt-2.5 border-t border-zinc-900 text-[9.5px]">
            <span className="text-zinc-550">
              {isCheckingDiagnostics ? "Probing servers..." : "Status: Diagnostics Standby"}
            </span>
            <button
              type="button"
              onClick={checkDiagnostics}
              disabled={isCheckingDiagnostics}
              className="flex items-center space-x-1 px-2 py-0.5 bg-zinc-950 hover:bg-zinc-900 hover:text-white border border-zinc-900 rounded transition-colors text-zinc-400 disabled:opacity-50 cursor-pointer"
            >
              <RotateCcw size={10} className={isCheckingDiagnostics ? "animate-spin" : ""} />
              <span>Probe Connection</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
