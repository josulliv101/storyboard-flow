import type { Preview } from "@storybook/nextjs-vite";
import React from "react";

import { AuthProvider } from "../components/auth/auth-provider";
import "./preview.css";

const preview: Preview = {
  decorators: [
    (Story) =>
      React.createElement(
        AuthProvider,
        null,
        React.createElement(Story),
      ),
  ],
  parameters: {
    layout: "fullscreen",
    nextjs: {
      appDirectory: true,
    },
  },
};

export default preview;
