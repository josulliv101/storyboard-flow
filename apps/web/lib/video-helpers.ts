export const captureVideoAnalysisFrames = async (file: File): Promise<Blob[]> => {
  const sourceUrl = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.preload = 'auto';
  video.playsInline = true;

  const waitForVideoReady = () => new Promise<void>((resolve, reject) => {
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      resolve();
      return;
    }

    const handleReady = () => resolve();
    const handleError = () => reject(new Error('Could not decode the selected video for local analysis.'));
    video.addEventListener('loadeddata', handleReady, { once: true });
    video.addEventListener('error', handleError, { once: true });
  });

  const seekTo = (time: number) => new Promise<void>((resolve, reject) => {
    if (Math.abs(video.currentTime - time) < 0.01 && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      resolve();
      return;
    }

    const handleSeek = () => resolve();
    const handleError = () => reject(new Error('Could not sample a video frame for local analysis.'));
    video.addEventListener('seeked', handleSeek, { once: true });
    video.addEventListener('error', handleError, { once: true });
    video.currentTime = time;
  });

  try {
    video.src = sourceUrl;
    await waitForVideoReady();

    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 1;
    const frameCount = Math.min(6, Math.max(3, Math.ceil(duration / 6)));
    const maxWidth = 768;
    const scale = Math.min(1, maxWidth / Math.max(1, video.videoWidth));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const context = canvas.getContext('2d');

    if (!context) {
      throw new Error('Could not initialize frame sampling for local analysis.');
    }

    const frames: Blob[] = [];
    for (let index = 0; index < frameCount; index++) {
      const time = Math.min(duration - 0.01, duration * ((index + 0.5) / frameCount));
      await seekTo(Math.max(0, time));
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const frame = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.75));
      if (frame) frames.push(frame);
    }

    if (frames.length === 0) {
      throw new Error('No video frames could be prepared for local analysis.');
    }

    return frames;
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(sourceUrl);
  }
};

export const detectLetterbox = (video: HTMLVideoElement): { top: number; bottom: number } => {
  const vWidth = video.videoWidth;
  const vHeight = video.videoHeight;
  const topDefault = 0;
  const bottomDefault = vHeight;

  try {
    const canvas = document.createElement('canvas');
    canvas.width = 3;
    canvas.height = vHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return { top: topDefault, bottom: bottomDefault };

    const cols = [
      Math.floor(vWidth * 0.25),
      Math.floor(vWidth * 0.5),
      Math.floor(vWidth * 0.75)
    ];

    // Draw three 1px columns from the video
    for (let c = 0; c < 3; c++) {
      ctx.drawImage(video, cols[c], 0, 1, vHeight, c, 0, 1, vHeight);
    }

    const imgData = ctx.getImageData(0, 0, 3, vHeight);
    const data = imgData.data;

    let minTop = vHeight;
    let maxBottom = 0;

    // Scan each of the 3 columns
    for (let c = 0; c < 3; c++) {
      let colTop = 0;
      for (let y = 0; y < vHeight; y++) {
        const idx = (y * 3 + c) * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        if (r > 18 || g > 18 || b > 18) {
          colTop = y;
          break;
        }
      }
      minTop = Math.min(minTop, colTop);

      let colBottom = vHeight;
      for (let y = vHeight - 1; y >= 0; y--) {
        const idx = (y * 3 + c) * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        if (r > 18 || g > 18 || b > 18) {
          colBottom = y + 1;
          break;
        }
      }
      maxBottom = Math.max(maxBottom, colBottom);
    }

    const activeHeight = maxBottom - minTop;
    if (activeHeight < vHeight * 0.2 || minTop >= maxBottom) {
      return { top: topDefault, bottom: bottomDefault };
    }

    return { top: minTop, bottom: maxBottom };
  } catch (e) {
    console.warn("Letterbox detection failed:", e);
    return { top: topDefault, bottom: bottomDefault };
  }
};

export const extractCharacterAvatarFromVideo = (
  videoFile: File,
  timestampSeconds: number,
  boundingBox?: [number, number, number, number] // [ymin, xmin, ymax, xmax] 0 to 100
): Promise<Blob> => {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.style.position = 'absolute';
    video.style.left = '-9999px';
    video.style.top = '-9999px';
    video.style.width = '100px';
    video.style.height = '100px';
    video.style.visibility = 'hidden';

    // Set up a safety timeout (6 seconds to allow self-healing retry seeks)
    const timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error("Timeout waiting for video seek"));
    }, 6000);

    const cleanup = () => {
      clearTimeout(timeoutId);
      if (video.parentNode) {
        document.body.removeChild(video);
      }
      if (video.src) {
        URL.revokeObjectURL(video.src);
      }
    };

    let seekRetries = 0;
    const maxSeekRetries = 3;

    const performSeek = (time: number) => {
      const targetTime = isNaN(time) ? 2.0 : Math.max(0, Math.min(time, video.duration - 0.1));
      video.currentTime = targetTime;
    };

    video.onloadedmetadata = () => {
      performSeek(timestampSeconds);
    };

    const processFrame = () => {
      try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          cleanup();
          reject(new Error("Could not get canvas context"));
          return;
        }

        const vWidth = video.videoWidth;
        const vHeight = video.videoHeight;

        // --- SELF-HEALING BLACK FRAME DETECTION ---
        const analyzeCanvas = document.createElement('canvas');
        analyzeCanvas.width = 8;
        analyzeCanvas.height = 8;
        const analyzeCtx = analyzeCanvas.getContext('2d');
        if (analyzeCtx) {
          analyzeCtx.drawImage(video, 0, 0, 8, 8);
          const imgData = analyzeCtx.getImageData(0, 0, 8, 8);
          const data = imgData.data;
          let totalBrightness = 0;
          for (let i = 0; i < data.length; i += 4) {
            totalBrightness += (data[i] + data[i+1] + data[i+2]) / 3;
          }
          const avgBrightness = totalBrightness / 64;

          if (avgBrightness < 18 && seekRetries < maxSeekRetries) {
            seekRetries++;
            const shift = video.currentTime + 0.5 > video.duration ? -0.5 : 0.5;
            const newTime = video.currentTime + shift;
            console.log(`[AVATAR_SELF_HEAL] Detected dark/empty frame (brightness ${avgBrightness.toFixed(1)}). Retrying seek to ${newTime.toFixed(2)}s...`);
            performSeek(newTime);
            return;
          }
        }

        const size = 256;
        canvas.width = size;
        canvas.height = size;

        // Detect active cinematic video bounds (ignoring black letterbox margins)
        const { top: topLetterbox, bottom: bottomLetterbox } = detectLetterbox(video);
        const activeHeight = bottomLetterbox - topLetterbox;

        let sx = 0;
        let sy = 0;
        let sWidth = 0;
        let sHeight = 0;

        // Validate bounding box
        let isBoxValid = false;
        if (boundingBox && boundingBox.length === 4) {
          const [ymin, xmin, ymax, xmax] = boundingBox;
          const widthPct = xmax - xmin;
          const heightPct = ymax - ymin;
          if (widthPct > 0.5 && heightPct > 0.5 && xmin < 100 && ymin < 100) {
            isBoxValid = true;
          }
        }

        if (isBoxValid && boundingBox) {
          const [ymin, xmin, ymax, xmax] = boundingBox;
          const boxX = (xmin / 100) * vWidth;
          const boxY = (ymin / 100) * vHeight;
          const boxW = ((xmax - xmin) / 100) * vWidth;
          const boxH = ((ymax - ymin) / 100) * vHeight;

          const centerX = boxX + boxW / 2;
          const centerY = boxY + boxH / 2;

          const faceMaxDim = Math.max(boxW, boxH);
          const maxAllowedSize = Math.min(vWidth, activeHeight);
          sWidth = Math.min(faceMaxDim * 2.5, maxAllowedSize);
          sHeight = sWidth;

          // Clamp coordinates safely
          sx = Math.max(0, Math.min(centerX - sWidth / 2, vWidth - sWidth));
          sy = Math.max(topLetterbox, Math.min(centerY - sHeight * 0.45, bottomLetterbox - sHeight));
        } else {
          // Fallback Center crop
          const cropSize = Math.min(vWidth, activeHeight);
          sWidth = cropSize;
          sHeight = cropSize;
          sx = (vWidth - cropSize) / 2;
          
          const targetCenterY = topLetterbox + activeHeight * 0.42;
          sy = Math.max(topLetterbox, Math.min(targetCenterY - cropSize / 2, bottomLetterbox - cropSize));
        }

        ctx.drawImage(video, sx, sy, sWidth, sHeight, 0, 0, size, size);

        canvas.toBlob((blob) => {
          cleanup();
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error("Canvas toBlob returned null"));
          }
        }, 'image/png');
      } catch (err) {
        cleanup();
        reject(err);
      }
    };

    video.onseeked = () => {
      setTimeout(() => {
        processFrame();
      }, 150);
    };

    video.onerror = () => {
      cleanup();
      reject(new Error("Error loading video element"));
    };

    document.body.appendChild(video);
    video.src = URL.createObjectURL(videoFile);
  });
};

export const extractBeatThumbnailFromVideo = (
  videoFile: File,
  timestampSeconds: number
): Promise<Blob> => {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.style.position = 'absolute';
    video.style.left = '-9999px';
    video.style.top = '-9999px';
    video.style.width = '100px';
    video.style.height = '100px';
    video.style.visibility = 'hidden';

    const timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error("Timeout waiting for video thumbnail seek"));
    }, 6000);

    const cleanup = () => {
      clearTimeout(timeoutId);
      if (video.parentNode) {
        document.body.removeChild(video);
      }
      if (video.src) {
        URL.revokeObjectURL(video.src);
      }
    };

    let seekRetries = 0;
    const maxSeekRetries = 3;

    const performSeek = (time: number) => {
      const targetTime = isNaN(time) ? 2.0 : Math.max(0, Math.min(time, video.duration - 0.1));
      video.currentTime = targetTime;
    };

    video.onloadedmetadata = () => {
      performSeek(timestampSeconds);
    };

    const processFrame = () => {
      try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          cleanup();
          reject(new Error("Could not get canvas context"));
          return;
        }

        const vWidth = video.videoWidth;
        const vHeight = video.videoHeight;

        // self-healing black frame detection
        const analyzeCanvas = document.createElement('canvas');
        analyzeCanvas.width = 8;
        analyzeCanvas.height = 8;
        const analyzeCtx = analyzeCanvas.getContext('2d');
        if (analyzeCtx) {
          analyzeCtx.drawImage(video, 0, 0, 8, 8);
          const imgData = analyzeCtx.getImageData(0, 0, 8, 8);
          const data = imgData.data;
          let totalBrightness = 0;
          for (let i = 0; i < data.length; i += 4) {
            totalBrightness += (data[i] + data[i+1] + data[i+2]) / 3;
          }
          const avgBrightness = totalBrightness / 64;

          if (avgBrightness < 18 && seekRetries < maxSeekRetries) {
            seekRetries++;
            const shift = video.currentTime + 0.5 > video.duration ? -0.5 : 0.5;
            const newTime = video.currentTime + shift;
            performSeek(newTime);
            return;
          }
        }

        const width = 640;
        const height = 360;
        canvas.width = width;
        canvas.height = height;

        const { top: topLetterbox, bottom: bottomLetterbox } = detectLetterbox(video);
        const activeHeight = bottomLetterbox - topLetterbox;

        const srcAspect = vWidth / activeHeight;
        const destAspect = width / height;

        let sx = 0;
        let sy = topLetterbox;
        let sWidth = vWidth;
        let sHeight = activeHeight;

        if (srcAspect > destAspect) {
          sWidth = activeHeight * destAspect;
          sx = (vWidth - sWidth) / 2;
        } else if (srcAspect < destAspect) {
          sHeight = vWidth / destAspect;
          sy = topLetterbox + (activeHeight - sHeight) / 2;
        }

        ctx.drawImage(video, sx, sy, sWidth, sHeight, 0, 0, width, height);

        canvas.toBlob((blob) => {
          cleanup();
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error("Canvas toBlob returned null"));
          }
        }, 'image/jpeg', 0.85);
      } catch (err) {
        cleanup();
        reject(err);
      }
    };

    video.onseeked = () => {
      setTimeout(() => {
        processFrame();
      }, 150);
    };

    video.onerror = () => {
      cleanup();
      reject(new Error("Error loading video element"));
    };

    document.body.appendChild(video);
    video.src = URL.createObjectURL(videoFile);
  });
};
