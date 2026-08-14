// THE registry instance the render routes resolve providers from. Server-only
// by composition, matching lib/assets/registry.ts.
//
// Adding a renderer = one adapter file + one entry here. The local machine is
// first, which also makes it the default — deliberate while it is the only
// one, and the line to change when a hosted renderer should take over.

import { localRenderProvider } from "./local-provider";
import { createRenderProviderRegistry, type RenderProvider } from "./provider";

const providers: RenderProvider[] = [localRenderProvider];

export const renderProviders = createRenderProviderRegistry(providers);
