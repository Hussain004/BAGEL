/**
 * File System Access API declarations the standard TS DOM lib does not ship.
 *
 * TS's built-in DOM types cover `FileSystemHandle` and `FileSystemFileHandle`
 * but stop short of the permission methods and the window-level picker, which
 * are the parts of the API the recent-files feature actually uses. Declaring
 * them here (rather than casting `as any` at each call site) keeps the code
 * honest about what it is calling and makes the day TS ships them properly a
 * simple file deletion.
 */

interface FileSystemHandlePermissionDescriptor {
  mode?: 'read' | 'readwrite';
}

interface FileSystemHandle {
  queryPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
  requestPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
}

interface OpenFilePickerOptions {
  types?: Array<{
    description?: string;
    accept: Record<string, string[]>;
  }>;
  excludeAcceptAllOption?: boolean;
  multiple?: boolean;
}

interface Window {
  showOpenFilePicker(options?: OpenFilePickerOptions): Promise<FileSystemFileHandle[]>;
}

interface DataTransferItem {
  getAsFileSystemHandle(): Promise<FileSystemHandle | null>;
}