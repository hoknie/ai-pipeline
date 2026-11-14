import { ApiError, enc } from '../http.ts';

/** The answer of the panel to an uploaded file: the id the task is sent with. */
export interface UploadedFile {
  upload: string;
  fileName: string;
  size: number;
}

export interface AttachmentsApi {
  /**
   * Sends a file to the panel before the task; `onProgress` gets the share sent, 0 to 100.
   * Rejects with an `ApiError` when the panel refuses the file or the connection fails.
   */
  uploadAttachment(file: File, onProgress?: (percent: number) => void): Promise<UploadedFile>;
  /** Address of an attachment of a run: the download, or with `inline` the picture or text. */
  attachmentUrl(runId: string, id: string, inline?: boolean): string;
}

export function attachmentsApi(): AttachmentsApi {
  return {
    uploadAttachment: (file, onProgress) =>
      new Promise((resolve, reject) => {
        const request = new XMLHttpRequest();
        request.open('POST', '/api/uploads');
        request.withCredentials = true;
        request.setRequestHeader('X-File-Name', enc(file.name));
        request.upload.onprogress = (event) => {
          if (event.lengthComputable && event.total > 0) {
            onProgress?.(Math.round((event.loaded / event.total) * 100));
          }
        };
        request.onerror = () => reject(new ApiError(0, 'network error'));
        request.onload = () => {
          let body: { error?: string } & Partial<UploadedFile> = {};
          try {
            body = JSON.parse(request.responseText) as typeof body;
          } catch {
            // not JSON: the status below tells enough
          }
          if (request.status >= 200 && request.status < 300 && body.upload) {
            resolve(body as UploadedFile);
          } else {
            reject(new ApiError(request.status, body.error ?? request.statusText));
          }
        };
        request.send(file);
      }),
    attachmentUrl: (runId, id, inline = false) =>
      `/api/runs/${enc(runId)}/attachments/${enc(id)}${inline ? '?inline=1' : ''}`,
  };
}
