import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { GeneratorSystem } from "./GeneratorSystem";
import { mapToSystem, type MapNodeLite } from "./fromMap";

let root: Root | null = null;
export interface MountData { nodes: MapNodeLite[]; projectName?: string; litIds?: string[]; onFocusNode?: (id: string) => void; }

function mount(el: HTMLElement, data: MountData) {
  const config = mapToSystem(data.nodes ?? [], {
    projectName: data.projectName,
    litIds: data.litIds && data.litIds.length ? new Set(data.litIds) : null,
  });
  root = createRoot(el);
  root.render(React.createElement(GeneratorSystem, { initialConfig: config, mapMode: true, onFocusNode: data.onFocusNode }));
}
function unmount() { try { root?.unmount(); } catch {} root = null; }
(window as any).HarnessGalaxy = { mount, unmount };
