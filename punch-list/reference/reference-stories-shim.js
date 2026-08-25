const __stands = new Map();
const $ = id => {
  const found = document.getElementById(id);
  if (found) return found;
  // A STAND-IN FOR AN ELEMENT THIS SLICE DOES NOT RENDER.
  // The reference is one page wiring the playbar and the deck together; each
  // story shows one half, so the other half's ids are absent. A detached div
  // takes every write the script makes (style, textContent, classList,
  // listeners) and shows none of it, which lets the ORIGINAL logic run
  // unmodified rather than being forked per story.
  //
  // MEMOISED BY ID, because identity matters: `mmTrack.insertBefore(b,
  // mmWindow)` asks whether one lookup is a child of another, and handing back
  // a fresh element per call made that a NotFoundError that stopped the deck
  // being built at all.
  let stand = __stands.get(id);
  if (stand === undefined) {
    stand = document.createElement('div');
    stand.getBoundingClientRect = () => new DOMRect(0, 0, 0, 0);
    const nativeInsert = stand.insertBefore.bind(stand);
    // And forgiving: two stand-ins are siblings of nothing, so an insert
    // positioned against one of them becomes an append.
    stand.insertBefore = (node, ref) =>
      ref && ref.parentNode === stand ? nativeInsert(node, ref) : stand.appendChild(node);
    __stands.set(id, stand);
  }
  return stand;
};
