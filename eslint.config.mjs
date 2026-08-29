// Lint for the WORKSPACE PACKAGES. The app has its own config and its own
// `npm run lint`; this one exists because nothing covered `packages/` at all.
//
// WHAT WAS WRONG. eslint's base path is the directory holding the config, so
// running the app's eslint against a workspace package answered:
//
//     0:0  warning  File ignored because outside of base path
//     ✖ 1 problem (0 errors, 1 warning)   exit 0
//
// A warning and a zero exit — which reads as a pass and is not one. Six
// packages, including the only two that ship JSX, had never been linted once.
// `react/display-name` is an ERROR in this repo's app config and has failed a
// Vercel build before; `keel-react` is the package that actually ships JSX.
//
// WHY A SEPARATE CONFIG rather than widening the app's base path: `keel-core`,
// `collections-core`, `timeline-model` and `timeline-domain` are
// framework-agnostic by rule, and inheriting the Next preset would subject them
// to React rules they cannot violate and Next rules about a framework they must
// never import.
//
// TURNING THIS ON FOUND DEAD CODE ON THE FIRST RUN — three unreferenced
// production symbols in keel-core alone, two of them left behind by the fix
// that replaced them, with comments still describing them as live. That is the
// argument for the file.
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";

export default defineConfig([
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/.next-dev/**",
      "**/storybook-static/**",
      "**/coverage/**",
      "**/test-results/**",
      "**/playwright-report/**",
      // The app owns its own config, base path and `lint` script. Linting it
      // from here would apply the wrong ruleset and drop its Next preset.
      "apps/**",
    ],
  },

  {
    files: ["packages/**/*.{ts,tsx}"],
    extends: [...tseslint.configs.recommended],
    rules: {
      // The repo's own rule, stated in AGENTS.md and previously enforced by
      // nothing: "Never use `any`."
      "@typescript-eslint/no-explicit-any": "error",

      // A LEADING UNDERSCORE IS A DECLARATION OF INTENT, and this repo uses it
      // deliberately in three shapes the default rule cannot tell from waste:
      // a required-by-signature parameter the implementation ignores (`_ctx`
      // in a codec that needs no context), a compile-time-only assertion whose
      // whole job is to fail typecheck rather than run
      // (`_previewKindsAreMediaKinds`), and a destructured field discarded on
      // purpose (`_enabled`). Without this the rule reports 6 of its 24 hits
      // on code that is doing exactly what it means to.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],

      // OFF, and this is a considered exemption rather than a shrug. The rule
      // warns that `{}` admits any non-nullish value — true, and the reason it
      // is a good default. Every one of its ten hits here is
      // `createEngine<Types, Summary, {}>`: a type ARGUMENT in a position
      // already constrained to `FoldRegistry<Ts, S>`, spelling "an engine with
      // no folds registered". The constraint does the narrowing the rule is
      // asking for, and `Record<string, never>` would say the same thing less
      // clearly at ten call sites.
      "@typescript-eslint/no-empty-object-type": "off",
    },
  },

  // React rules reach ONLY the files that can violate them. `keel-core` and
  // the other framework-free packages are excluded by the glob, not by an
  // override, so a React rule can never fire on a package whose whole contract
  // is that it does not import React.
  {
    files: ["packages/**/*.tsx"],
    plugins: { react, "react-hooks": reactHooks },
    settings: { react: { version: "detect" } },
    rules: {
      // The one that has actually broken a deploy here. It is an ERROR in the
      // app's config, and the packages shipping JSX had no equivalent.
      "react/display-name": "error",
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
]);
