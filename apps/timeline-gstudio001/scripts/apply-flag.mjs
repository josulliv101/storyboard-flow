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
 * The env fallback, in the syntax of the shell actually in use.
 *
 * THE SECOND FAILURE. The first version of this notice printed the bash form
 * unconditionally. On Windows/PowerShell `PRUNE_APPLY=1 npm run …` is not a
 * command at all — PowerShell answers "PRUNE_APPLY=1 is not recognized" — so
 * the notice told a PowerShell operator to run something that cannot work.
 * Printing a confident, wrong instruction is the same bug this file exists to
 * stop, so the escape hatch has to be written in the reader's shell.
 */
function envForms(script, envVar) {
  if (process.platform !== "win32") return [`  ${envVar}=1 npm run ${script}`];
  return [
    `  $env:${envVar}="1"; npm run ${script}     (PowerShell)`,
    `  set ${envVar}=1 && npm run ${script}      (cmd.exe)`,
    "",
    `  In PowerShell $env:${envVar} STAYS SET for the rest of the session, so a`,
    `  later plain \`npm run ${script}\` will also delete. Clear it when done:`,
    `  Remove-Item Env:${envVar}`,
  ];
}

/**
 * The closing line of a dry run. Deliberately states the NEGATIVE outcome
 * first: "Dry run" alone reads as a mode, not as a result, and the whole
 * failure above was someone reading it as success.
 *
 * `-- --apply` is given first because it is the one form that works from both
 * the repo root and this workspace, in every shell, and leaves nothing behind.
 * It only survives the root proxy because those scripts end in a trailing `--`
 * (root package.json) — without it npm re-swallows the flag one level down.
 */
export function dryRunNotice(script, envVar) {
  return [
    "",
    "NOTHING WAS DELETED — this was a dry run.",
    "",
    "To actually delete, run this EXACTLY (works from the repo root or this",
    "workspace, in any shell):",
    `  npm run ${script} -- --apply        (note the bare -- separator)`,
    "",
    "Or set the environment variable instead:",
    ...envForms(script, envVar),
    "",
    `Beware: \`npm run ${script} --apply\` without the separator is silently`,
    "discarded by npm. The script never sees it and you get this message again.",
  ].join("\n");
}
