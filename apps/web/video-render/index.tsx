import React from 'react';
import { Composition, registerRoot, type CalculateMetadataFunction } from 'remotion';
import {
  getRenderDimensions,
  getRenderDuration,
  TimelineVideo,
  type TimelineVideoProps,
} from './TimelineVideo';

const defaultProps: TimelineVideoProps = {
  project: {
    activeSceneId: 'scene-1',
    characters: [],
    config: {
      aspectRatio: '16:9',
      fps: 30,
    },
    scenes: [
      {
        id: 'scene-1',
        name: 'Empty Scene',
        clips: [],
        tracks: [],
      },
    ],
  },
};

const calculateMetadata: CalculateMetadataFunction<TimelineVideoProps> = ({ props }) => {
  const aspectRatio = props.project.config?.aspectRatio || '16:9';
  const dimensions = getRenderDimensions(aspectRatio);

  return {
    ...dimensions,
    durationInFrames: getRenderDuration(props.project),
    fps: props.project.config?.fps || 30,
  };
};

export const RemotionRoot = () => {
  return (
    <Composition
      id="TimelineProject"
      component={TimelineVideo}
      durationInFrames={300}
      fps={30}
      width={1920}
      height={1080}
      defaultProps={defaultProps}
      calculateMetadata={calculateMetadata}
    />
  );
};

registerRoot(RemotionRoot);
