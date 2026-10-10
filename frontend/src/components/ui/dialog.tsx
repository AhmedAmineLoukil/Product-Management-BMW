import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";
export const Dialog = DialogPrimitive.Root;
export const DialogTitle = DialogPrimitive.Title;
export const DialogDescription = DialogPrimitive.Description;
export function DialogContent({
  children,
  wide = false,
}: {
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="dialog-overlay" />
      <DialogPrimitive.Content
        className={wide ? "dialog-content drawer" : "dialog-content"}
      >
        {children}
        <DialogPrimitive.Close
          className="icon-button dialog-close"
          aria-label="Close"
        >
          <X size={18} />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
