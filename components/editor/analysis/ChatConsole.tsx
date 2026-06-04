import React, { useRef, useEffect } from "react";
import { X, Sparkles, MessageSquare, ChevronUp, ChevronDown, Send } from "lucide-react";
import { ScreenplayReport } from "./types";

interface ChatConsoleProps {
  isChatOpen: boolean;
  setIsChatOpen: (open: boolean) => void;
  chatEngine: "doctor" | "ollama";
  setChatEngine: (engine: "doctor" | "ollama") => void;
  selectedOllamaModel: string;
  setSelectedOllamaModel: (model: string) => void;
  ollamaStatus: { status: string; models: string[]; error?: string } | null;
  chatMessages: Array<{ role: "user" | "assistant"; content: string }>;
  chatInput: string;
  setChatInput: (input: string) => void;
  isChatLoading: boolean;
  isThoughtExpanded: boolean;
  setIsThoughtExpanded: (expanded: boolean) => void;
  report: ScreenplayReport | null;
  handleChatSubmit: (customMessage?: string) => Promise<void>;
}

export default function ChatConsole({
  isChatOpen,
  setIsChatOpen,
  chatEngine,
  setChatEngine,
  selectedOllamaModel,
  setSelectedOllamaModel,
  ollamaStatus,
  chatMessages,
  chatInput,
  setChatInput,
  isChatLoading,
  isThoughtExpanded,
  setIsThoughtExpanded,
  report,
  handleChatSubmit,
}: ChatConsoleProps) {
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [chatMessages, isChatOpen]);

  const renderTextWithFormatting = (text: string) => {
    const parts = text.split(/(\*\*.*?\*\*|\*.*?\*)/g);
    return parts.map((part, partIdx) => {
      if (part.startsWith("**") && part.endsWith("**")) {
        return (
          <strong key={partIdx} className="font-bold text-zinc-100">
            {part.slice(2, -2)}
          </strong>
        );
      }
      if (part.startsWith("*") && part.endsWith("*")) {
        return (
          <em key={partIdx} className="italic text-zinc-300">
            {part.slice(1, -1)}
          </em>
        );
      }
      return part;
    });
  };

  return (
    <>
      {/* ChatOverlay Backdrop */}
      {isChatOpen && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-xs z-[250] transition-opacity duration-300 animate-fade-in cursor-pointer"
          onClick={() => setIsChatOpen(false)}
        />
      )}

      {/* Sliding Viewport Drawer */}
      <div
        className={`fixed top-0 right-0 h-screen w-[420px] max-w-full z-[300] bg-[#0c0c0e] border-l border-zinc-900 shadow-2xl backdrop-blur-lg flex flex-col transform transition-transform duration-300 ease-in-out ${
          isChatOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-zinc-900 flex items-center justify-between bg-zinc-950/40">
          <div className="flex items-center space-x-3">
            <div className="relative">
              <span className="absolute bottom-0 right-0 w-2 h-2 bg-emerald-500 rounded-full border-2 border-[#0c0c0e] animate-pulse"></span>
              <div className="w-8 h-8 rounded bg-indigo-950 flex items-center justify-center border border-indigo-900/30 shadow-lg shadow-indigo-950/50">
                <Sparkles size={14} className="text-indigo-400" />
              </div>
            </div>
            <div>
              <div className="flex items-center space-x-1.5">
                <h3 className="text-xs font-bold text-zinc-200">
                  {chatEngine === "doctor" ? "AI Story Doctor" : "Ollama Chat"}
                </h3>
                <span className="text-[8px] font-mono font-bold uppercase px-1 py-0.2 bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 rounded">
                  {chatEngine === "doctor" ? "Story Doctor" : "Ollama"}
                </span>
              </div>
              <p className="text-[9px] text-zinc-500 font-mono mt-0.5 uppercase tracking-wider">
                {chatEngine === "doctor"
                  ? "Narrative Consultant | Online"
                  : "Direct Local Model | Online"}
              </p>
            </div>
          </div>
          <button
            onClick={() => setIsChatOpen(false)}
            className="p-1 hover:bg-zinc-900 border border-zinc-900 hover:border-zinc-800 text-zinc-400 hover:text-zinc-200 rounded transition-all cursor-pointer"
          >
            <X size={14} />
          </button>
        </div>

        {/* Mode Switcher Tabs */}
        <div className="flex bg-zinc-950/80 p-0.5 border-b border-zinc-900 select-none">
          <button
            onClick={() => setChatEngine("doctor")}
            className={`flex-1 py-1.5 text-center rounded text-[10px] font-mono font-bold transition-all duration-200 uppercase tracking-widest flex items-center justify-center space-x-1.5 cursor-pointer ${
              chatEngine === "doctor"
                ? "bg-indigo-600 text-white shadow-md shadow-indigo-950/45"
                : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900/40"
            }`}
          >
            <Sparkles size={10} />
            <span>Story Doctor</span>
          </button>
          <button
            onClick={() => setChatEngine("ollama")}
            className={`flex-1 py-1.5 text-center rounded text-[10px] font-mono font-bold transition-all duration-200 uppercase tracking-widest flex items-center justify-center space-x-1.5 cursor-pointer ${
              chatEngine === "ollama"
                ? "bg-indigo-600 text-white shadow-md shadow-indigo-950/45"
                : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900/40"
            }`}
          >
            <MessageSquare size={10} />
            <span>Local Chat</span>
          </button>
        </div>

        {/* Ollama Model Selector Dropdown */}
        {chatEngine === "ollama" && (
          <div className="px-5 py-2 bg-zinc-950/30 border-b border-zinc-900 flex items-center justify-between">
            <label className="text-[9px] font-mono text-zinc-555 uppercase font-semibold">
              Ollama Model:
            </label>
            <select
              value={selectedOllamaModel}
              onChange={(e) => setSelectedOllamaModel(e.target.value)}
              className="bg-zinc-950 border border-zinc-900 rounded px-2.5 py-0.5 text-[10px] text-zinc-400 font-mono focus:outline-none focus:border-indigo-500 cursor-pointer"
            >
              {ollamaStatus?.status === "online" && ollamaStatus.models.length > 0 ? (
                ollamaStatus.models.map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))
              ) : (
                <>
                  <option value="gemma4">gemma4 (Default)</option>
                  <option value="llama3">llama3</option>
                  <option value="mistral">mistral</option>
                </>
              )}
            </select>
          </div>
        )}

        {/* Messages Body */}
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-6 scrollbar-thin scrollbar-thumb-zinc-800 bg-transparent">
          {chatMessages.map((msg, idx) => {
            const isUser = msg.role === "user";
            return (
              <div
                key={idx}
                className={`flex ${isUser ? "justify-end" : "justify-start"} animate-fade-in`}
              >
                {isUser ? (
                  /* User Bubble */
                  <div className="max-w-[85%] px-4 py-2 text-xs leading-relaxed text-zinc-100 bg-indigo-600 rounded-lg shadow-md select-text font-sans">
                    <p>{msg.content}</p>
                  </div>
                ) : (
                  /* Assistant Message */
                  <div className="flex justify-start items-start space-x-3 w-full">
                    <div className="w-6 h-6 rounded bg-zinc-900 border border-zinc-800 flex items-center justify-center flex-shrink-0 text-indigo-400 mt-0.5 shadow-sm">
                      <Sparkles size={11} />
                    </div>
                    <div className="flex-1 space-y-2 select-text font-sans text-xs text-zinc-300 leading-relaxed max-w-[85%]">
                      <span className="text-[9px] font-mono font-bold text-zinc-500 uppercase tracking-widest block mb-0.5">
                        {chatEngine === "doctor"
                          ? "Story Doctor Agent"
                          : `Ollama: ${selectedOllamaModel}`}
                      </span>
                      <div className="space-y-2 select-text font-sans">
                        {msg.content.split("\n\n").map((para, pIdx) => {
                          if (para.startsWith("```text") || para.startsWith("```")) {
                            const codeLines = para
                              .replace(/```text\n|```/, "")
                              .replace(/```$/, "")
                              .trim();
                            return (
                              <div
                                key={pIdx}
                                className="my-2 border border-zinc-900 rounded overflow-hidden shadow-inner font-sans"
                              >
                                <div className="bg-zinc-950 px-4 py-1 border-b border-zinc-900 flex justify-between items-center text-[9px] font-mono text-zinc-550 select-none">
                                  <span>Screenplay Format (Courier)</span>
                                  <span>Text</span>
                                </div>
                                <pre className="font-mono bg-black/40 p-4 text-zinc-300 text-[10px] leading-relaxed overflow-x-auto whitespace-pre select-all font-medium">
                                  {codeLines}
                                </pre>
                              </div>
                            );
                          }

                          if (
                            para.includes("\n- ") ||
                            para.startsWith("- ") ||
                            para.includes("\n1. ") ||
                            para.startsWith("1. ")
                          ) {
                            const listLines = para.split("\n");
                            return (
                              <ul key={pIdx} className="list-disc pl-5 space-y-1.5 my-2">
                                {listLines.map((li, liIdx) => {
                                  const itemText = li.replace(/^(-\s*|\d+\.\s*)/, "");
                                  return (
                                    <li key={liIdx} className="text-zinc-400">
                                      {renderTextWithFormatting(itemText)}
                                    </li>
                                  );
                                })}
                              </ul>
                            );
                          }

                          return (
                            <p key={pIdx} className="text-zinc-300 font-sans">
                              {renderTextWithFormatting(para)}
                            </p>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {isChatLoading && (
            <div className="flex flex-col space-y-4 pt-2">
              {/* Collapsible Accordion for Thought Process */}
              <div className="bg-zinc-950/40 border border-zinc-900 rounded-lg overflow-hidden shadow-inner">
                <button
                  type="button"
                  onClick={() => setIsThoughtExpanded(!isThoughtExpanded)}
                  className="w-full px-3 py-2.5 flex items-center justify-between text-[9px] font-mono font-bold text-indigo-400 hover:bg-zinc-900/20 transition-colors cursor-pointer select-none"
                >
                  <span className="flex items-center space-x-2">
                    <div className="animate-spin rounded-full h-3 w-3 border border-indigo-400/20 border-t-indigo-400" />
                    <span>
                      {chatEngine === "doctor"
                        ? "Thinking process..."
                        : `Ollama is generating response...`}
                    </span>
                  </span>
                  {isThoughtExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                </button>
                {isThoughtExpanded && (
                  <div className="px-3.5 py-3 border-t border-zinc-900 bg-black/40 font-mono text-[9px] text-zinc-500 leading-relaxed space-y-1.5 select-text">
                    {chatEngine === "doctor" ? (
                      <>
                        <div className="text-zinc-650">&gt; Initializing context parameters...</div>
                        <div className="text-zinc-650">
                          &gt; Screenplay Analysis loaded: Average Tension=
                          {report?.average_tension || 3.5}/5, Suspense=
                          {report?.average_suspense || 4.0}/5
                        </div>
                        <div className="text-indigo-400/70">
                          &gt; Dispatched Narrative Expert agent for prompt parsing.
                        </div>
                        <div className="text-zinc-650">
                          &gt; Formulating scene diagnostics rewrite...
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="text-zinc-650">
                          &gt; Querying Ollama server local daemon...
                        </div>
                        <div className="text-zinc-650">&gt; Selected Model: '{selectedOllamaModel}'</div>
                        <div className="text-[#2D8CFF]">
                          &gt; Forwarding conversational array...
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* Typing Indicators */}
              <div className="flex justify-start items-center space-x-3">
                <div className="w-6 h-6 rounded bg-zinc-900 border border-zinc-800 flex items-center justify-center flex-shrink-0 text-zinc-500 mt-0.5 animate-pulse">
                  <Sparkles size={11} />
                </div>
                <div className="bg-zinc-900 border border-zinc-900 text-zinc-400 rounded-full px-3 py-1.5 flex items-center space-x-1.5 shadow-inner select-none">
                  <span
                    className="w-1 h-1 bg-indigo-500 rounded-full animate-bounce"
                    style={{ animationDelay: "0ms" }}
                  ></span>
                  <span
                    className="w-1 h-1 bg-indigo-500 rounded-full animate-bounce"
                    style={{ animationDelay: "150ms" }}
                  ></span>
                  <span
                    className="w-1 h-1 bg-indigo-500 rounded-full animate-bounce"
                    style={{ animationDelay: "300ms" }}
                  ></span>
                </div>
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* ChatKit Prompt Actions/Chips Carousel */}
        <div className="px-5 py-3 border-t border-zinc-900 bg-zinc-950/20 flex flex-col space-y-2 select-none">
          <span className="text-[9px] font-mono text-zinc-550 uppercase tracking-widest font-semibold">
            Consultant Prompts
          </span>
          <div className="flex space-x-2 overflow-x-auto pb-1.5 scrollbar-thin scrollbar-thumb-zinc-900 scroll-smooth -mx-2 px-2">
            <button
              onClick={() => handleChatSubmit("Suggest ideas to raise the stakes in this screenplay")}
              disabled={isChatLoading}
              className="flex-shrink-0 text-[10px] font-mono px-3 py-1.5 bg-zinc-950 hover:bg-zinc-900 border border-zinc-900 hover:border-indigo-500/40 text-zinc-400 hover:text-zinc-200 rounded transition-all disabled:opacity-50 cursor-pointer"
            >
              🔥 Raise Stakes
            </button>
            <button
              onClick={() => handleChatSubmit("Rewrite Scene 1 using Courier script format to maximize tension and pacing")}
              disabled={isChatLoading}
              className="flex-shrink-0 text-[10px] font-mono px-3 py-1.5 bg-zinc-950 hover:bg-zinc-900 border border-zinc-900 hover:border-indigo-500/40 text-zinc-400 hover:text-zinc-200 rounded transition-all disabled:opacity-50 cursor-pointer"
            >
              📝 Rewrite Scene 1
            </button>
            <button
              onClick={() => handleChatSubmit("Analyze the difference between immediate emotional tension vs. creeping suspense in our narrative beats")}
              disabled={isChatLoading}
              className="flex-shrink-0 text-[10px] font-mono px-3 py-1.5 bg-zinc-950 hover:bg-zinc-900 border border-zinc-900 hover:border-indigo-500/40 text-zinc-400 hover:text-zinc-200 rounded transition-all disabled:opacity-50 cursor-pointer"
            >
              ⚖️ Tension vs Suspense
            </button>
          </div>
        </div>

        {/* ChatComposer pill container */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleChatSubmit();
          }}
          className="p-4 border-t border-zinc-900 bg-[#0c0c0e] flex items-center w-full"
        >
          <div className="relative flex-1 flex items-center bg-zinc-950 border border-zinc-900 hover:border-zinc-800 rounded-lg px-3.5 py-2 transition-all">
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              disabled={isChatLoading}
              placeholder={
                chatEngine === "doctor" ? "Ask Story Doctor for advice..." : "Type custom Ollama prompt..."
              }
              className="flex-1 bg-transparent text-xs text-zinc-350 placeholder-zinc-650 focus:outline-none disabled:opacity-50 font-sans"
            />
            <button
              type="submit"
              disabled={isChatLoading || !chatInput.trim()}
              className="ml-2 p-1.5 bg-indigo-650 hover:bg-indigo-600 text-white rounded shadow-sm disabled:opacity-40 disabled:hover:bg-indigo-650 transition-all cursor-pointer flex items-center justify-center"
            >
              <Send size={11} />
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
