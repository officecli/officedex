import { useState, type ImgHTMLAttributes, type ReactNode } from "react";

export interface ImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, "fallback"> {
  readonly fallback?: ReactNode;
  readonly preview?: boolean;
}

export function Image({ fallback, preview: _preview, onError, ...props }: ImageProps) {
  const [failed, setFailed] = useState(false);
  if (failed && fallback) return <>{fallback}</>;
  return <img {...props} onError={(event) => { setFailed(true); onError?.(event); }} />;
}
