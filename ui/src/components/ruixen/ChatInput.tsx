/*! Adapted from Ruixen UI Claude Chat Input. Copyright (c) 2025 Ruixen UI. MIT: /licenses/Ruixen-UI-MIT.md */
// Source: https://github.com/ruixenui/ruixen.com/blob/main/registry/ruixenui/claude-chat-input.tsx
// License: ui/public/licenses/Ruixen-UI-MIT.md. Application state stays in Composer.
import { useRef, useState, type ReactNode } from "react";
import { Icon } from "../../icons/Icon";
import { attachmentSize, isImageAttachment, type UploadAttachment } from "../../thread/attachments";

export function ChatInputFrame({
  children,
  onFiles,
  onFocus,
  disabled,
}: {
  children: ReactNode;
  onFiles: (files: File[]) => void;
  onFocus: () => void;
  disabled: boolean;
}) {
  const depth = useRef(0);
  const [dragging, setDragging] = useState(false);
  return (
    <div
      className={`composer${dragging ? " is-dragging" : ""}`}
      onClick={onFocus}
      onDragEnter={(event) => {
        if (event.dataTransfer.types.includes("Files") && !disabled) {
          event.preventDefault();
          depth.current++;
          setDragging(true);
        }
      }}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("Files")) {
          event.preventDefault();
        }
      }}
      onDragLeave={(event) => {
        event.preventDefault();
        depth.current = Math.max(0, depth.current - 1);
        if (!depth.current) {
          setDragging(false);
        }
      }}
      onDrop={(event) => {
        if (event.dataTransfer.files.length) {
          event.preventDefault();
          depth.current = 0;
          setDragging(false);
          if (!disabled) {
            onFiles(Array.from(event.dataTransfer.files));
          }
        }
      }}
    >
      {children}
      {dragging && (
        <div className="composer-drop">
          <Icon name="attachment" size={26} />
          <span>松开以添加附件</span>
          <small>每条最多 5 个附件</small>
        </div>
      )}
    </div>
  );
}

export function FilePreview({ file, onRemove }: { file: UploadAttachment; onRemove: () => void }) {
  const image = isImageAttachment(file);
  return (
    <div className={`file-preview${image ? " is-image" : ""}`}>
      {image ? (
        <img src={file.data} alt={file.name} />
      ) : (
        <>
          <div className="file-preview-head">
            <Icon name="doc" size={20} />
            <span>{file.name.split(".").at(-1)?.slice(0, 8)}</span>
          </div>
          <div className="file-preview-info">
            <strong title={file.name}>{file.name}</strong>
            <small>{attachmentSize(file.size)}</small>
          </div>
        </>
      )}
      <button
        type="button"
        className="file-remove"
        aria-label={`移除附件 ${file.name}`}
        onClick={(event) => {
          event.stopPropagation();
          onRemove();
        }}
      >
        <Icon name="close" size={12} />
      </button>
    </div>
  );
}
