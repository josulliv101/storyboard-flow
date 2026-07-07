"use client";
import { useCallback, useState } from "react";
import { getFolderPathFromTimelineId } from "../timeline-documents";
import { reindexAndPackClips } from "../hooks/use-timeline-clips";
function getMediaDuration(file) {
    return new Promise((resolve) => {
        if (!file.type.startsWith("video/")) {
            resolve(4);
            return;
        }
        const video = document.createElement("video");
        video.preload = "metadata";
        const sourceUrl = URL.createObjectURL(file);
        const cleanup = () => {
            URL.revokeObjectURL(sourceUrl);
            video.removeAttribute("src");
            video.load();
        };
        video.onloadedmetadata = () => {
            const duration = Number.isFinite(video.duration) && video.duration > 0
                ? video.duration
                : 5;
            cleanup();
            resolve(duration);
        };
        video.onerror = () => {
            cleanup();
            resolve(5);
        };
        video.src = sourceUrl;
    });
}
export function useTimelineUploadHandler({ applyLocalClipsNow, clips, getTimelineDocument, getTimelinePath, timelineId, uploadTimelineMedia, userId, }) {
    const [mediaUploadError, setMediaUploadError] = useState(null);
    const [isUploadingMedia, setIsUploadingMedia] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);
    const handleDropFiles = useCallback(async (insertIndex, files) => {
        var _a;
        setMediaUploadError(null);
        setIsUploadingMedia(true);
        setUploadProgress(10);
        const progressInterval = window.setInterval(() => {
            setUploadProgress((previous) => {
                if (previous >= 90)
                    return previous;
                return previous + Math.random() * 5;
            });
        }, 300);
        try {
            const newClipResults = await Promise.all(files.map(async (file, index) => {
                const isVideo = file.type.startsWith("video/");
                const isImage = file.type.startsWith("image/");
                if (!isVideo && !isImage)
                    return { clip: null };
                const duration = await getMediaDuration(file);
                const uniqueId = `clip-${Date.now()}-${Math.random()
                    .toString(36)
                    .substr(2, 9)}`;
                if (!uploadTimelineMedia) {
                    return {
                        clip: null,
                        error: `"${file.name}" was not added because media uploads are not configured.`,
                    };
                }
                let folderPath;
                const uploadUserId = userId || "default";
                const thisTimelineId = timelineId || "";
                if (thisTimelineId.startsWith("asset-library")) {
                    folderPath =
                        getFolderPathFromTimelineId(thisTimelineId, uploadUserId) ||
                            undefined;
                }
                else if (thisTimelineId &&
                    thisTimelineId !== "root" &&
                    !thisTimelineId.startsWith("project-")) {
                    const pathSegments = getTimelinePath(thisTimelineId).map((segment) => segment.title);
                    const document = getTimelineDocument(thisTimelineId);
                    if (document) {
                        pathSegments.push(document.title);
                    }
                    folderPath = pathSegments.join("/");
                }
                let hostedMedia;
                try {
                    hostedMedia = await uploadTimelineMedia(file.name, file, folderPath);
                }
                catch (error) {
                    console.warn(`Failed to upload "${file.name}" to hosted media storage`, error);
                    return {
                        clip: null,
                        error: `"${file.name}" was not added because it could not be uploaded to hosted media storage.`,
                    };
                }
                if (isVideo && !hostedMedia.thumbnailUrl) {
                    return {
                        clip: null,
                        error: `"${file.name}" was not added because a video thumbnail could not be saved.`,
                    };
                }
                if (isVideo) {
                    const clipDuration = Math.min(12, duration);
                    return {
                        clip: {
                            id: uniqueId,
                            index: insertIndex + index,
                            kind: "video",
                            src: hostedMedia.url,
                            poster: hostedMedia.thumbnailUrl,
                            alt: file.name,
                            aspect: 16 / 9,
                            trackIndex: 0,
                            startTime: 0,
                            duration: clipDuration,
                            sourceDuration: duration,
                            trimIn: 0,
                            trimOut: Math.max(0, duration - clipDuration),
                        },
                    };
                }
                return {
                    clip: {
                        id: uniqueId,
                        index: insertIndex + index,
                        kind: "image",
                        src: hostedMedia.url,
                        alt: file.name,
                        aspect: 16 / 9,
                        trackIndex: 0,
                        startTime: 0,
                        duration: 4,
                        sourceDuration: 4,
                        trimIn: 0,
                        trimOut: 0,
                    },
                };
            }));
            const firstUploadError = (_a = newClipResults.find((result) => result.error)) === null || _a === void 0 ? void 0 : _a.error;
            if (firstUploadError) {
                setMediaUploadError(firstUploadError);
            }
            const newClips = newClipResults
                .map((result) => result.clip)
                .filter((clip) => clip !== null);
            if (newClips.length === 0)
                return;
            const nextClips = [...clips];
            nextClips.splice(insertIndex, 0, ...newClips);
            applyLocalClipsNow(reindexAndPackClips(nextClips));
        }
        finally {
            window.clearInterval(progressInterval);
            setUploadProgress(100);
            window.setTimeout(() => {
                setIsUploadingMedia(false);
                setUploadProgress(0);
            }, 500);
        }
    }, [
        applyLocalClipsNow,
        clips,
        getTimelineDocument,
        getTimelinePath,
        timelineId,
        uploadTimelineMedia,
        userId,
    ]);
    return {
        handleDropFiles,
        isUploadingMedia,
        mediaUploadError,
        uploadProgress,
    };
}
