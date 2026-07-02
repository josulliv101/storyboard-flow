"use client";

import { useRouter } from "next/navigation";
import {
  SmoothScrollList as SharedSmoothScrollList,
  type SmoothScrollListProps,
} from "@storyboard/ui/timeline/viewport/smooth-scroll-list";

import { useAuth } from "@/components/auth/auth-provider";
import { uploadTimelineMedia } from "@/lib/timeline-media-client";

export function SmoothScrollList(props: SmoothScrollListProps) {
  const router = useRouter();
  const { user, isLoading } = useAuth();

  return (
    <SharedSmoothScrollList
      {...props}
      navigate={(href) => router.push(href)}
      persistenceReady={!isLoading && Boolean(user)}
      uploadTimelineMedia={uploadTimelineMedia}
      userId={user?.uid ?? null}
    />
  );
}
