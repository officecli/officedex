import { useEffect, useRef, useState } from "react";
import { Plus, X } from "lucide-react";

import { MAX_REFERENCES, isReferenceImagePath } from "../../../shared/imageGeneration";
import { toast } from "../../../renderer/ui";
import { usePort } from "../../port/PortContext";
import type { ImageReference } from "./imageDraft";

/**
 * Up to four pictures the new image should follow.
 *
 * What the runtime needs is a path it can read, so a picture always becomes one
 * before it lands here: the system picker hands over paths directly, and a file
 * from a plain input or a drop is written to disk first (`importReference`).
 * The thumbnail is read back from that path, so what is shown is exactly what
 * will be sent.
 */

const MAX_BYTES = 20 * 1024 * 1024;
const ACCEPTED = ["image/png", "image/jpeg", "image/webp"];

export interface ReferenceListProps {
  references: ImageReference[];
  onChange: (next: ImageReference[]) => void;
  disabled: boolean;
}

/**
 * Adding a reference, apart from where its button sits.
 *
 * Home puts the button among the tiles, left of the prompt. The task column
 * has no room for a tile column, so there the button is a tool in the strip
 * and the pictures sit in a row above the text — two places, one import path.
 * `input` is the fallback file field and must be rendered by whoever calls this.
 */
export function useReferenceImport({ references, onChange }: Pick<ReferenceListProps, "references" | "onChange">) {
  const images = usePort().images;
  const inputRef = useRef<HTMLInputElement>(null);

  const append = (incoming: ImageReference[]) => {
    const room = MAX_REFERENCES - references.length;
    if (incoming.length > room) toast.info(`You can add up to ${MAX_REFERENCES} reference images.`);
    if (room > 0) onChange([...references, ...incoming.slice(0, room)]);
  };

  const importFiles = async (list: FileList | null) => {
    if (!images || !list) return;
    const picked: ImageReference[] = [];
    for (const file of [...list]) {
      if (!ACCEPTED.includes(file.type) || file.size > MAX_BYTES) {
        toast.error("Choose a PNG, JPG or WebP under 20 MB.");
        continue;
      }
      try {
        picked.push({ path: await images.importReference(file), name: file.name });
      } catch {
        toast.error(`${file.name} could not be added.`);
      }
    }
    append(picked);
  };

  const add = async () => {
    if (!images) return;
    if (!images.pickReferences) {
      inputRef.current?.click();
      return;
    }
    const paths = await images.pickReferences().catch(() => null);
    if (!paths) return;
    append(
      paths
        .filter(isReferenceImagePath)
        .map((path) => ({ path, name: path.split(/[\\/]/).pop() || path })),
    );
  };

  const input = (
    <input
      ref={inputRef}
      type="file"
      accept={ACCEPTED.join(",")}
      multiple
      hidden
      onChange={(event) => {
        void importFiles(event.target.files);
        event.target.value = "";
      }}
    />
  );

  return {
    available: Boolean(images),
    full: references.length >= MAX_REFERENCES,
    add: () => void add(),
    input,
  };
}

/** Home's layout: tiles left of the prompt, the add sheet last among them. */
export function ReferenceList({ references, onChange, disabled }: ReferenceListProps) {
  const picker = useReferenceImport({ references, onChange });
  if (!picker.available) return null;

  return (
    <div className="shell-ig-references" role="group" aria-label="Reference images">
      {references.map((reference, index) => (
        <ReferenceTile
          key={reference.path}
          reference={reference}
          index={index}
          disabled={disabled}
          onRemove={() => onChange(references.filter((entry) => entry !== reference))}
        />
      ))}
      {!picker.full ? (
        <button
          type="button"
          className="shell-ig-reference-add"
          aria-label="Add reference image"
          title="Add reference image · PNG, JPG or WebP"
          disabled={disabled}
          onClick={picker.add}
        >
          <span className="shell-ig-reference-sheet" aria-hidden="true">
            <Plus size={18} strokeWidth={1.6} />
          </span>
        </button>
      ) : null}
      {picker.input}
    </div>
  );
}

/**
 * The task column's layout: the pictures only, in a row above the prompt.
 * Nothing at all until there is one — the add button lives in the tool strip.
 */
export function ReferenceStrip({ references, onChange, disabled }: ReferenceListProps) {
  const images = usePort().images;
  if (!images || references.length === 0) return null;
  return (
    <div className="shell-ig-reference-strip" role="group" aria-label="Reference images">
      {references.map((reference, index) => (
        <ReferenceTile
          key={reference.path}
          reference={reference}
          index={index}
          disabled={disabled}
          onRemove={() => onChange(references.filter((entry) => entry !== reference))}
        />
      ))}
    </div>
  );
}

function ReferenceTile({
  reference,
  index,
  disabled,
  onRemove,
}: {
  reference: ImageReference;
  index: number;
  disabled: boolean;
  onRemove: () => void;
}) {
  return (
    <div className="shell-ig-reference" title={reference.name}>
      <ReferenceThumb path={reference.path} name={reference.name} />
      <button type="button" aria-label={`Remove reference ${index + 1}`} disabled={disabled} onClick={onRemove}>
        <X size={12} strokeWidth={1.8} aria-hidden="true" />
      </button>
      <span aria-hidden="true">{index + 1}</span>
    </div>
  );
}

function ReferenceThumb({ path, name }: { path: string; name: string }) {
  const images = usePort().images;
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!images) return;
    let url = "";
    let cancelled = false;
    void images
      .readPath(path)
      .then((blob) => {
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setSrc(url);
      })
      .catch(() => setSrc(null));
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [images, path]);

  return src ? <img src={src} alt={name} draggable={false} /> : <span className="shell-ig-reference-name">{name}</span>;
}
