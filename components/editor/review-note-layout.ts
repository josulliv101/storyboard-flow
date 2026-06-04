export type ReviewMomentExpansion = {
  startFrame: number;
  scrollStart: number;
  duration: number;
};

export const scheduleReviewMomentExpansions = (expansions: ReviewMomentExpansion[]) => {
  let insertedScrollDistance = 0;

  return [...expansions]
    .sort((a, b) => a.scrollStart - b.scrollStart || a.startFrame - b.startFrame)
    .map(expansion => {
      const scheduledExpansion = {
        ...expansion,
        scrollStart: expansion.scrollStart + insertedScrollDistance,
      };
      insertedScrollDistance += expansion.duration;
      return scheduledExpansion;
    });
};
