import type { Meta, StoryObj } from '@storybook/react';
import type React from 'react';
import { Moon } from 'lucide-react';
import { Button } from '@storyboard/ui';
import { HomeTopNav } from './HomeTopNav';

const HomeStoryShell = ({ children }: { children: React.ReactNode }) => (
  <div
    className="dark min-h-screen bg-[#0a0a0b] text-zinc-100 flex flex-col font-sans selection:bg-indigo-500/30 relative overflow-hidden"
    style={{
      colorScheme: 'dark',
      '--font-sans': 'Outfit, ui-sans-serif, system-ui, sans-serif',
      '--font-coiny': 'Coiny, ui-rounded, ui-sans-serif, system-ui, sans-serif',
    } as React.CSSProperties}
  >
    <div className="absolute top-[-10%] left-[-20%] w-[60vw] h-[60vw] rounded-full bg-gradient-to-br from-indigo-600/10 via-transparent to-transparent blur-3xl pointer-events-none" />
    <div className="absolute bottom-[-10%] right-[-20%] w-[60vw] h-[60vw] rounded-full bg-gradient-to-tl from-violet-600/10 via-transparent to-transparent blur-3xl pointer-events-none" />
    <div className="relative z-10 flex min-h-screen flex-col">{children}</div>
  </div>
);

const meta = {
  title: 'Web/Home/HomeTopNav',
  component: HomeTopNav,
  parameters: {
    layout: 'fullscreen',
  },
  args: {
    onLogout: () => undefined,
    onSignIn: () => undefined,
    themeToggle: (
      <Button
        variant="ghost"
        size="icon"
        className="h-9 w-9 rounded-full text-zinc-600 dark:text-zinc-300"
        aria-label="Toggle theme"
      >
        <Moon className="h-4 w-4" />
      </Button>
    ),
  },
  decorators: [
    Story => (
      <HomeStoryShell>
        <Story />
      </HomeStoryShell>
    ),
  ],
} satisfies Meta<typeof HomeTopNav>;

export default meta;

type Story = StoryObj<typeof meta>;

export const SignedOut: Story = {
  args: {
    currentUser: null,
  },
};

export const Admin: Story = {
  args: {
    currentUser: {
      username: 'jordan',
      role: 'admin',
    },
  },
};

export const Editor: Story = {
  args: {
    currentUser: {
      username: 'maya',
      role: 'editor',
    },
  },
};

export const Viewer: Story = {
  args: {
    currentUser: {
      username: 'sam',
      role: 'viewer',
    },
  },
};

export const Narrow: Story = {
  args: {
    currentUser: null,
  },
  render: args => (
    <div className="max-w-[390px] border-r border-zinc-200 dark:border-zinc-800">
      <HomeTopNav {...args} />
    </div>
  ),
};
