// The OWNER'S OWN MACHINE, as a render provider.
//
// Modelled as a third party on purpose. It is the first renderer and it will
// not be the last, and the way to make that swap cheap is to give the local
// machine no privileges the next one will not have: it claims queued work over
// the same API, reports through the same job document, and is registered like
// any other adapter. Nothing above this file knows a render happens on a
// laptop.
//
// WHY DISPATCH IS EMPTY. A hosted runner is told there is work; this one
// cannot be, because the machine is behind NAT and has no address the app can
// reach. So it POLLS — the worker asks for the next queued job, claims it, and
// writes its own progress back. `dispatch` therefore has nothing to do, and
// that is a property of the transport rather than a gap: the job document
// already exists and already says `queued` by the time dispatch is called,
// which IS the message.
//
// The consequence worth stating: a render only progresses while the worker is
// running. A job submitted with the machine off sits `queued` indefinitely,
// which is correct and visible, rather than failing. Swapping in a hosted
// provider is what removes that condition.

import { MINIMAL_RENDER_CAPABILITIES, type RenderProvider } from "./provider";

export const LOCAL_RENDER_PROVIDER_ID = "local";

export const localRenderProvider: RenderProvider = {
  id: LOCAL_RENDER_PROVIDER_ID,
  label: "This machine",
  capabilities: {
    ...MINIMAL_RENDER_CAPABILITIES,
    // The worker writes its own progress to the job document as it goes, so
    // the app gets a fraction without this provider having to poll for one.
    progress: true,
    // No cancel: stopping work in flight means reaching the process, and
    // there is no channel to it. A queued job can still be abandoned by the
    // app — that needs no provider involvement.
    cancel: false,
  },
  // The job document is the message. See the note above.
  dispatch: async () => {},
};
