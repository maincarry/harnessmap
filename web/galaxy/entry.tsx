import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { GeneratorSystem } from "./GeneratorSystem";
import { mapToSystem, type MapNodeLite } from "./fromMap";

let root: Root | null = null;
export interface MountData { nodes: MapNodeLite[]; projectName?: string; litIds?: string[]; onFocusNode?: (id: string) => void; }

function mount(el: HTMLElement, data: MountData) {
  const config = mapToSystem(data.nodes ?? [], {
    projectName: data.projectName,
    // Jacob (2026-09-29): "sleep means dim, awake means lit." Pass the lit set
    // through even when EMPTY (empty = nothing lit = all bodies asleep) — only a
    // truly absent litIds (a non-map caller) falls back to status-based sleep.
    litIds: data.litIds ? new Set(data.litIds) : null,
  });
  root = createRoot(el);
  root.render(React.createElement(GeneratorSystem, { initialConfig: config, mapMode: true, onFocusNode: data.onFocusNode }));
}
function unmount() { try { root?.unmount(); } catch {} root = null; }
(window as any).HarnessGalaxy = { mount, unmount };
