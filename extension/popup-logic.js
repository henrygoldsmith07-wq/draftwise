/**
 * What the toolbar popup says.
 *
 * The decisions the popup makes about wording are kept here, away from the
 * DOM, so they can be checked without a browser. The popup itself is mostly
 * plumbing: ask the page, build some nodes, put them in the document.
 *
 * The wording is the part that matters. A writer who is told "nothing
 * found" when the truth is "Draftwise is not running here" will believe
 * their writing was checked when it was not, and will carry on writing
 * believing they are being helped. So every state says which state it is.
 */
(() => {
  const ISSUE_COLOR = {
    spelling: "#e25d70",
    grammar: "#ef9f55",
    punctuation: "#8b78e6",
    repetition: "#d46191",
    conciseness: "#d8944a",
    clarity: "#4a9a9d",
    consistency: "#6a8f68",
  };

  /** How many suggestions, said the way a person would say it. */
  function countLabel(findings) {
    const total = Array.isArray(findings) ? findings.length : 0;
    if (!total) return "";
    return `${total} suggestion${total === 1 ? "" : "s"}`;
  }

  /**
   * The message for a field with nothing to report.
   *
   * The hint is the field's own label — a name, an aria-label, a
   * placeholder — and never its value. Naming the field is what makes the
   * message reassuring: "nothing to fix here" could mean "nothing to fix
   * anywhere".
   */
  function cleanState(state) {
    const hint = state && typeof state.fieldHint === "string" ? state.fieldHint.trim() : "";
    return {
      title: "Nothing to fix here",
      detail: hint
        ? `This field reads cleanly. Draftwise checked “${hint}”.`
        : "This field reads cleanly.",
    };
  }

  /**
   * The message for a page where Draftwise is not checking anything.
   *
   * "Switched off" and "nothing is being checked" are different problems
   * with different fixes, so they get different sentences.
   */
  function blockedState(state) {
    const code = state && typeof state.code === "string" ? state.code : "";
    if (code === "no-field") {
      return {
        title: "Nothing is being checked",
        detail: "Click into a text field and Draftwise will check what you write.",
      };
    }
    const reason = state && typeof state.reason === "string" ? state.reason.trim() : "";
    return {
      title: "Draftwise is switched off",
      detail: reason || "Turn Draftwise back on for this site to have your writing checked.",
    };
  }

  /**
   * The message for a page where Draftwise does not run at all.
   *
   * This is the ordinary case on any site the writer has not granted, and
   * it is not an error. It says so, and it says what to do about it.
   */
  function notRunningState() {
    return {
      title: "Draftwise is not running here",
      detail: "Grant access to this site and Draftwise will check what you write in it.",
    };
  }

  globalThis.DraftwisePopupLogic = {
    ISSUE_COLOR,
    countLabel,
    cleanState,
    blockedState,
    notRunningState,
  };
})();
