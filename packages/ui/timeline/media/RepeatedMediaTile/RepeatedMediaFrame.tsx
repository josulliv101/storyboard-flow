import { cva, type VariantProps } from "class-variance-authority";
import { handleImageFallback } from "./image-fallback";

const repeatedMediaFrameVariant = cva(
  "relative shrink-0 overflow-hidden",
  {
    variants: {
      variant: {
        default: "border-r border-black/35 bg-black last:border-r-0",
        unstyled: "",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export type RepeatedMediaFrameProps = VariantProps<typeof repeatedMediaFrameVariant> & {
  src: string;
  alt: string;
  fallbackSrc?: string;
  frameWidth: number;
  frameHeight: number;
};

export function RepeatedMediaFrame({
  src,
  alt,
  fallbackSrc,
  frameWidth,
  frameHeight,
  variant,
}: RepeatedMediaFrameProps) {
  return (
    <div
      className={repeatedMediaFrameVariant({ variant })}
      style={{ width: `${frameWidth}px`, height: `${frameHeight}px` }}
    >
      <div className="h-full w-full">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt}
          className="h-full w-full object-cover"
          draggable={false}
          onError={
            fallbackSrc
              ? (event) => handleImageFallback(event, fallbackSrc)
              : undefined
          }
        />
      </div>
    </div>
  );
}
