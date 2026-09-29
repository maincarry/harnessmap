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
  // Test-only introspection hook (zero production footprint): when a UI test sets window.__HM_TEST
  // before load, expose the built scene graph so the app test loop can assert every live node became a
  // body (the regression that let deep-map / "to sort"-bucket stars go invisible).
  if ((window as any).__HM_TEST) (window as any).__galaxyConfig = config;
  root = createRoot(el);
  root.render(React.createElement(GeneratorSystem, { initialConfig: config, mapMode: true, onFocusNode: data.onFocusNode }));
}
function unmount() { try { root?.unmount(); } catch {} root = null; }
(window as any).HarnessGalaxy = { mount, unmount };
