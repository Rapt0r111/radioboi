"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";

type AuthorDialogProps = {
  children: ReactNode;
};

const PANEL_ID = "author-profile-panel";

export function AuthorDialog({ children }: AuthorDialogProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isClosing, setIsClosing] = useState(false);

  const finishClose = useCallback(() => {
    setIsClosing(false);
    setIsOpen(false);
  }, []);

  const closeDialog = useCallback(() => {
    if (!isOpen || isClosing) return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      finishClose();
      return;
    }

    setIsClosing(true);
    window.setTimeout(finishClose, 180);
  }, [finishClose, isClosing, isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => closeRef.current?.focus());

    function handleEscape(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeDialog();
      }
    }

    document.addEventListener("keydown", handleEscape);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = previousOverflow;
    };
  }, [closeDialog, isOpen]);

  useEffect(() => {
    if (!isOpen && !isClosing) triggerRef.current?.focus();
  }, [isClosing, isOpen]);

  function openDialog() {
    if (isOpen) return;
    setIsOpen(true);
  }

  function handleDialogClick(event: MouseEvent<HTMLDivElement>) {
    if (
      event.target === event.currentTarget ||
      (event.target instanceof HTMLElement && event.target.classList.contains("author-dialog__backdrop"))
    ) {
      closeDialog();
    }
  }

  function handleDialogKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Tab") return;

    const dialog = event.currentTarget;
    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        "button, a[href], input, select, textarea, [tabindex]:not([tabindex='-1'])",
      ),
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="author-tab"
        aria-expanded={isOpen}
        aria-controls={PANEL_ID}
        onClick={openDialog}
      >
        <span className="author-tab__signal" aria-hidden="true">
          <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
            <path d="M4 15.5a11 11 0 0 1 11-11" />
            <path d="M7.5 15.5a7.5 7.5 0 0 1 7.5-7.5" />
            <path d="M11 15.5a4 4 0 0 1 4-4" />
            <circle cx="15" cy="15.5" r="1.6" />
          </svg>
        </span>
        <span className="author-tab__label">Об авторе</span>
        <span className="author-tab__code" aria-hidden="true">
          Д.А.А.
        </span>
      </button>

      {isOpen ? (
      <div
        id={PANEL_ID}
        className={`author-dialog ${isClosing ? "author-dialog--closing" : "author-dialog--open"}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="author-profile-title"
        onClick={handleDialogClick}
        onKeyDown={handleDialogKeyDown}
      >
        <div className="author-dialog__backdrop" aria-hidden="true" />
        <div className="author-dialog__surface">
          <div className="author-dialog__trace" aria-hidden="true" />
          <button
            ref={closeRef}
            type="button"
            className="author-dialog__close"
            aria-label="Закрыть информацию об авторе"
            onClick={() => void closeDialog()}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="m6.5 6.5 11 11m0-11-11 11" />
            </svg>
          </button>
          {children}
        </div>
      </div>
      ) : null}
    </>
  );
}
