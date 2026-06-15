/**
 * Sign & Fill — reusable, on-device helpers.
 *
 * The workspace Sign & Fill inspector calls these functions. Nothing here
 * touches the network; everything runs in the browser via pdf-lib.
 *
 *  - detectFormFields(file)     → list AcroForm fields in the active PDF
 *  - applyFormFill({file, ...}) → write field values back; optionally flatten
 *
 * Signature placement reuses the editor canvas image-annotation flow
 * (SET_PENDING_IMAGE + tool="image"), so we don't re-flatten signatures
 * here — they ride along on the editor's normal save pipeline.
 */

import {
  PDFDocument,
  PDFTextField,
  PDFCheckBox,
  PDFDropdown,
  PDFRadioGroup,
  PDFOptionList,
} from "pdf-lib";

export type FormFieldKind = "text" | "checkbox" | "dropdown" | "radio" | "optionlist" | "other";

export type FormFieldInfo = {
  name: string;
  kind: FormFieldKind;
  /** Current value as a string ("true"/"false" for checkboxes; selected option name otherwise). */
  value: string;
  /** For dropdown / radio / optionlist — the available choices. */
  options?: string[];
  /** Multi-line hint for text fields. */
  multiline?: boolean;
};

export async function detectFormFields(file: File): Promise<FormFieldInfo[]> {
  const doc = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true });
  const form = doc.getForm();
  const fields = form.getFields();
  const out: FormFieldInfo[] = [];
  for (const f of fields) {
    const name = f.getName();
    if (f instanceof PDFTextField) {
      out.push({
        name,
        kind: "text",
        value: f.getText() ?? "",
        multiline: f.isMultiline(),
      });
    } else if (f instanceof PDFCheckBox) {
      out.push({ name, kind: "checkbox", value: f.isChecked() ? "true" : "false" });
    } else if (f instanceof PDFDropdown) {
      out.push({
        name,
        kind: "dropdown",
        value: f.getSelected()[0] ?? "",
        options: f.getOptions(),
      });
    } else if (f instanceof PDFRadioGroup) {
      out.push({
        name,
        kind: "radio",
        value: f.getSelected() ?? "",
        options: f.getOptions(),
      });
    } else if (f instanceof PDFOptionList) {
      out.push({
        name,
        kind: "optionlist",
        value: f.getSelected()[0] ?? "",
        options: f.getOptions(),
      });
    } else {
      out.push({ name, kind: "other", value: "" });
    }
  }
  return out;
}

export type ApplyFormFillOpts = {
  file: File;
  values: Record<string, string>;
  /** When true, the form is flattened (fields become un-editable baked content). */
  flatten: boolean;
};

export async function applyFormFill({ file, values, flatten }: ApplyFormFillOpts): Promise<File> {
  const doc = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true });
  const form = doc.getForm();
  for (const f of form.getFields()) {
    const name = f.getName();
    if (!(name in values)) continue;
    const v = values[name];
    try {
      if (f instanceof PDFTextField) {
        f.setText(v);
      } else if (f instanceof PDFCheckBox) {
        if (v === "true") f.check();
        else f.uncheck();
      } else if (f instanceof PDFDropdown) {
        if (v) f.select(v);
      } else if (f instanceof PDFRadioGroup) {
        if (v) f.select(v);
      } else if (f instanceof PDFOptionList) {
        if (v) f.select(v);
      }
    } catch (err) {
      // Skip unsupported per-field set; keep going so one bad field doesn't
      // kill the whole apply.
      console.warn("[sign-fill] skipping field", name, err);
    }
  }
  if (flatten) form.flatten();
  const bytes = await doc.save();
  const base = file.name.replace(/\s*\(filled(?:\s*flat)?\)\.pdf$/i, "").replace(/\.pdf$/i, "");
  const suffix = flatten ? " (filled flat)" : " (filled)";
  return new File([bytes as BlobPart], `${base}${suffix}.pdf`, { type: "application/pdf" });
}
