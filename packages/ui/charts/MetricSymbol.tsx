import React from "react";

export interface MetricSymbolProps {
  name: string;
  className?: string;
  style?: React.CSSProperties;
}

export function MetricSymbol({ name, className, style }: MetricSymbolProps) {
  const normalized = name.toLowerCase();

  if (normalized.includes("tension")) {
    // Circle (expanded radius from 5 to 5.5)
    return (
      <svg 
        viewBox="0 0 12 12" 
        className={className || "w-3 h-3"} 
        style={style}
      >
        <circle cx="6" cy="6" r="5.5" fill="currentColor" />
      </svg>
    );
  }

  if (normalized.includes("suspense")) {
    // Diamond (expanded from 1.5 margin to 0.5 margin for max visibility)
    return (
      <svg 
        viewBox="0 0 12 12" 
        className={className || "w-3 h-3"} 
        style={style}
      >
        <path d="M6 0.5 L11.5 6 L6 11.5 L0.5 6 Z" fill="currentColor" />
      </svg>
    );
  }

  if (normalized.includes("anticipation") || normalized.includes("stakes")) {
    // Triangle (expanded base and height)
    return (
      <svg 
        viewBox="0 0 12 12" 
        className={className || "w-3 h-3"} 
        style={style}
      >
        <path d="M6 0.5 L11.5 11 L0.5 11 Z" fill="currentColor" />
      </svg>
    );
  }

  // Square (Default - expanded size to 9.5x9.5)
  return (
    <svg 
      viewBox="0 0 12 12" 
      className={className || "w-3 h-3"} 
      style={style}
    >
      <rect x="1.25" y="1.25" width="9.5" height="9.5" fill="currentColor" />
    </svg>
  );
}
