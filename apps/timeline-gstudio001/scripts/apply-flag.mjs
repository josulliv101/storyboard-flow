// Read the "yes, actually write" signal for a destructive script.
//
// THE FAILURE THIS EXISTS FOR. `npm run prune:orphans --apply` does not pass
// the flag to the script: npm treats anything between the script name and a
// `--` separator as its own config. The script then printed "Dry run" and
// deleted nothing, which is indistinguishable from the dry run the operator
// had deliberately run a minute earlier — so it read as "done" and 87
// documents survived a delete everyone believed had happened.
//
// AND IT CANNOT BE DETECTED. Verified on npm 11.12.1: an unrecognised flag is
// discarded outright. No `npm_config_apply`, no `npm_config_argv` (removed in
// npm 7+), nothing in `npm_lifecycle_script`. The script has no way to know it
// was asked. An earlier version of this file tried to catch it that way and
// silently never fired, which was the same bug wearing a hat.
//
// So the mitigation is twofold, and neither half is detection:
//
//   1. AN ENV FORM npm CANNOT EAT. `PRUNE_APPLY=1 npm run …` survives every
//      layer, so there is a spelling that cannot fail quietly. It must be
//      typed on the command line to mean anything, which is the same
//      deliberate act as `--apply`.
//   2. A DRY RUN THAT SAYS SO. The closing line states that nothing was
//      deleted and names both working forms, so the outcome is legible even to
//      someone who believes they just ran the real thing.

/**
 * @param {string} script  npm script name, for the printed commands.
 * @param {string} envVar  the un-swallowable alternative, e.g. "PRUNE_APPLY".
 * @returns {boolean} true when the caller genuinely asked to write.
 */
export function readApplyFlag(script, envVar) {
  if (process.argv.includes("--apply")) return true;
  const fromEnv = process.env[envVar];
  return fromEnv !== undefined && fromEnv !== "" && fromEnv !== "0" && fromEnv !== "false";
}

/**
 * The closing line of a dry run. Deliberately states the NEGATIVE outcome
 * first: "Dry run" alone reads as a mode, not as a result, and the whole
 * failure above was someone reading it as success.
 */
export function dryRunNotice(script, envVar) {
  return [
    "",
    "NOTHING WAS DELETED — this was a dry run.",
    "",
    "To actually delete, use one of these EXACTLY:",
    `  npm run ${script} -- --apply        (note the bare -- separator)`,
    `  ${envVar}=1 npm run ${script}`,
    "",
    `Beware: \`npm run ${script} --apply\` without the separator is silently`,
    "discarded by npm. The script never sees it and you get this message again.",
  ].join("\n");
}
