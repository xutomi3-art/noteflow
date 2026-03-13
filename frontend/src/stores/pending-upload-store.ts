/**
 * Temporary store for files pending upload when creating a notebook.
 * Files are set in DashboardPage and consumed by NotebookPage.
 * Uses a simple module-level variable since File objects aren't serializable.
 */

let pendingFiles: File[] = [];

export function setPendingUploadFiles(files: File[]) {
  pendingFiles = files;
}

export function consumePendingUploadFiles(): File[] {
  const files = pendingFiles;
  pendingFiles = [];
  return files;
}
