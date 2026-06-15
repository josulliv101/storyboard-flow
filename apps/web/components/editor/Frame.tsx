'use client';

import React, { useRef, useEffect } from 'react';
import { useTimeline, TimelineClip, PreviewMediaLayout, ClipType } from '@/lib/timeline-context';

const INSET_MEDIA_PERCENT = 82;

export const getPreviewMediaStyle = (layout: PreviewMediaLayout): React.CSSProperties => ({
  width: layout === 'inset' ? `${INSET_MEDIA_PERCENT}%` : '100%',
  height: layout === 'inset' ? `${INSET_MEDIA_PERCENT}%` : '100%',
  position: 'absolute',
  bottom: 0,
  right: 0,
  left: 'auto',
  top: 'auto',
  objectFit: 'cover',
  boxSizing: 'border-box',
  backgroundColor: '#070709',
  border: '1px solid rgba(255,255,255,0.22)',
  boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.42), 0 0 0 1px rgba(255,255,255,0.08)',
});

const syncVideoAudioState = (video: HTMLVideoElement, muted: boolean) => {
  video.muted = muted;
  video.defaultMuted = muted;
  video.volume = muted ? 0 : 1;

  if (muted) {
    video.setAttribute('muted', '');
  } else {
    video.removeAttribute('muted');
  }
};

export const Frame = React.memo(function FrameInner({
  clip,
  currentFrame,
  isPlaying,
  fps,
  playbackRate,
  muted,
  mediaLayout,
}: {
  clip: TimelineClip;
  currentFrame: number;
  isPlaying: boolean;
  fps: number;
  playbackRate: number;
  muted: boolean;
  mediaLayout: PreviewMediaLayout;
}) {
  const { updateClip } = useTimeline();

  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Buffers
  const videoARef = useRef<HTMLVideoElement | null>(
    typeof window !== 'undefined' ? (() => {
      const v = document.createElement('video');
      v.playsInline = true;
      v.preload = 'auto';
      v.muted = true;
      v.volume = 0;
      return v;
    })() : null
  );
  const videoBRef = useRef<HTMLVideoElement | null>(
    typeof window !== 'undefined' ? (() => {
      const v = document.createElement('video');
      v.playsInline = true;
      v.preload = 'auto';
      v.muted = true;
      v.volume = 0;
      return v;
    })() : null
  );
  const imageARef = useRef<HTMLImageElement | null>(
    typeof window !== 'undefined' ? new Image() : null
  );
  const imageBRef = useRef<HTMLImageElement | null>(
    typeof window !== 'undefined' ? new Image() : null
  );

  // Cache canvas to hold previous frame to prevent seek flash
  const cacheCanvasRef = useRef<HTMLCanvasElement | null>(
    typeof window !== 'undefined' ? document.createElement('canvas') : null
  );
  const hasCachedFrameRef = useRef(false);
  const imageALoadedSrcRef = useRef<string | null>(null);
  const imageBLoadedSrcRef = useRef<string | null>(null);

  // Playback state and identification refs
  const activeBufferRef = useRef<'A' | 'B'>('A');
  const activeClipIdRef = useRef<string | null>(null);
  const activeSrcRef = useRef<string | null>(null);
  const activeTypeRef = useRef<ClipType | null>(null);
  const activeTrimStartRef = useRef<number>(0);
  const activeStartFrameRef = useRef<number>(0);

  // Transition refs
  const transitionActiveRef = useRef(false);
  const transitionStartRef = useRef<number>(0);
  const transitionDuration = 200; // ms
  const prevBufferRef = useRef<'A' | 'B' | null>(null);
  const prevTypeRef = useRef<ClipType | null>(null);

  const nextBufferReadyRef = useRef(false);
  const nextClipRef = useRef<TimelineClip | null>(null);
  const isFirstLoadRef = useRef(true);

  // Parameter refs to prevent React hook closure lag
  const currentFrameRef = useRef(currentFrame);
  const isPlayingRef = useRef(isPlaying);
  const playbackRateRef = useRef(playbackRate);
  const mutedRef = useRef(muted);
  const fpsRef = useRef(fps);

  // Keep refs in sync
  useEffect(() => {
    currentFrameRef.current = currentFrame;
  }, [currentFrame]);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
    if (isPlaying) {
      hasCachedFrameRef.current = false; // clear cache to prevent flashes
    }
  }, [isPlaying]);

  useEffect(() => {
    playbackRateRef.current = playbackRate;
  }, [playbackRate]);

  useEffect(() => {
    fpsRef.current = fps;
  }, [fps]);

  useEffect(() => {
    mutedRef.current = muted;
    // Update audio on the active video
    const activeVid = activeBufferRef.current === 'A' ? videoARef.current : videoBRef.current;
    const inactiveVid = activeBufferRef.current === 'A' ? videoBRef.current : videoARef.current;
    if (activeVid) syncVideoAudioState(activeVid, muted);
    if (inactiveVid) syncVideoAudioState(inactiveVid, true);
  }, [muted]);

  // Sizing cover helper function in 2D space
  const drawElementCover = (
    ctx: CanvasRenderingContext2D,
    el: CanvasImageSource,
    elWidth: number,
    elHeight: number,
    targetWidth: number,
    targetHeight: number
  ) => {
    if (elWidth === 0 || elHeight === 0 || targetWidth === 0 || targetHeight === 0) return;

    const elRatio = elWidth / elHeight;
    const targetRatio = targetWidth / targetHeight;

    let sx = 0;
    let sy = 0;
    let sWidth = elWidth;
    let sHeight = elHeight;

    if (elRatio > targetRatio) {
      sWidth = elHeight * targetRatio;
      sx = (elWidth - sWidth) / 2;
    } else {
      sHeight = elWidth / targetRatio;
      sy = (elHeight - sHeight) / 2;
    }

    ctx.drawImage(el, sx, sy, sWidth, sHeight, 0, 0, targetWidth, targetHeight);
  };

  // Draw buffer
  const drawBuffer = (
    ctx: CanvasRenderingContext2D,
    buffer: 'A' | 'B',
    type: ClipType | null,
    width: number,
    height: number
  ) => {
    const cacheCanvas = cacheCanvasRef.current;
    if (type === 'video') {
      const video = buffer === 'A' ? videoARef.current : videoBRef.current;
      if (!video) return;

      const isSeeking = video.seeking;
      const isReady = video.readyState >= 2;
      const isLoaded = video.readyState >= 1; // has metadata

      if (isReady || (isSeeking && isLoaded)) {
        drawElementCover(ctx, video, video.videoWidth, video.videoHeight, width, height);
        if (!isSeeking && cacheCanvas) {
          if (cacheCanvas.width !== video.videoWidth || cacheCanvas.height !== video.videoHeight) {
            cacheCanvas.width = video.videoWidth;
            cacheCanvas.height = video.videoHeight;
          }
          const cacheCtx = cacheCanvas.getContext('2d');
          if (cacheCtx) {
            cacheCtx.drawImage(video, 0, 0);
            hasCachedFrameRef.current = true;
          }
        }
      } else {
        // Draw from cache if available to prevent flash of blank screen
        if (hasCachedFrameRef.current && cacheCanvas) {
          drawElementCover(ctx, cacheCanvas, cacheCanvas.width, cacheCanvas.height, width, height);
        } else {
          ctx.fillStyle = '#000000';
          ctx.fillRect(0, 0, width, height);
        }
      }
    } else if (type === 'image') {
      const image = buffer === 'A' ? imageARef.current : imageBRef.current;
      const loadedSrc = buffer === 'A' ? imageALoadedSrcRef.current : imageBLoadedSrcRef.current;
      const isActiveSrcLoaded = loadedSrc === activeSrcRef.current;

      if (!image || !image.complete || image.naturalWidth === 0 || !isActiveSrcLoaded) {
        if (hasCachedFrameRef.current && cacheCanvas) {
          drawElementCover(ctx, cacheCanvas, cacheCanvas.width, cacheCanvas.height, width, height);
        } else {
          ctx.fillStyle = '#000000';
          ctx.fillRect(0, 0, width, height);
        }
        return;
      }

      drawElementCover(ctx, image, image.naturalWidth, image.naturalHeight, width, height);

      if (cacheCanvas) {
        if (cacheCanvas.width !== image.naturalWidth || cacheCanvas.height !== image.naturalHeight) {
          cacheCanvas.width = image.naturalWidth;
          cacheCanvas.height = image.naturalHeight;
        }
        const cacheCtx = cacheCanvas.getContext('2d');
        if (cacheCtx) {
          cacheCtx.drawImage(image, 0, 0);
          hasCachedFrameRef.current = true;
        }
      }
    } else {
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, width, height);
    }
  };

  // Complete cross-fade transition
  const completeTransition = () => {
    transitionActiveRef.current = false;
    const oldVideo = prevBufferRef.current === 'A' ? videoARef.current : videoBRef.current;
    if (oldVideo) {
      oldVideo.pause();
      syncVideoAudioState(oldVideo, true);
    }
    prevBufferRef.current = null;
    prevTypeRef.current = null;
  };

  // Main draw loop
  const drawCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const width = Math.round(rect.width) || 640;
    const height = Math.round(rect.height) || 360;

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    let progress = 1.0;
    if (transitionActiveRef.current) {
      const elapsed = performance.now() - transitionStartRef.current;
      progress = Math.min(1.0, elapsed / transitionDuration);
      if (progress >= 1.0) {
        completeTransition();
      }
    }

    ctx.clearRect(0, 0, width, height);

    // Draw previous buffer (if in transition)
    if (progress < 1.0 && prevBufferRef.current) {
      ctx.globalAlpha = 1.0 - progress;
      drawBuffer(ctx, prevBufferRef.current, prevTypeRef.current, width, height);
    }

    // Draw current active buffer
    ctx.globalAlpha = progress;
    drawBuffer(ctx, activeBufferRef.current, activeTypeRef.current, width, height);

    ctx.globalAlpha = 1.0;
  };

  // Transition launch helper
  const startTransition = (nextBuffer: 'A' | 'B', targetClip: TimelineClip) => {
    const oldVideo = activeBufferRef.current === 'A' ? videoARef.current : videoBRef.current;
    if (oldVideo) {
      oldVideo.pause();
      syncVideoAudioState(oldVideo, true);
    }

    activeBufferRef.current = nextBuffer;
    activeTypeRef.current = targetClip.type;
    activeClipIdRef.current = targetClip.id;
    activeSrcRef.current = targetClip.src || null;
    activeTrimStartRef.current = targetClip.trimStart || 0;
    activeStartFrameRef.current = targetClip.startFrame || 0;
    hasCachedFrameRef.current = false; // Invalidate cache of the previous clip

    const newVideo = nextBuffer === 'A' ? videoARef.current : videoBRef.current;
    if (newVideo) {
      syncVideoAudioState(newVideo, mutedRef.current);
      newVideo.playbackRate = playbackRateRef.current;
      if (targetClip.type === 'video') {
        const trimOffset = targetClip.trimStart || 0;
        const targetTime = Math.max(0, (trimOffset + (currentFrameRef.current - targetClip.startFrame)) / fpsRef.current);
        if (Math.abs(newVideo.currentTime - targetTime) > 0.1) {
          newVideo.currentTime = targetTime;
        }
      }
      if (isPlayingRef.current) {
        newVideo.play().catch((err) => {
          if (err && err.name === 'NotAllowedError') {
            newVideo.muted = true;
            newVideo.play().catch(() => {});
          }
        });
      }
    }

    transitionActiveRef.current = false;
    prevBufferRef.current = null;
    prevTypeRef.current = null;
  };

  // Load new clip into inactive buffer
  const loadClipIntoInactiveBuffer = (targetClip: TimelineClip) => {
    const nextBuffer = activeBufferRef.current === 'A' ? 'B' : 'A';
    const nextVideo = nextBuffer === 'A' ? videoARef.current : videoBRef.current;
    const nextImage = nextBuffer === 'A' ? imageARef.current : imageBRef.current;

    if (!nextVideo || !nextImage) return;

    nextBufferReadyRef.current = false;
    nextClipRef.current = targetClip;

    const trimOffset = targetClip.trimStart || 0;
    const targetTime = Math.max(0, (trimOffset + (currentFrameRef.current - targetClip.startFrame)) / fpsRef.current);

    const onReady = () => {
      if (nextClipRef.current?.id !== targetClip.id) return; // Stale load
      nextBufferReadyRef.current = true;
      startTransition(nextBuffer, targetClip);
    };

    if (targetClip.type === 'video') {
      nextVideo.src = targetClip.src || '';
      nextVideo.load();
      nextVideo.playbackRate = playbackRateRef.current;
      syncVideoAudioState(nextVideo, true);

      const onMetadataLoaded = () => {
        nextVideo.removeEventListener('loadedmetadata', onMetadataLoaded);
        nextVideo.currentTime = targetTime;
      };
      nextVideo.addEventListener('loadedmetadata', onMetadataLoaded);

      const handleSeeked = () => {
        const latestTrimOffset = targetClip.trimStart || 0;
        const latestTargetTime = Math.max(0, (latestTrimOffset + (currentFrameRef.current - targetClip.startFrame)) / fpsRef.current);
        
        if (Math.abs(nextVideo.currentTime - latestTargetTime) > 0.1) {
          nextVideo.currentTime = latestTargetTime;
          return;
        }

        nextVideo.removeEventListener('seeked', handleSeeked);
        nextVideo.removeEventListener('canplay', handleSeeked);
        nextVideo.removeEventListener('error', handleError);
        onReady();
      };

      const handleError = () => {
        nextVideo.removeEventListener('seeked', handleSeeked);
        nextVideo.removeEventListener('canplay', handleSeeked);
        nextVideo.removeEventListener('error', handleError);
        onReady();
      };

      nextVideo.addEventListener('seeked', handleSeeked);
      nextVideo.addEventListener('canplay', handleSeeked);
      nextVideo.addEventListener('error', handleError);
    } else if (targetClip.type === 'image') {
      nextImage.onload = () => {
        if (nextBuffer === 'A') {
          imageALoadedSrcRef.current = targetClip.src || '';
        } else {
          imageBLoadedSrcRef.current = targetClip.src || '';
        }
        onReady();
      };
      nextImage.onerror = () => {
        if (nextBuffer === 'A') {
          imageALoadedSrcRef.current = targetClip.src || '';
        } else {
          imageBLoadedSrcRef.current = targetClip.src || '';
        }
        onReady();
      };
      nextImage.src = targetClip.src || '';
    } else {
      onReady();
    }
  };

  // Initialize offscreen media and loop
  useEffect(() => {
    const vA = videoARef.current;
    const vB = videoBRef.current;
    if (!vA || !vB) return;

    const handleSeeked = (e: Event) => {
      const vid = e.currentTarget as HTMLVideoElement;
      const activeVid = activeBufferRef.current === 'A' ? videoARef.current : videoBRef.current;
      if (vid !== activeVid) return; // Only control active video playback
      if (isPlayingRef.current && vid.paused) {
        syncVideoAudioState(vid, mutedRef.current);
        vid.playbackRate = playbackRateRef.current;
        vid.play().catch((err) => {
          if (err && err.name === 'NotAllowedError') {
            vid.muted = true;
            vid.play().catch(() => {});
          }
        });
      }
    };

    const handleCanPlay = (e: Event) => {
      const vid = e.currentTarget as HTMLVideoElement;
      const activeVid = activeBufferRef.current === 'A' ? videoARef.current : videoBRef.current;
      if (vid !== activeVid) return; // Only control active video playback
      if (isPlayingRef.current && vid.paused && !vid.seeking) {
        syncVideoAudioState(vid, mutedRef.current);
        vid.playbackRate = playbackRateRef.current;
        vid.play().catch((err) => {
          if (err && err.name === 'NotAllowedError') {
            vid.muted = true;
            vid.play().catch(() => {});
          }
        });
      }
    };

    vA.addEventListener('seeked', handleSeeked);
    vA.addEventListener('canplay', handleCanPlay);
    vB.addEventListener('seeked', handleSeeked);
    vB.addEventListener('canplay', handleCanPlay);

    let animationFrameId: number;
    const render = () => {
      drawCanvas();
      animationFrameId = requestAnimationFrame(render);
    };
    animationFrameId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animationFrameId);
      vA.removeEventListener('seeked', handleSeeked);
      vA.removeEventListener('canplay', handleCanPlay);
      vB.removeEventListener('seeked', handleSeeked);
      vB.removeEventListener('canplay', handleCanPlay);
      vA.pause();
      vA.src = '';
      vA.load();
      vB.pause();
      vB.src = '';
      vB.load();
    };
  }, []);

  // Monitor active clip prop change
  useEffect(() => {
    if (!clip || !clip.src) {
      activeClipIdRef.current = null;
      activeSrcRef.current = null;
      activeTypeRef.current = null;
      return;
    }

    if (isFirstLoadRef.current) {
      isFirstLoadRef.current = false;
      const activeVideo = videoARef.current;
      const activeImage = imageARef.current;
      if (!activeVideo || !activeImage) return;

      activeClipIdRef.current = clip.id;
      activeSrcRef.current = clip.src || null;
      activeTypeRef.current = clip.type;
      activeBufferRef.current = 'A';
      activeTrimStartRef.current = clip.trimStart || 0;
      activeStartFrameRef.current = clip.startFrame || 0;
      hasCachedFrameRef.current = false; // Reset cached frame to prevent drawing wrong frames

      const trimOffset = clip.trimStart || 0;
      const targetTime = Math.max(0, (trimOffset + (currentFrameRef.current - clip.startFrame)) / fpsRef.current);

      if (clip.type === 'video') {
        activeVideo.src = clip.src || '';
        activeVideo.load();
        activeVideo.playbackRate = playbackRateRef.current;
        syncVideoAudioState(activeVideo, mutedRef.current);

        const onMetadataLoaded = () => {
          activeVideo.removeEventListener('loadedmetadata', onMetadataLoaded);
          activeVideo.currentTime = targetTime;
        };
        activeVideo.addEventListener('loadedmetadata', onMetadataLoaded);

        const handleSeeked = () => {
          activeVideo.removeEventListener('seeked', handleSeeked);
          if (isPlayingRef.current) {
            activeVideo.play().catch(() => {});
          }
        };
        activeVideo.addEventListener('seeked', handleSeeked);
      } else if (clip.type === 'image') {
        activeImage.onload = () => {
          imageALoadedSrcRef.current = clip.src || '';
        };
        activeImage.onerror = () => {
          imageALoadedSrcRef.current = clip.src || '';
        };
        activeImage.src = clip.src || '';
      }
    } else {
      if (clip.id !== activeClipIdRef.current || clip.src !== activeSrcRef.current || clip.type !== activeTypeRef.current) {
        loadClipIntoInactiveBuffer(clip);
      } else {
        // Same clip, seek if properties (like trimStart or startFrame) changed
        const activeVid = activeBufferRef.current === 'A' ? videoARef.current : videoBRef.current;
        activeTrimStartRef.current = clip.trimStart || 0;
        activeStartFrameRef.current = clip.startFrame || 0;
        if (activeVid && clip.type === 'video') {
          const trimOffset = clip.trimStart || 0;
          const targetTime = Math.max(0, (trimOffset + (currentFrameRef.current - clip.startFrame)) / fpsRef.current);
          if (Math.abs(activeVid.currentTime - targetTime) > 0.1) {
            activeVid.currentTime = targetTime;
          }
        }
      }
    }
  }, [clip.id, clip.src, clip.trimStart, clip.startFrame, clip.type]);

  // Window events for playback sync
  useEffect(() => {
    const handleFrameUpdate = (e: Event) => {
      const customEvent = e as CustomEvent<{ frame: number }>;
      const frame = customEvent.detail.frame;

      currentFrameRef.current = frame;

      const activeVid = activeBufferRef.current === 'A' ? videoARef.current : videoBRef.current;
      if (!activeVid || activeTypeRef.current !== 'video') return;

      const trimOffset = activeTrimStartRef.current;
      const startFrame = activeStartFrameRef.current;
      const targetTime = Math.max(0, (trimOffset + (frame - startFrame)) / fpsRef.current);

      if (!isPlayingRef.current) {
        if (Math.abs(activeVid.currentTime - targetTime) > 0.05) {
          activeVid.currentTime = targetTime;
        }
      } else {
        if (activeVid.paused && !activeVid.ended) {
          if (Math.abs(activeVid.currentTime - targetTime) > 0.1) {
            activeVid.currentTime = targetTime;
          } else {
            syncVideoAudioState(activeVid, mutedRef.current);
            activeVid.playbackRate = playbackRateRef.current;
            activeVid.play().catch((err) => {
              if (err && err.name === 'NotAllowedError') {
                activeVid.muted = true;
                activeVid.play().catch(() => {});
              }
            });
          }
        }

        const timeDiff = activeVid.currentTime - targetTime;
        if (Math.abs(timeDiff) > 1.0) {
          activeVid.currentTime = targetTime;
        }
      }
    };

    window.addEventListener('timeline-frame-update', handleFrameUpdate);
    return () => {
      window.removeEventListener('timeline-frame-update', handleFrameUpdate);
    };
  }, []);

  useEffect(() => {
    const handlePlayRequest = () => {
      const activeVid = activeBufferRef.current === 'A' ? videoARef.current : videoBRef.current;
      if (!activeVid || activeTypeRef.current !== 'video') return;

      const trimOffset = activeTrimStartRef.current;
      const startFrame = activeStartFrameRef.current;
      const targetTime = Math.max(0, (trimOffset + (currentFrameRef.current - startFrame)) / fpsRef.current);

      if (activeVid.ended || Math.abs(activeVid.currentTime - targetTime) > 0.1) {
        activeVid.currentTime = targetTime;
      }
      activeVid.playbackRate = playbackRateRef.current;
      syncVideoAudioState(activeVid, mutedRef.current);
      activeVid.play().catch((err) => {
        if (err && err.name === 'NotAllowedError') {
          activeVid.muted = true;
          activeVid.play().catch(() => {});
        }
      });
    };

    window.addEventListener('timeline-preview-play-request', handlePlayRequest);
    return () => {
      window.removeEventListener('timeline-preview-play-request', handlePlayRequest);
    };
  }, []);

  useEffect(() => {
    const activeVid = activeBufferRef.current === 'A' ? videoARef.current : videoBRef.current;
    if (!activeVid || activeTypeRef.current !== 'video') return;

    if (isPlaying) {
      const trimOffset = clip.trimStart || 0;
      const targetTime = Math.max(0, (trimOffset + (currentFrameRef.current - clip.startFrame)) / fpsRef.current);
      if (activeVid.ended || Math.abs(activeVid.currentTime - targetTime) > 0.1) {
        activeVid.currentTime = targetTime;
      } else {
        activeVid.playbackRate = playbackRate;
        syncVideoAudioState(activeVid, muted);
        activeVid.play().catch((err) => {
          if (err && err.name === 'NotAllowedError') {
            activeVid.muted = true;
            activeVid.play().catch(() => {});
          }
        });
      }
    } else {
      activeVid.pause();
    }
  }, [isPlaying, clip.startFrame, clip.trimStart, playbackRate, muted]);

  // Track metadata for duration updates
  useEffect(() => {
    const vA = videoARef.current;
    const vB = videoBRef.current;
    if (!vA || !vB) return;

    const checkAndUpdateDuration = (video: HTMLVideoElement) => {
      if (video.duration) {
        const durationInFrames = Math.round(video.duration * fpsRef.current);
        if (clip.mediaDuration !== durationInFrames && clip.id === activeClipIdRef.current) {
          updateClip(clip.id, { mediaDuration: durationInFrames });
        }
      }
    };

    const handleMetadataA = () => checkAndUpdateDuration(vA);
    const handleMetadataB = () => checkAndUpdateDuration(vB);

    vA.addEventListener('loadedmetadata', handleMetadataA);
    vB.addEventListener('loadedmetadata', handleMetadataB);

    return () => {
      vA.removeEventListener('loadedmetadata', handleMetadataA);
      vB.removeEventListener('loadedmetadata', handleMetadataB);
    };
  }, [clip.id, clip.mediaDuration, updateClip]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute"
      style={getPreviewMediaStyle(mediaLayout)}
    />
  );
}, (prevProps, nextProps) => {
  return (
    prevProps.clip.id === nextProps.clip.id &&
    prevProps.clip.src === nextProps.clip.src &&
    prevProps.clip.startFrame === nextProps.clip.startFrame &&
    prevProps.clip.duration === nextProps.clip.duration &&
    prevProps.clip.trimStart === nextProps.clip.trimStart &&
    prevProps.clip.mediaDuration === nextProps.clip.mediaDuration &&
    prevProps.isPlaying === nextProps.isPlaying &&
    prevProps.fps === nextProps.fps &&
    prevProps.playbackRate === nextProps.playbackRate &&
    prevProps.muted === nextProps.muted &&
    prevProps.mediaLayout === nextProps.mediaLayout
  );
});

interface CollectionItem {
  id: string;
  name: string;
  type: 'image' | 'video';
  previewUrl: string;
  trimStartSeconds?: number;
  durationSeconds?: number;
}

export interface CollectionFrameProps {
  collectionId: string;
  orderedItems: CollectionItem[];
  elapsedSeconds: number;
  isPlaying: boolean;
  className?: string;
  style?: React.CSSProperties;
}

export const CollectionFrame = React.memo(function CollectionFrameInner({
  collectionId,
  orderedItems,
  elapsedSeconds,
  isPlaying,
  className,
  style,
}: CollectionFrameProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Buffers
  const videoARef = useRef<HTMLVideoElement | null>(
    typeof window !== 'undefined' ? (() => {
      const v = document.createElement('video');
      v.playsInline = true;
      v.preload = 'auto';
      v.muted = true;
      v.volume = 0;
      return v;
    })() : null
  );
  const videoBRef = useRef<HTMLVideoElement | null>(
    typeof window !== 'undefined' ? (() => {
      const v = document.createElement('video');
      v.playsInline = true;
      v.preload = 'auto';
      v.muted = true;
      v.volume = 0;
      return v;
    })() : null
  );
  const imageARef = useRef<HTMLImageElement | null>(
    typeof window !== 'undefined' ? new Image() : null
  );
  const imageBRef = useRef<HTMLImageElement | null>(
    typeof window !== 'undefined' ? new Image() : null
  );

  // Cache canvas to hold previous frame to prevent seek flash
  const cacheCanvasRef = useRef<HTMLCanvasElement | null>(
    typeof window !== 'undefined' ? document.createElement('canvas') : null
  );
  const hasCachedFrameRef = useRef(false);
  const imageALoadedSrcRef = useRef<string | null>(null);
  const imageBLoadedSrcRef = useRef<string | null>(null);

  // Playback state and identification refs
  const activeBufferRef = useRef<'A' | 'B'>('A');
  const activeClipIdRef = useRef<string | null>(null);
  const activeSrcRef = useRef<string | null>(null);
  const activeTypeRef = useRef<ClipType | null>(null);
  const activeTrimStartRef = useRef<number>(0);

  // Look-ahead preloading refs
  const orderedItemsRef = useRef(orderedItems);
  const onPreloadReadyRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    orderedItemsRef.current = orderedItems;
  }, [orderedItems]);

  // Transition refs
  const transitionActiveRef = useRef(false);
  const transitionStartRef = useRef<number>(0);
  const transitionDuration = 200; // ms
  const prevBufferRef = useRef<'A' | 'B' | null>(null);
  const prevTypeRef = useRef<ClipType | null>(null);

  const nextBufferReadyRef = useRef(false);
  const nextClipRef = useRef<CollectionItem | null>(null);
  const isFirstLoadRef = useRef(true);

  // Parameter refs to prevent React hook closure lag
  const isPlayingRef = useRef(isPlaying);
  const elapsedSecondsRef = useRef(elapsedSeconds);
  const lastCollectionIdRef = useRef(collectionId);

  const lastElapsedRef = useRef(elapsedSeconds);

  useEffect(() => {
    elapsedSecondsRef.current = elapsedSeconds;
    
    const items = orderedItemsRef.current;
    if (items.length === 0) return;

    // 1. Calculate active item and activeItemElapsed
    let accum = 0;
    let activeItem: CollectionItem | null = null;
    let activeItemElapsed = 0;
    let activeItemIndex = -1;

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const dur = it.durationSeconds || 3;
      if (elapsedSeconds >= accum && elapsedSeconds < accum + dur) {
        activeItem = it;
        activeItemElapsed = elapsedSeconds - accum;
        activeItemIndex = i;
        break;
      }
      accum += dur;
    }

    if (!activeItem) {
      const lastItem = items[items.length - 1];
      const dur = lastItem.durationSeconds || 3;
      activeItem = lastItem;
      activeItemIndex = items.length - 1;
      activeItemElapsed = dur - 0.001;
    }

    if (!activeItem) return;

    const hasCollectionChanged = lastCollectionIdRef.current !== collectionId;
    const isAtStart = elapsedSeconds === 0;
    const hasLoopedOrReset = isAtStart || (elapsedSeconds < lastElapsedRef.current && activeItemIndex === 0) || hasCollectionChanged;
    lastElapsedRef.current = elapsedSeconds;

    // 2. Handle first load, collection change, or reset back to start
    if (hasLoopedOrReset || isFirstLoadRef.current) {
      if (hasCollectionChanged) {
        lastCollectionIdRef.current = collectionId;
      }
      isFirstLoadRef.current = false;
      const activeVideo = videoARef.current;
      const activeImage = imageARef.current;
      if (activeVideo && activeImage) {
        activeClipIdRef.current = activeItem.id;
        activeSrcRef.current = activeItem.previewUrl;
        activeTypeRef.current = activeItem.type;
        activeBufferRef.current = 'A';
        activeTrimStartRef.current = activeItem.trimStartSeconds || 0;
        hasCachedFrameRef.current = false; // Reset cached frame to prevent drawing wrong frames
        imageALoadedSrcRef.current = null;
        imageBLoadedSrcRef.current = null;

        // Reset transition states
        transitionActiveRef.current = false;
        prevBufferRef.current = null;
        prevTypeRef.current = null;
        nextClipRef.current = null;
        nextBufferReadyRef.current = false;

        const trimStart = activeItem.trimStartSeconds || 0;
        const targetTime = trimStart + activeItemElapsed;

        if (activeItem.type === 'video') {
          activeVideo.src = activeItem.previewUrl || '';
          activeVideo.load();
          activeVideo.playbackRate = 1;
          syncVideoAudioState(activeVideo, true);

          const onMetadataLoaded = () => {
            activeVideo.removeEventListener('loadedmetadata', onMetadataLoaded);
            activeVideo.currentTime = targetTime;
          };
          activeVideo.addEventListener('loadedmetadata', onMetadataLoaded);

          const handleSeeked = () => {
            activeVideo.removeEventListener('seeked', handleSeeked);
            if (isPlayingRef.current) {
              activeVideo.play().catch(() => {});
            }
          };
          activeVideo.addEventListener('seeked', handleSeeked);
        } else if (activeItem.type === 'image') {
          activeImage.onload = () => {
            imageALoadedSrcRef.current = activeItem.previewUrl || '';
          };
          activeImage.onerror = () => {
            imageALoadedSrcRef.current = activeItem.previewUrl || '';
          };
          activeImage.src = activeItem.previewUrl || '';
        }
      }
    } else {
      if (activeItem.id !== activeClipIdRef.current || activeItem.previewUrl !== activeSrcRef.current || activeItem.type !== activeTypeRef.current) {
        // Active item changed!
        loadClipIntoInactiveBuffer(activeItem, activeItemElapsed);
      } else {
        // Same active item, seek if paused or drifts too much
        const activeVid = activeBufferRef.current === 'A' ? videoARef.current : videoBRef.current;
        if (activeVid && activeTypeRef.current === 'video') {
          activeTrimStartRef.current = activeItem.trimStartSeconds || 0;
          const trimStart = activeItem.trimStartSeconds || 0;
          const targetTime = trimStart + activeItemElapsed;
          
          if (!isPlayingRef.current) {
            if (Math.abs(activeVid.currentTime - targetTime) > 0.05) {
              activeVid.currentTime = targetTime;
            }
          } else {
            const diff = Math.abs(activeVid.currentTime - targetTime);
            if (diff > 1.0) {
              activeVid.currentTime = targetTime;
            }
            if (activeVid.paused) {
              activeVid.play().catch(() => {});
            }
          }
        }
      }
    }

    // 3. Look-ahead preloading of the next item
    if (activeItemIndex !== -1 && activeItemIndex < items.length - 1) {
      const currentItemDur = activeItem.durationSeconds || 3;
      const remainingTime = currentItemDur - activeItemElapsed;
      
      // If we are within 1.5 seconds of the end of the current clip, preload the next one
      if (remainingTime < 1.5) {
        const nextItem = items[activeItemIndex + 1];
        // Only preload if it's not already the next preloading clip, and not already active
        if (nextItem.id !== activeClipIdRef.current && nextClipRef.current?.id !== nextItem.id) {
          preloadClipIntoInactiveBuffer(nextItem);
        }
      }
    }
  }, [elapsedSeconds, collectionId, orderedItems]);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
    if (isPlaying) {
      hasCachedFrameRef.current = false; // clear cache to prevent flashes
    }

    const activeVid = activeBufferRef.current === 'A' ? videoARef.current : videoBRef.current;
    if (activeVid && activeTypeRef.current === 'video') {
      if (isPlaying) {
        activeVid.play().catch(() => {});
      } else {
        activeVid.pause();
      }
    }
  }, [isPlaying]);

  // Sizing cover helper function in 2D space
  const drawElementCover = (
    ctx: CanvasRenderingContext2D,
    el: CanvasImageSource,
    elWidth: number,
    elHeight: number,
    targetWidth: number,
    targetHeight: number
  ) => {
    if (elWidth === 0 || elHeight === 0 || targetWidth === 0 || targetHeight === 0) return;

    const elRatio = elWidth / elHeight;
    const targetRatio = targetWidth / targetHeight;

    let sx = 0;
    let sy = 0;
    let sWidth = elWidth;
    let sHeight = elHeight;

    if (elRatio > targetRatio) {
      sWidth = elHeight * targetRatio;
      sx = (elWidth - sWidth) / 2;
    } else {
      sHeight = elWidth / targetRatio;
      sy = (elHeight - sHeight) / 2;
    }

    ctx.drawImage(el, sx, sy, sWidth, sHeight, 0, 0, targetWidth, targetHeight);
  };

  // Draw buffer
  const drawBuffer = (
    ctx: CanvasRenderingContext2D,
    buffer: 'A' | 'B',
    type: ClipType | null,
    width: number,
    height: number
  ) => {
    const cacheCanvas = cacheCanvasRef.current;
    if (type === 'video') {
      const video = buffer === 'A' ? videoARef.current : videoBRef.current;
      if (!video) return;

      const isSeeking = video.seeking;
      const isReady = video.readyState >= 2;
      const isLoaded = video.readyState >= 1; // has metadata

      if (isReady || (isSeeking && isLoaded)) {
        drawElementCover(ctx, video, video.videoWidth, video.videoHeight, width, height);
        if (!isSeeking && cacheCanvas) {
          if (cacheCanvas.width !== video.videoWidth || cacheCanvas.height !== video.videoHeight) {
            cacheCanvas.width = video.videoWidth;
            cacheCanvas.height = video.videoHeight;
          }
          const cacheCtx = cacheCanvas.getContext('2d');
          if (cacheCtx) {
            cacheCtx.drawImage(video, 0, 0);
            hasCachedFrameRef.current = true;
          }
        }
      } else {
        if (hasCachedFrameRef.current && cacheCanvas) {
          drawElementCover(ctx, cacheCanvas, cacheCanvas.width, cacheCanvas.height, width, height);
        } else {
          ctx.fillStyle = '#000000';
          ctx.fillRect(0, 0, width, height);
        }
      }
    } else if (type === 'image') {
      const image = buffer === 'A' ? imageARef.current : imageBRef.current;
      const loadedSrc = buffer === 'A' ? imageALoadedSrcRef.current : imageBLoadedSrcRef.current;
      const isActiveSrcLoaded = loadedSrc === activeSrcRef.current;

      if (!image || !image.complete || image.naturalWidth === 0 || !isActiveSrcLoaded) {
        if (hasCachedFrameRef.current && cacheCanvas) {
          drawElementCover(ctx, cacheCanvas, cacheCanvas.width, cacheCanvas.height, width, height);
        } else {
          ctx.fillStyle = '#000000';
          ctx.fillRect(0, 0, width, height);
        }
        return;
      }

      drawElementCover(ctx, image, image.naturalWidth, image.naturalHeight, width, height);

      if (cacheCanvas) {
        if (cacheCanvas.width !== image.naturalWidth || cacheCanvas.height !== image.naturalHeight) {
          cacheCanvas.width = image.naturalWidth;
          cacheCanvas.height = image.naturalHeight;
        }
        const cacheCtx = cacheCanvas.getContext('2d');
        if (cacheCtx) {
          cacheCtx.drawImage(image, 0, 0);
          hasCachedFrameRef.current = true;
        }
      }
    } else {
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, width, height);
    }
  };

  // Complete cross-fade transition
  const completeTransition = () => {
    transitionActiveRef.current = false;
    const oldVideo = prevBufferRef.current === 'A' ? videoARef.current : videoBRef.current;
    if (oldVideo) {
      oldVideo.pause();
      syncVideoAudioState(oldVideo, true);
    }
    prevBufferRef.current = null;
    prevTypeRef.current = null;
  };

  // Main draw loop
  const drawCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const width = Math.round(rect.width) || 640;
    const height = Math.round(rect.height) || 360;

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    let progress = 1.0;
    if (transitionActiveRef.current) {
      const elapsed = performance.now() - transitionStartRef.current;
      progress = Math.min(1.0, elapsed / transitionDuration);
      if (progress >= 1.0) {
        completeTransition();
      }
    }

    ctx.clearRect(0, 0, width, height);

    if (progress < 1.0 && prevBufferRef.current) {
      ctx.globalAlpha = 1.0 - progress;
      drawBuffer(ctx, prevBufferRef.current, prevTypeRef.current, width, height);
    }

    ctx.globalAlpha = progress;
    drawBuffer(ctx, activeBufferRef.current, activeTypeRef.current, width, height);

    ctx.globalAlpha = 1.0;
  };

  // Transition launch helper
  const startTransition = (nextBuffer: 'A' | 'B', targetItem: CollectionItem, currentElapsed = 0) => {
    const oldVideo = activeBufferRef.current === 'A' ? videoARef.current : videoBRef.current;
    if (oldVideo) {
      oldVideo.pause();
      syncVideoAudioState(oldVideo, true);
    }

    activeBufferRef.current = nextBuffer;
    activeTypeRef.current = targetItem.type;
    activeClipIdRef.current = targetItem.id;
    activeSrcRef.current = targetItem.previewUrl;
    activeTrimStartRef.current = targetItem.trimStartSeconds || 0;
    hasCachedFrameRef.current = false; // Invalidate cache of the previous collection item

    const newVideo = nextBuffer === 'A' ? videoARef.current : videoBRef.current;
    if (newVideo) {
      syncVideoAudioState(newVideo, true); // Hover previews are always muted
      newVideo.playbackRate = 1;
      if (targetItem.type === 'video') {
        const trimStart = targetItem.trimStartSeconds || 0;
        const targetTime = trimStart + currentElapsed;
        if (Math.abs(newVideo.currentTime - targetTime) > 0.1) {
          newVideo.currentTime = targetTime;
        }
      }
      if (isPlayingRef.current) {
        newVideo.play().catch(() => {});
      }
    }

    transitionActiveRef.current = false;
    prevBufferRef.current = null;
    prevTypeRef.current = null;
  };

  const preloadClipIntoInactiveBuffer = (targetItem: CollectionItem) => {
    const nextBuffer = activeBufferRef.current === 'A' ? 'B' : 'A';
    const nextVideo = nextBuffer === 'A' ? videoARef.current : videoBRef.current;
    const nextImage = nextBuffer === 'A' ? imageARef.current : imageBRef.current;

    if (!nextVideo || !nextImage) return;

    nextBufferReadyRef.current = false;
    nextClipRef.current = targetItem;
    onPreloadReadyRef.current = null;

    const trimStart = targetItem.trimStartSeconds || 0;
    const targetTime = trimStart;

    const onReady = () => {
      if (nextClipRef.current?.id !== targetItem.id) return;
      nextBufferReadyRef.current = true;
      if (onPreloadReadyRef.current) {
        onPreloadReadyRef.current();
        onPreloadReadyRef.current = null;
      }
    };

    if (targetItem.type === 'video') {
      nextVideo.src = targetItem.previewUrl || '';
      nextVideo.load();
      nextVideo.playbackRate = 1;
      syncVideoAudioState(nextVideo, true);

      const onMetadataLoaded = () => {
        nextVideo.removeEventListener('loadedmetadata', onMetadataLoaded);
        nextVideo.currentTime = targetTime;
      };
      nextVideo.addEventListener('loadedmetadata', onMetadataLoaded);

      const handleSeeked = () => {
        nextVideo.removeEventListener('seeked', handleSeeked);
        nextVideo.removeEventListener('canplay', handleSeeked);
        nextVideo.removeEventListener('error', handleError);
        onReady();
      };

      const handleError = () => {
        nextVideo.removeEventListener('seeked', handleSeeked);
        nextVideo.removeEventListener('canplay', handleSeeked);
        nextVideo.removeEventListener('error', handleError);
        onReady();
      };

      nextVideo.addEventListener('seeked', handleSeeked);
      nextVideo.addEventListener('canplay', handleSeeked);
      nextVideo.addEventListener('error', handleError);
    } else if (targetItem.type === 'image') {
      nextImage.onload = () => {
        if (nextBuffer === 'A') {
          imageALoadedSrcRef.current = targetItem.previewUrl || '';
        } else {
          imageBLoadedSrcRef.current = targetItem.previewUrl || '';
        }
        onReady();
      };
      nextImage.onerror = () => {
        if (nextBuffer === 'A') {
          imageALoadedSrcRef.current = targetItem.previewUrl || '';
        } else {
          imageBLoadedSrcRef.current = targetItem.previewUrl || '';
        }
        onReady();
      };
      nextImage.src = targetItem.previewUrl || '';
    } else {
      onReady();
    }
  };

  const loadClipIntoInactiveBuffer = (targetItem: CollectionItem, currentElapsed: number) => {
    const nextBuffer = activeBufferRef.current === 'A' ? 'B' : 'A';
    const nextVideo = nextBuffer === 'A' ? videoARef.current : videoBRef.current;
    const nextImage = nextBuffer === 'A' ? imageARef.current : imageBRef.current;

    if (!nextVideo || !nextImage) return;

    if (nextClipRef.current?.id === targetItem.id && nextBufferReadyRef.current) {
      startTransition(nextBuffer, targetItem, currentElapsed);
      return;
    }

    if (nextClipRef.current?.id === targetItem.id) {
      onPreloadReadyRef.current = () => {
        startTransition(nextBuffer, targetItem, currentElapsed);
      };
      return;
    }

    nextBufferReadyRef.current = false;
    nextClipRef.current = targetItem;
    onPreloadReadyRef.current = null;

    const trimStart = targetItem.trimStartSeconds || 0;
    const targetTime = trimStart + currentElapsed;

    const onReady = () => {
      if (nextClipRef.current?.id !== targetItem.id) return;
      nextBufferReadyRef.current = true;
      startTransition(nextBuffer, targetItem, currentElapsed);
    };

    if (targetItem.type === 'video') {
      nextVideo.src = targetItem.previewUrl || '';
      nextVideo.load();
      nextVideo.playbackRate = 1;
      syncVideoAudioState(nextVideo, true);

      const onMetadataLoaded = () => {
        nextVideo.removeEventListener('loadedmetadata', onMetadataLoaded);
        nextVideo.currentTime = targetTime;
      };
      nextVideo.addEventListener('loadedmetadata', onMetadataLoaded);

      const handleSeeked = () => {
        const items = orderedItemsRef.current;
        let accum = 0;
        let activeItemElapsed = 0;
        for (let i = 0; i < items.length; i++) {
          const it = items[i];
          const dur = it.durationSeconds || 3;
          if (elapsedSecondsRef.current >= accum && elapsedSecondsRef.current < accum + dur) {
            if (it.id === targetItem.id) {
              activeItemElapsed = elapsedSecondsRef.current - accum;
            }
            break;
          }
          accum += dur;
        }
        const trimStart = targetItem.trimStartSeconds || 0;
        const latestTargetTime = trimStart + activeItemElapsed;

        if (Math.abs(nextVideo.currentTime - latestTargetTime) > 0.1) {
          nextVideo.currentTime = latestTargetTime;
          return;
        }

        nextVideo.removeEventListener('seeked', handleSeeked);
        nextVideo.removeEventListener('canplay', handleSeeked);
        nextVideo.removeEventListener('error', handleError);
        onReady();
      };

      const handleError = () => {
        nextVideo.removeEventListener('seeked', handleSeeked);
        nextVideo.removeEventListener('canplay', handleSeeked);
        nextVideo.removeEventListener('error', handleError);
        onReady();
      };

      nextVideo.addEventListener('seeked', handleSeeked);
      nextVideo.addEventListener('canplay', handleSeeked);
      nextVideo.addEventListener('error', handleError);
    } else if (targetItem.type === 'image') {
      nextImage.onload = () => {
        if (nextBuffer === 'A') {
          imageALoadedSrcRef.current = targetItem.previewUrl || '';
        } else {
          imageBLoadedSrcRef.current = targetItem.previewUrl || '';
        }
        onReady();
      };
      nextImage.onerror = () => {
        if (nextBuffer === 'A') {
          imageALoadedSrcRef.current = targetItem.previewUrl || '';
        } else {
          imageBLoadedSrcRef.current = targetItem.previewUrl || '';
        }
        onReady();
      };
      nextImage.src = targetItem.previewUrl || '';
    } else {
      onReady();
    }
  };

  // Initialize offscreen media and loop
  useEffect(() => {
    const vA = videoARef.current;
    const vB = videoBRef.current;
    if (!vA || !vB) return;

    const handleSeeked = (e: Event) => {
      const vid = e.currentTarget as HTMLVideoElement;
      const activeVid = activeBufferRef.current === 'A' ? videoARef.current : videoBRef.current;
      if (vid !== activeVid) return; // Only play if it's the active video
      if (isPlayingRef.current && vid.paused) {
        syncVideoAudioState(vid, true);
        vid.playbackRate = 1;
        vid.play().catch(() => {});
      }
    };

    const handleCanPlay = (e: Event) => {
      const vid = e.currentTarget as HTMLVideoElement;
      const activeVid = activeBufferRef.current === 'A' ? videoARef.current : videoBRef.current;
      if (vid !== activeVid) return; // Only play if it's the active video
      if (isPlayingRef.current && vid.paused && !vid.seeking) {
        syncVideoAudioState(vid, true);
        vid.playbackRate = 1;
        vid.play().catch(() => {});
      }
    };

    vA.addEventListener('seeked', handleSeeked);
    vA.addEventListener('canplay', handleCanPlay);
    vB.addEventListener('seeked', handleSeeked);
    vB.addEventListener('canplay', handleCanPlay);

    let animationFrameId: number;
    const render = () => {
      drawCanvas();
      animationFrameId = requestAnimationFrame(render);
    };
    animationFrameId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animationFrameId);
      vA.removeEventListener('seeked', handleSeeked);
      vA.removeEventListener('canplay', handleCanPlay);
      vB.removeEventListener('seeked', handleSeeked);
      vB.removeEventListener('canplay', handleCanPlay);
      vA.pause();
      vA.src = '';
      vA.load();
      vB.pause();
      vB.src = '';
      vB.load();
    };
  }, []);

  // Monitor active item change handled inside unified elapsedSeconds useEffect

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={style}
    />
  );
}, (prevProps, nextProps) => {
  return (
    prevProps.collectionId === nextProps.collectionId &&
    prevProps.elapsedSeconds === nextProps.elapsedSeconds &&
    prevProps.isPlaying === nextProps.isPlaying &&
    prevProps.className === nextProps.className &&
    JSON.stringify(prevProps.style) === JSON.stringify(nextProps.style) &&
    prevProps.orderedItems.length === nextProps.orderedItems.length &&
    prevProps.orderedItems.every((item, idx) => 
      item.id === nextProps.orderedItems[idx]?.id && 
      item.previewUrl === nextProps.orderedItems[idx]?.previewUrl && 
      item.durationSeconds === nextProps.orderedItems[idx]?.durationSeconds && 
      item.trimStartSeconds === nextProps.orderedItems[idx]?.trimStartSeconds
    )
  );
});

