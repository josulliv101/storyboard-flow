/**
 * Shared collection accent gradient utilities.
 *
 * Used by CollectionRepeatedMediaTile (the collection tile itself) and
 * TimelineClipItemContent (the endpoint-exposed neighbor clip) so both render
 * the same accent bar with the same color when an endpoint is selected.
 */
const collectionAccentGradients = [
    "linear-gradient(90deg, #38bdf8 0%, #6366f1 52%, rgba(56, 189, 248, 0) 100%)",
    "linear-gradient(90deg, #f59e0b 0%, #f97316 52%, rgba(249, 115, 22, 0) 100%)",
    "linear-gradient(90deg, #22c55e 0%, #14b8a6 52%, rgba(20, 184, 166, 0) 100%)",
    "linear-gradient(90deg, #ec4899 0%, #a855f7 52%, rgba(168, 85, 247, 0) 100%)",
    "linear-gradient(90deg, #f43f5e 0%, #fb7185 52%, rgba(244, 63, 94, 0) 100%)",
    "linear-gradient(90deg, #84cc16 0%, #eab308 52%, rgba(234, 179, 8, 0) 100%)",
    "linear-gradient(90deg, #06b6d4 0%, #0ea5e9 52%, rgba(14, 165, 233, 0) 100%)",
    "linear-gradient(90deg, #8b5cf6 0%, #d946ef 52%, rgba(217, 70, 239, 0) 100%)",
];
export function getCollectionAccentGradientByIndex(accentIndex) {
    return collectionAccentGradients[Math.abs(accentIndex) % collectionAccentGradients.length];
}
