import type { Preview } from '@storybook/nextjs-vite';
import './preview.css';

const preview: Preview = {
  parameters: {
    actions: {
      argTypesRegex: '^on[A-Z].*',
    },
    layout: 'fullscreen',
    // THE APP ROUTER HAS TO BE DECLARED MOUNTED, or any component reaching for
    // `useRouter`/`usePathname`/`useSearchParams` throws "invariant expected
    // app router to be mounted" — which surfaces as every story in the file
    // failing at render, with nothing about routing in the message.
    //
    // The gstudio app's own Storybook has always set this; this workspace runs
    // the same component stories and did not, so the first app component to
    // read the router here took all 53 of the details view's stories down at
    // once (PL15-029 routed the open item). One line, and the two workspaces
    // now agree about what they are rendering into.
    nextjs: {
      appDirectory: true,
    },
  },
};

export default preview;
