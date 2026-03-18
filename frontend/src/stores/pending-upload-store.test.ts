import { describe, it, expect } from 'vitest';
import {
  setPendingUploadFiles,
  consumePendingUploadFiles,
  setPendingUploadUrls,
  consumePendingUploadUrls,
} from './pending-upload-store';

describe('pending-upload-store', () => {
  describe('files', () => {
    it('should set and consume pending files', () => {
      const files = [new File(['a'], 'a.txt'), new File(['b'], 'b.txt')];
      setPendingUploadFiles(files);

      const consumed = consumePendingUploadFiles();
      expect(consumed).toEqual(files);
    });

    it('should return empty array after consuming', () => {
      setPendingUploadFiles([new File(['a'], 'a.txt')]);
      consumePendingUploadFiles();

      const second = consumePendingUploadFiles();
      expect(second).toEqual([]);
    });

    it('should return empty array when nothing set', () => {
      // Consume any leftover state
      consumePendingUploadFiles();
      const result = consumePendingUploadFiles();
      expect(result).toEqual([]);
    });
  });

  describe('urls', () => {
    it('should set and consume pending urls', () => {
      const urls = ['http://a.com', 'http://b.com'];
      setPendingUploadUrls(urls);

      const consumed = consumePendingUploadUrls();
      expect(consumed).toEqual(urls);
    });

    it('should return empty array after consuming', () => {
      setPendingUploadUrls(['http://a.com']);
      consumePendingUploadUrls();

      const second = consumePendingUploadUrls();
      expect(second).toEqual([]);
    });

    it('should return empty array when nothing set', () => {
      consumePendingUploadUrls();
      const result = consumePendingUploadUrls();
      expect(result).toEqual([]);
    });
  });
});
