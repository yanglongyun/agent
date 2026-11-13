import { Icon } from "../icons/Icon";
import { attachmentSize } from "./attachments";

export function AttachmentInfo({ file }: { file: { name: string; size: number } }) {
  return (
    <>
      <Icon name="doc" size={22} />
      <span className="attachment-info">
        <span className="attachment-name" title={file.name}>
          {file.name}
        </span>
        <span className="attachment-size">{attachmentSize(file.size)}</span>
      </span>
    </>
  );
}
