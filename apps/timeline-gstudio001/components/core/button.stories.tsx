import type { Meta, StoryObj } from '@storybook/react';
import { Button } from './button';

const meta = {
  title: 'GStudio/Core/Button',
  component: Button,
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: { type: 'select' },
      options: ['default', 'destructive', 'outline', 'secondary', 'ghost', 'link'],
      description: 'The visual style variant of the button.',
      table: {
        defaultValue: { summary: 'default' },
      },
    },
    size: {
      control: { type: 'select' },
      options: ['default', 'sm', 'lg', 'icon'],
      description: 'The size of the button.',
      table: {
        defaultValue: { summary: 'default' },
      },
    },
    asChild: {
      control: { type: 'boolean' },
      description:
        'When true, the button renders its child as the root element via Radix Slot.',
      table: {
        defaultValue: { summary: 'false' },
      },
    },
    disabled: {
      control: { type: 'boolean' },
      description: 'Whether the button is disabled.',
    },
    children: {
      control: { type: 'text' },
      description: 'The content rendered inside the button.',
    },
  },
  args: {
    children: 'Button',
    variant: 'default',
    size: 'default',
  },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

// ---------------------------------------------------------------------------
// Default
// ---------------------------------------------------------------------------

export const Default: Story = {
  args: {
    children: 'Button',
  },
};

// ---------------------------------------------------------------------------
// Variant stories
// ---------------------------------------------------------------------------

export const Destructive: Story = {
  args: {
    variant: 'destructive',
    children: 'Destructive',
  },
};

export const Outline: Story = {
  args: {
    variant: 'outline',
    children: 'Outline',
  },
};

export const Secondary: Story = {
  args: {
    variant: 'secondary',
    children: 'Secondary',
  },
};

export const Ghost: Story = {
  args: {
    variant: 'ghost',
    children: 'Ghost',
  },
};

export const Link: Story = {
  args: {
    variant: 'link',
    children: 'Link',
  },
};

// ---------------------------------------------------------------------------
// Size stories
// ---------------------------------------------------------------------------

export const SizeDefault: Story = {
  name: 'Size / Default',
  args: {
    size: 'default',
    children: 'Default Size',
  },
};

export const SizeSmall: Story = {
  name: 'Size / Small',
  args: {
    size: 'sm',
    children: 'Small',
  },
};

export const SizeLarge: Story = {
  name: 'Size / Large',
  args: {
    size: 'lg',
    children: 'Large',
  },
};

export const SizeIcon: Story = {
  name: 'Size / Icon',
  args: {
    size: 'icon',
    children: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M5 12h14" />
        <path d="m12 5 7 7-7 7" />
      </svg>
    ),
  },
};

// ---------------------------------------------------------------------------
// Disabled state
// ---------------------------------------------------------------------------

export const Disabled: Story = {
  args: {
    disabled: true,
    children: 'Disabled',
  },
};

// ---------------------------------------------------------------------------
// With icon
// ---------------------------------------------------------------------------

export const WithIcon: Story = {
  args: {
    children: (
      <>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3" />
        </svg>
        With Icon
      </>
    ),
  },
};
