/** Typed client for the public contribution API (browser only). */
import type { AttachmentDTO, DraftDTO, InvitationDTO, PublicApiError } from "@/lib/submissions/dto";
import type { DraftPatch } from "@/lib/submissions/schemas";

export class ContributeApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
    public readonly fieldErrors?: Record<string, string[]>,
  ) {
    super(message);
    this.name = "ContributeApiError";
  }
}

function base(token: string) {
  return `/api/public/contribute/${encodeURIComponent(token)}`;
}

async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      credentials: "same-origin",
      headers: { Accept: "application/json", ...(init.body && typeof init.body === "string" ? { "Content-Type": "application/json" } : {}), ...(init.headers ?? {}) },
    });
  } catch {
    throw new ContributeApiError("You seem to be offline. Check your connection and try again.", 0, "NETWORK");
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const err = (data ?? {}) as PublicApiError;
    throw new ContributeApiError(err.error ?? `Request failed (${res.status})`, res.status, err.code, err.fieldErrors);
  }
  return data as T;
}

export type UploadOptions = { caption?: string; photographer?: string; onProgress?: (fraction: number) => void; signal?: AbortSignal };

export const contributeApi = {
  invitation: (token: string) => request<InvitationDTO>(base(token)),

  createDraft: (token: string, another = false) => request<{ draft: DraftDTO }>(`${base(token)}/draft`, { method: "POST", body: JSON.stringify({ another }) }),

  saveDraft: (token: string, submissionId: string, patch: DraftPatch) =>
    request<{ savedAt: string; draftId: string }>(`${base(token)}/draft`, { method: "PATCH", body: JSON.stringify({ submissionId, patch }) }),

  submit: (token: string, submissionId: string, payload: unknown) =>
    request<{ submissionId: string }>(`${base(token)}/submit`, { method: "POST", body: JSON.stringify({ submissionId, payload }) }),

  decline: (token: string, body: { reason?: string; undo?: boolean }) => request<{ status: string }>(`${base(token)}/decline`, { method: "POST", body: JSON.stringify(body) }),

  updateUpload: (token: string, submissionId: string, attachmentId: string, meta: { caption?: string; photographer?: string }) =>
    request<{ attachment: AttachmentDTO }>(`${base(token)}/uploads`, { method: "PATCH", body: JSON.stringify({ submissionId, attachmentId, ...meta }) }),

  removeUpload: (token: string, submissionId: string, attachmentId: string) =>
    request<{ ok: true }>(`${base(token)}/uploads`, { method: "DELETE", body: JSON.stringify({ submissionId, attachmentId }) }),

  /** Multipart upload with progress (XMLHttpRequest — fetch cannot report upload progress). */
  upload: (token: string, submissionId: string, file: File, opts: UploadOptions = {}) =>
    new Promise<{ attachment: AttachmentDTO }>((resolve, reject) => {
      const form = new FormData();
      form.append("submissionId", submissionId);
      form.append("file", file, file.name);
      if (opts.caption) form.append("caption", opts.caption);
      if (opts.photographer) form.append("photographer", opts.photographer);
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${base(token)}/uploads`);
      xhr.setRequestHeader("Accept", "application/json");
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && opts.onProgress) opts.onProgress(event.loaded / event.total);
      };
      xhr.onerror = () => reject(new ContributeApiError("The upload failed. Check your connection and try again.", 0, "NETWORK"));
      xhr.onabort = () => reject(new ContributeApiError("Upload cancelled", 0, "ABORTED"));
      xhr.onload = () => {
        let data: unknown = null;
        try {
          data = xhr.responseText ? JSON.parse(xhr.responseText) : null;
        } catch {
          data = null;
        }
        if (xhr.status >= 200 && xhr.status < 300) resolve(data as { attachment: AttachmentDTO });
        else {
          const err = (data ?? {}) as PublicApiError;
          reject(new ContributeApiError(err.error ?? `Upload failed (${xhr.status})`, xhr.status, err.code, err.fieldErrors));
        }
      };
      if (opts.signal) opts.signal.addEventListener("abort", () => xhr.abort());
      xhr.send(form);
    }),
};
