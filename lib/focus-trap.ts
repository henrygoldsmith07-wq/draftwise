/**
 * Focus trap utility for modals and dialogs.
 * Keeps keyboard navigation contained within the dialog.
 */

export function trapFocus(element: HTMLElement) {
  const focusableElements = getFocusableElements(element);
  
  if (focusableElements.length === 0) return;
  
  const firstFocusable = focusableElements[0];
  const lastFocusable = focusableElements[focusableElements.length - 1];
  
  // Move focus to first element
  firstFocusable.focus();
  
  function handleKeyDown(event: KeyboardEvent) {
    if (event.key !== "Tab") return;
    
    if (event.shiftKey) {
      // Shift + Tab
      if (document.activeElement === firstFocusable) {
        event.preventDefault();
        lastFocusable.focus();
      }
    } else {
      // Tab
      if (document.activeElement === lastFocusable) {
        event.preventDefault();
        firstFocusable.focus();
      }
    }
  }
  
  element.addEventListener("keydown", handleKeyDown);
  
  // Cleanup function
  return () => {
    element.removeEventListener("keydown", handleKeyDown);
  };
}

/**
 * Get all focusable elements within a container.
 */
export function getFocusableElements(container: Element): HTMLElement[] {
  const focusableSelector = [
    'button:not([disabled])',
    '[href]:not([disabled])',
    'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"]):not([disabled])',
  ].join(", ");
  
  return Array.from(
    container.querySelectorAll<HTMLElement>(focusableSelector)
  ).filter((el) => {
    // Filter out hidden/disabled elements
    return (
      el.offsetParent !== null &&
      getComputedStyle(el).visibility !== "hidden" &&
      !el.hasAttribute("disabled")
    );
  });
}

/**
 * Restore previous focus after dialog closes.
 */
export function restoreFocus(previousFocus: HTMLElement | null) {
  if (previousFocus) {
    previousFocus.focus();
  }
}
