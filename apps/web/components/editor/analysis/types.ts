export interface SceneMetrics {
  tension: number;
  suspense: number;
  anticipation: number;
  tension_reasoning: string;
  suspense_reasoning: string;
  anticipation_reasoning: string;
}

export interface NarrativeElements {
  plot_point: string | null;
  plot_point_reasoning: string | null;
  stakes_raised: boolean;
  stakes_reasoning: string | null;
  additional_elements: string[];
}

export interface GraphTag {
  id: string;
  label: string;
  color: string;
  value?: number;
  reasoning?: string;
}

export interface SceneAnalysis {
  scene_number: number;
  title: string;
  text_segment: string;
  characters: string[];
  summary: string;
  metrics: SceneMetrics;
  narrative_elements: NarrativeElements;
  start?: number;
  end?: number;
  graph_tags?: GraphTag[];
  display_tags?: string[];
}

export interface LogEntry {
  sender: string;
  message: string;
  timestamp: string;
}

export interface ScreenplayReport {
  title: string;
  overall_summary: string;
  scenes: SceneAnalysis[];
  average_tension: number;
  average_suspense: number;
  average_anticipation: number;
  pacing_dynamics: string;
  agent_logs: LogEntry[];
  model_used: string;
  is_llm: boolean;
  video_url?: string;
}
