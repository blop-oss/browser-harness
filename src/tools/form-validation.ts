import type { ElementHandle } from "playwright";

/**
 * After a click or Enter press that was meant to submit a form, the browser may
 * silently refuse to submit because the form fails HTML5 constraint validation
 * (a required field is empty, an email is malformed, etc.). No navigation fires,
 * no request is sent, and the action itself reports success — so the agent sees
 * "nothing happened" and often concludes the button is dead or the site is
 * broken (a common false "cookies/login don't work" diagnosis).
 *
 * Given an element handle resolved BEFORE the action (so a successful submit
 * that navigates away just makes this throw, rather than auto-waiting on a
 * detached locator), this returns a concise, agent-actionable description of the
 * blocking fields, or null when there is nothing to report.
 *
 * `via` selects what counts as a submission attempt:
 * - "click": only when the handle is a submit control (button[type=submit],
 *   a typeless <button>, or input[type=submit|image]).
 * - "enter": when the handle is a form-associated input (Enter submits its form).
 *
 * Best-effort: callers wrap the call in `.catch(() => null)`.
 */
export async function describeBlockedSubmission(
  handle: ElementHandle<Node>,
  via: "click" | "enter",
): Promise<string | null> {
  return await handle.evaluate((node, mode: "click" | "enter") => {
    let form: HTMLFormElement | null = null;

    if (mode === "click") {
      const el = node as Element;
      const control = (el.closest?.("button, input[type=submit], input[type=image]") ?? el) as
        | HTMLButtonElement
        | HTMLInputElement
        | Element;
      const tag = control.tagName;
      const type = (control as HTMLButtonElement | HTMLInputElement).type;
      // A <button> with no explicit type defaults to submit; type=button/reset do not submit.
      const submits =
        (tag === "BUTTON" && (type === "submit" || !control.getAttribute("type"))) ||
        (tag === "INPUT" && (type === "submit" || type === "image"));
      if (!submits) return null;
      form = (control as HTMLButtonElement | HTMLInputElement).form;
    } else {
      // Enter inside a form field attempts to submit the field's form.
      const field = node as HTMLInputElement;
      if (field.tagName !== "INPUT" || typeof field.form === "undefined") return null;
      form = field.form;
    }

    if (!form || typeof form.checkValidity !== "function") return null;
    // Valid form ⇒ the action submitted it (native navigation or a framework
    // fetch). Nothing to surface.
    if (form.checkValidity()) return null;

    const invalid = Array.from(form.elements)
      .filter(
        (el): el is HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement =>
          typeof (el as HTMLInputElement).checkValidity === "function" &&
          (el as HTMLInputElement).willValidate &&
          !(el as HTMLInputElement).checkValidity(),
      )
      .map((el) => {
        const labelText = el.labels && el.labels[0] ? el.labels[0].textContent ?? "" : "";
        const name =
          labelText.trim() ||
          el.getAttribute("aria-label") ||
          (el as HTMLInputElement).placeholder ||
          el.getAttribute("name") ||
          el.id ||
          (el as HTMLInputElement).type ||
          "field";
        const msg = (el as HTMLInputElement).validationMessage;
        return msg ? `${name} (${msg})` : name;
      });

    if (invalid.length === 0) return null;
    const many = invalid.length > 1;
    return `The form did not submit: ${invalid.length} required/invalid ${many ? "fields block" : "field blocks"} submission — ${invalid.join("; ")}. Fill or correct ${many ? "these fields" : "this field"}, then submit again.`;
  }, via);
}
