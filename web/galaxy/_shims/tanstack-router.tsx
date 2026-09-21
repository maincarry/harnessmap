import React from "react";
// Island shim: the galaxy runs embedded in HarnessMap, not under TanStack Router.
// Render Link as a plain anchor (the only router API the galaxy view uses).
export function Link({ to, children, ...rest }: any) {
  return React.createElement("a", { href: typeof to === "string" ? to : "#", ...rest }, children);
}
export default { Link };
